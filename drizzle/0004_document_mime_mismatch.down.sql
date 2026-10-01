-- Retour arrière de 0004. Aucune pièce n'est supprimée du support.
ALTER TABLE "gf_documents" DROP COLUMN IF EXISTS "mime_mismatch";
