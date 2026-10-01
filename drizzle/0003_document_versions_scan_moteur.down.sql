-- Retour arrière de 0003.
-- Aucune donnée de pièce n'est supprimée : les objets présents sur le
-- support de stockage restent intacts.
ALTER TABLE "gf_document_versions" DROP COLUMN IF EXISTS "scan_moteur";
