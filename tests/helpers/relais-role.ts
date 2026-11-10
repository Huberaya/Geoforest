/**
 * Relais PostgreSQL de test : force le rôle applicatif sur chaque connexion.
 *
 * ⚠️ Pourquoi ce relais existe.
 *
 *   `PGLiteSocketServer` **n'authentifie pas** : toute connexion y arrive avec
 *   le rôle `postgres`, superutilisateur. Un serveur Next branché directement
 *   dessus contourne donc la RLS, et les tests HTTP ne prouveraient que le
 *   filtrage applicatif — jamais l'application réelle des politiques.
 *
 *   Ce relais s'interpose entre l'application et PGlite. Il laisse passer le
 *   message de démarrage, retient le premier `ReadyForQuery`, injecte
 *   `SET ROLE geoforest_app`, puis rend la main au client. La connexion se
 *   poursuit avec les privilèges réels du rôle applicatif.
 *
 *   Ce n'est pas une simulation : PostgreSQL exécute bien `SET ROLE`, et le
 *   rôle `geoforest_app` est celui créé par les migrations (`NOSUPERUSER
 *   NOBYPASSRLS`). Le test vérifie ensuite `current_user` pour s'assurer que
 *   le rôle est bien celui attendu — un relais qui échouerait à poser le rôle
 *   doit faire échouer le test, jamais le laisser passer silencieusement.
 *
 * Limites : le relais ne comprend que le protocole nécessaire au démarrage. Il
 * ne gère ni TLS, ni l'authentification (PGlite ne la propose pas), ni les
 * messages asynchrones qui précéderaient le premier `ReadyForQuery`.
 */
import { createConnection, createServer, type Server, type Socket } from "node:net";

interface OptionsRelais {
  /** Port du socket PGlite (PostgreSQL brut). */
  portAmont: number;
  hoteAmont?: string;
  /** Rôle à poser sur chaque connexion. */
  role: string;
  /** Port d'écoute du relais. 0 = choisi par le système. */
  port?: number;
  hote?: string;
}

export interface Relais {
  port: number;
  /** Nombre de connexions acceptées depuis le démarrage. */
  connexions(): number;
  arreter(): Promise<void>;
}

const DEMARRAGE_MAX = 64 * 1024;

function longueurMessage(tampon: Buffer, decalage: number): number | null {
  if (tampon.length < decalage + 4) return null;
  const longueur = tampon.readInt32BE(decalage);
  if (longueur < 4 || longueur > 16 * 1024 * 1024) {
    throw new Error(`Longueur de message PostgreSQL invalide : ${longueur}`);
  }
  return longueur;
}

/** Message `Query` (type 'Q') du protocole frontal PostgreSQL. */
function messageRequete(sql: string): Buffer {
  const texte = Buffer.from(`${sql}\0`, "utf8");
  const entete = Buffer.alloc(5);
  entete.write("Q", 0, "ascii");
  entete.writeInt32BE(texte.length + 4, 1);
  return Buffer.concat([entete, texte]);
}

/**
 * Extrait le message de démarrage complet.
 * Il n'a pas de code de type : il commence par sa longueur.
 */
function extraireDemarrage(tampon: Tampon): { demarrage: Tampon; reste: Tampon } | null {
  const longueur = longueurMessage(tampon, 0);
  if (longueur === null || tampon.length < longueur) return null;
  return { demarrage: tampon.subarray(0, longueur), reste: tampon.subarray(longueur) };
}

/**
 * Consomme les messages du serveur jusqu'au premier `ReadyForQuery` inclus.
 * Renvoie les octets lus et ce qui suit éventuellement.
 */
function jusquAuPret(tampon: Tampon): { messages: Tampon; reste: Tampon } | null {
  let offset = 0;
  while (offset + 5 <= tampon.length) {
    const type = String.fromCharCode(tampon[offset]);
    const longueur = tampon.readInt32BE(offset + 1);
    if (longueur < 4 || offset + 1 + longueur > tampon.length) return null;
    offset += 1 + longueur;
    if (type === "Z") {
      return { messages: tampon.subarray(0, offset), reste: tampon.subarray(offset) };
    }
  }
  return null;
}

/** Premier message d'erreur (`E`) d'un lot, en clair, ou `null`. */
function premiereErreur(lot: Tampon): string | null {
  for (let offset = 0; offset + 5 <= lot.length; ) {
    const type = String.fromCharCode(lot[offset]);
    const longueur = lot.readInt32BE(offset + 1);
    if (longueur < 4 || offset + 1 + longueur > lot.length) break;
    if (type === "E") {
      return lot.subarray(offset + 5, offset + 1 + longueur).toString("utf8").replace(/\0/g, " ").trim();
    }
    offset += 1 + longueur;
  }
  return null;
}

type Phase = "poignee" | "role" | "relais";

/**
 * ⚠️ `Buffer.alloc(0)` est typé `Buffer<ArrayBuffer>` alors que `subarray()`
 *   rend `Buffer<ArrayBufferLike>` : concaténer les deux fait échouer `tsc`
 *   sous TypeScript 5.9. On déclare donc les tampons dans le type large, qui
 *   est celui que produisent réellement les morceaux reçus du réseau.
 */
type Tampon = Buffer<ArrayBufferLike>;

export async function demarrerRelais(options: OptionsRelais): Promise<Relais> {
  const hoteAmont = options.hoteAmont ?? "127.0.0.1";
  const hote = options.hote ?? "127.0.0.1";
  const sockets = new Set<Socket>();
  const requeteRole = messageRequete(`SET ROLE ${options.role}`);
  let connexions = 0;

  const serveur: Server = createServer((client) => {
    connexions += 1;
    sockets.add(client);
    client.on("close", () => sockets.delete(client));

    const amont = createConnection({ host: hoteAmont, port: options.portAmont });
    sockets.add(amont);
    amont.on("close", () => {
      sockets.delete(amont);
      client.destroy();
    });
    amont.on("error", () => client.destroy());
    client.on("error", () => amont.destroy());
    amont.on("error", () => sockets.delete(amont));

    let phase: Phase = "poignee";
    let demarrageTransmis = false;
    let tamponClient: Tampon = Buffer.alloc(0);
    let tamponAmont: Tampon = Buffer.alloc(0);

    const echouer = (message: string) => {
      client.destroy(new Error(message));
      amont.destroy();
    };

    client.on("data", (morceau: Buffer) => {
      if (phase === "relais") {
        amont.write(morceau);
        return;
      }
      tamponClient = Buffer.concat([tamponClient, morceau]);
      if (demarrageTransmis) return;

      if (tamponClient.length > DEMARRAGE_MAX) {
        echouer("Message de démarrage trop volumineux");
        return;
      }
      const extrait = extraireDemarrage(tamponClient);
      if (!extrait) return;
      tamponClient = extrait.reste;
      demarrageTransmis = true;
      amont.write(extrait.demarrage);
    });

    amont.on("data", (morceau: Buffer) => {
      if (phase === "relais") {
        client.write(morceau);
        return;
      }
      tamponAmont = Buffer.concat([tamponAmont, morceau]);

      if (phase === "poignee") {
        const pret = jusquAuPret(tamponAmont);
        if (!pret) return;
        // Tout est transmis SAUF le `ReadyForQuery` : le client ne doit pas
        // envoyer de requête avant que le rôle ne soit posé.
        const avantPret = pret.messages.subarray(0, pret.messages.length - 5);
        if (avantPret.length > 0) client.write(avantPret);
        const erreur = premiereErreur(avantPret);
        if (erreur) {
          echouer(`Échec de la poignée de main PostgreSQL : ${erreur}`);
          return;
        }
        tamponAmont = pret.reste;
        phase = "role";
        amont.write(requeteRole);
        return;
      }

      // phase === "role"
      const pret = jusquAuPret(tamponAmont);
      if (!pret) return;
      const erreur = premiereErreur(pret.messages);
      if (erreur) {
        // Sans ce garde-fou, un `SET ROLE` refusé laisserait la connexion en
        // superutilisateur et le test « passerait » sans rien prouver.
        echouer(`SET ROLE ${options.role} refusé : ${erreur}`);
        return;
      }
      client.write(pret.messages.subarray(pret.messages.length - 5));
      tamponAmont = pret.reste;
      phase = "relais";
      if (tamponClient.length > 0) amont.write(tamponClient);
      tamponClient = Buffer.alloc(0);
    });
  });

  const port = await new Promise<number>((resoudre, rejeter) => {
    serveur.once("error", rejeter);
    serveur.listen(options.port ?? 0, hote, () => {
      const adresse = serveur.address();
      if (adresse === null || typeof adresse === "string") {
        rejeter(new Error("Adresse du relais illisible"));
        return;
      }
      resoudre(adresse.port);
    });
  });

  return {
    port,
    connexions: () => connexions,
    async arreter() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resoudre) => serveur.close(() => resoudre()));
    },
  };
}
