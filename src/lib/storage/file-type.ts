/**
 * Type réel d'un fichier, lu dans ses **octets**.
 *
 * ⚠️ P1-02 — pourquoi ce module existe.
 *
 * Le type MIME déclaré par le client n'est qu'une affirmation : le navigateur
 * le déduit de l'extension du fichier, que l'émetteur choisit librement. Un
 * exécutable renommé `certificat.pdf` se déclare `application/pdf`. Se fier à
 * cette valeur revient à stocker — et à restituer à un autre utilisateur — un
 * fichier dont on ignore la nature.
 *
 * La détection porte donc sur les octets d'en-tête (« nombres magiques »).
 * Elle ne remplace pas une analyse antivirus (cf. `antivirus.ts`) : elle dit ce
 * qu'est le fichier, pas s'il est hostile.
 */

export interface TypeReel {
  /** Type déduit des octets. */
  mime: string;
  /** Extension la plus courante pour ce type. */
  extension: string;
  /**
   * Vrai si ce type ne devrait jamais être déposé dans un dossier de
   * conformité : exécutable, script, archive contenant des exécutables.
   */
  dangereux: boolean;
  /** Libellé lisible, pour les messages et l'interface. */
  libelle: string;
}

const INCONNU: TypeReel = {
  mime: "application/octet-stream",
  extension: "bin",
  dangereux: false,
  libelle: "Type non identifié",
};

interface Signature {
  mime: string;
  extension: string;
  libelle: string;
  dangereux?: boolean;
  /** Décalage dans le fichier, en octets. */
  decalage?: number;
  /** Octets attendus, dans l'ordre. */
  octets: number[];
}

/**
 * Table des signatures.
 *
 * L'ordre importe : la première signature qui correspond est retenue. Les
 * conteneurs ZIP (docx, xlsx, odt) sont détectés comme tels, sans inspection
 * du contenu — un ZIP peut renfermer n'importe quoi, c'est pourquoi il est
 * signalé mais pas interdit.
 */
const SIGNATURES: Signature[] = [
  { mime: "application/pdf", extension: "pdf", libelle: "PDF", octets: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { mime: "image/png", extension: "png", libelle: "Image PNG", octets: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", extension: "jpg", libelle: "Image JPEG", octets: [0xff, 0xd8, 0xff] },
  { mime: "image/tiff", extension: "tif", libelle: "Image TIFF", octets: [0x49, 0x49, 0x2a, 0x00] },
  { mime: "image/tiff", extension: "tif", libelle: "Image TIFF", octets: [0x4d, 0x4d, 0x00, 0x2a] },
  { mime: "image/gif", extension: "gif", libelle: "Image GIF", octets: [0x47, 0x49, 0x46, 0x38] },
  { mime: "image/webp", extension: "webp", libelle: "Image WebP", octets: [0x52, 0x49, 0x46, 0x46], },
  // Le conteneur ZIP recouvre docx, xlsx, odt, ods : on ne prétend pas savoir
  // lequel sans lire la table des entrées, ce qui dépasse l'objet de ce module.
  { mime: "application/zip", extension: "zip", libelle: "Archive ZIP (docx, xlsx, odt…)", octets: [0x50, 0x4b, 0x03, 0x04] },
  { mime: "application/rtf", extension: "rtf", libelle: "Texte enrichi RTF", octets: [0x7b, 0x5c, 0x72, 0x74, 0x66] },
  { mime: "application/postscript", extension: "ps", libelle: "PostScript", octets: [0x25, 0x21, 0x50, 0x53] },
  // ⚠️ Types que l'on ne doit jamais retrouver dans un dossier de conformité.
  { mime: "application/x-elf", extension: "elf", libelle: "Exécutable ELF", dangereux: true, octets: [0x7f, 0x45, 0x4c, 0x46] },
  { mime: "application/x-dosexec", extension: "exe", libelle: "Exécutable Windows", dangereux: true, octets: [0x4d, 0x5a] },
  { mime: "application/x-mach-binary", extension: "macho", libelle: "Exécutable macOS", dangereux: true, octets: [0xcf, 0xfa, 0xed, 0xfe] },
  { mime: "application/x-mach-binary", extension: "macho", libelle: "Exécutable macOS", dangereux: true, octets: [0xfe, 0xed, 0xfa, 0xcf] },
  { mime: "application/x-shockwave-flash", extension: "swf", libelle: "Animation Flash", dangereux: true, octets: [0x43, 0x57, 0x53] },
  { mime: "text/x-shellscript", extension: "sh", libelle: "Script shell", dangereux: true, octets: [0x23, 0x21, 0x2f] },
  // Formats de document anciens, porteurs de macros : signalés.
  { mime: "application/vnd.ms-office", extension: "doc", libelle: "Document Word 97-2003 (macros possibles)", dangereux: true, octets: [0xd0, 0xcf, 0x11, 0xe0] },
];

/** Longueur de la plus longue signature, pour ne lire que le nécessaire. */
const LONGUEUR_MAX = Math.max(...SIGNATURES.map((s) => (s.decalage ?? 0) + s.octets.length));

function correspond(entete: Uint8Array, signature: Signature): boolean {
  const decalage = signature.decalage ?? 0;
  if (entete.length < decalage + signature.octets.length) return false;
  for (let i = 0; i < signature.octets.length; i += 1) {
    if (entete[decalage + i] !== signature.octets[i]) return false;
  }
  return true;
}

/** Vrai si les octets ressemblent à du texte (et non à un binaire quelconque). */
function sembleTexte(entete: Uint8Array): boolean {
  if (entete.length === 0) return false;
  for (const octet of entete) {
    // Tabulation, retour chariot, saut de ligne : blancs admis.
    if (octet === 0x09 || octet === 0x0d || octet === 0x0a) continue;
    // Caractère imprimable, ou accentué (UTF-8 à partir de 0xC0).
    if (octet >= 0x20 && octet !== 0x7f) continue;
    return false;
  }
  return true;
}

/** Vrai si le contenu commence par une marque d'ordre des octets UTF. */
function aBom(entete: Uint8Array): boolean {
  return (
    (entete[0] === 0xef && entete[1] === 0xbb && entete[2] === 0xbf) ||
    (entete[0] === 0xff && entete[1] === 0xfe) ||
    (entete[0] === 0xfe && entete[1] === 0xff)
  );
}

/**
 * Déduit le type réel d'un contenu.
 *
 * Le texte est détecté **après** les signatures binaires : un PDF commence par
 * « %PDF- », qui est aussi du texte imprimable.
 */
export function detecterType(contenu: Uint8Array): TypeReel {
  const entete = contenu.subarray(0, LONGUEUR_MAX);

  for (const signature of SIGNATURES) {
    if (correspond(entete, signature)) {
      return {
        mime: signature.mime,
        extension: signature.extension,
        dangereux: signature.dangereux === true,
        libelle: signature.libelle,
      };
    }
  }

  if (aBom(entete) || sembleTexte(entete)) {
    return { mime: "text/plain", extension: "txt", dangereux: false, libelle: "Texte brut" };
  }

  return INCONNU;
}

/**
 * Compare le type déclaré par le client au type réellement lu.
 *
 * ⚠️ Tous les écarts ne se valent pas, et les traiter de la même façon
 * produirait soit des refus absurdes, soit une indulgence dangereuse :
 *
 *   · `application/octet-stream` est ce qu'envoie un client qui ne sait pas :
 *     ce n'est pas un mensonge, c'est une absence d'information ;
 *   · un conteneur ZIP couvre docx/xlsx/odt : déclarer `…wordprocessingml…`
 *     pour un contenu ZIP n'a rien d'un mensonge ;
 *   · en revanche, déclarer `application/pdf` pour un exécutable est une
 *     tromperie, et le type réel est de toute façon refusé.
 */
export function ecartDeType(declare: string | null | undefined, reel: TypeReel): boolean {
  if (!declare) return false;
  const d = declare.split(";")[0].trim().toLowerCase();
  if (d === "" || d === "application/octet-stream" || d === reel.mime) return false;
  if (reel.mime === "application/zip" && d.startsWith("application/vnd.openxmlformats")) return false;
  if (reel.mime === "application/zip" && d.startsWith("application/vnd.oasis.opendocument")) return false;
  if (reel.mime === "text/plain" && d.startsWith("text/")) return false;
  if (reel.mime === "text/plain" && (d === "application/csv" || d === "text/csv")) return false;
  return true;
}
