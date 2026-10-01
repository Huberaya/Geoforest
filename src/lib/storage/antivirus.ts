/**
 * Analyse antivirus des pièces déposées.
 *
 * ⚠️ P1-02 — lire ceci avant de croire à une protection.
 *
 * Le plan de correction demande un antivirus. **Aucun moteur n'est disponible
 * dans cet environnement**, et il n'en existe pas non plus dans le dépôt. Ce
 * module ne prétend donc pas analyser quoi que ce soit : il définit l'interface
 * qu'un moteur réel devra implémenter, et il enregistre honnêtement
 * l'absence d'analyse.
 *
 * Trois statuts, et ils ne se confondent pas — c'est tout l'objet du module :
 *
 *   · `CLEAN`       — un moteur a analysé le fichier et n'a rien détecté ;
 *   · `INFECTED`    — un moteur a détecté quelque chose ;
 *   · `NOT_SCANNED` — **aucun moteur n'a été interrogé**. Le fichier peut être
 *                     sain comme hostile : on n'en sait rien.
 *
 * Le troisième est celui par défaut ici. Le faire passer pour le premier
 * reviendrait à affirmer qu'un fichier est sain faute de l'avoir regardé —
 * exactement le genre de mensonge que l'audit a pour objet d'éliminer.
 */

export type StatutAnalyse = "CLEAN" | "INFECTED" | "NOT_SCANNED";

export interface ResultatAnalyse {
  statut: StatutAnalyse;
  /** Nom du moteur, ou mention explicite de son absence. */
  moteur: string;
  /** Version du moteur, si connue. */
  version: string | null;
  detail: string | null;
  analyséLe: string;
}

export interface Analyseur {
  nom(): string;
  analyser(contenu: Uint8Array, nomFichier: string): Promise<ResultatAnalyse>;
}

/**
 * Analyseur qui n'analyse rien, et le dit.
 *
 * ⚠️ Ce n'est pas un analyseur « permisif » : c'est l'absence d'analyseur,
 * explicitement représentée. Le conserver permet au reste du produit de
 * fonctionner — dépôt, condensat, téléchargement — sans jamais afficher
 * « fichier sain » à tort.
 */
export const analyseurIndisponible: Analyseur = {
  nom: () => "aucun",
  analyser: async () => ({
    statut: "NOT_SCANNED",
    moteur: "aucun",
    version: null,
    detail:
      "Aucun moteur antivirus n'est configuré : le fichier n'a pas été analysé. " +
      "Sa nocivité est inconnue, elle ne doit pas être présentée comme nulle.",
    analyséLe: new Date().toISOString(),
  }),
};

/**
 * Analyseur ClamAV, par le démon `clamd` (protocole INSTREAM).
 *
 * ⚠️ **Jamais exécuté à ce jour.** Aucun `clamd` n'est joignable ici : cette
 * implémentation est écrite pour que la mise en service se limite à renseigner
 * deux variables d'environnement, mais elle n'a été éprouvée contre aucun
 * serveur réel. Elle est donc livrée **non validée**, et le produit doit
 * continuer à fonctionner sans elle.
 *
 * Variables :
 *   CLAMAV_HOST (défaut 127.0.0.1) · CLAMAV_PORT (défaut 3310) · CLAMAV_TIMEOUT_MS
 */
export const analyseurClamav: Analyseur = {
  nom: () => "clamav",
  analyser: async (contenu: Uint8Array, _nomFichier: string): Promise<ResultatAnalyse> => {
    const hote = process.env.CLAMAV_HOST ?? "127.0.0.1";
    const port = Number(process.env.CLAMAV_PORT ?? "3310");
    const delaiMs = Number(process.env.CLAMAV_TIMEOUT_MS ?? "10000");

    try {
      const { connect } = await import("node:net");
      const reponse = await new Promise<string>((resoudre, rejeter) => {
        const socket = connect({ host: hote, port }, () => {
          socket.write("zINSTREAM\0");
          const taille = Buffer.alloc(4);
          taille.writeUInt32BE(contenu.length, 0);
          socket.write(taille);
          socket.write(Buffer.from(contenu));
          socket.write(Buffer.from([0, 0, 0, 0]));
        });
        socket.setTimeout(delaiMs);
        let tampon = "";
        socket.on("data", (morceau) => {
          tampon += morceau.toString("utf-8");
        });
        socket.on("end", () => resoudre(tampon.trim()));
        socket.on("timeout", () => {
          socket.destroy();
          rejeter(new Error("clamd : délai dépassé"));
        });
        socket.on("error", rejeter);
      });

      const infecte = /FOUND$/i.test(reponse);
      return {
        statut: infecte ? "INFECTED" : "CLEAN",
        moteur: "clamav",
        version: null,
        detail: infecte ? reponse : "Aucune signature détectée.",
        analyséLe: new Date().toISOString(),
      };
    } catch (err) {
      // Le moteur étant injoignable, on retombe sur « non analysé » — jamais
      // sur « sain ». Une panne d'antivirus ne doit pas devenir un certificat.
      return {
        statut: "NOT_SCANNED",
        moteur: "clamav",
        version: null,
        detail: `Moteur injoignable (${hote}:${port}) : ${(err as Error).message}`,
        analyséLe: new Date().toISOString(),
      };
    }
  },
};

/** Analyseur effectivement monté, selon la configuration. */
export function analyseurCourant(): Analyseur {
  return process.env.CLAMAV_HOST || process.env.CLAMAV_PORT ? analyseurClamav : analyseurIndisponible;
}

/**
 * Politique : exiger une analyse propre avant d'accepter un dépôt.
 *
 * Désactivée par défaut, et ce n'est pas un relâchement : l'activer sans
 * moteur disponible interdirait **tout** dépôt, y compris les fichiers sains.
 * En production, avec un moteur réellement monté, elle doit être activée.
 */
export function analyseObligatoire(): boolean {
  return (process.env.GF_DOCUMENTS_EXIGER_ANALYSE ?? "false").toLowerCase() === "true";
}
