-- P1-02 — écart entre type déclaré et type réel, figé au dépôt.
-- Valeur calculée une fois pour toutes : la règle qui distingue un mensonge
-- d'une simple absence d'information (cf. `ecartDeType`) est nuancée et peut
-- évoluer. Recalculer à l'affichage reviendrait à réécrire l'appréciation
-- portée sur une pièce déjà versée au dossier.
ALTER TABLE "gf_documents" ADD COLUMN "mime_mismatch" boolean DEFAULT false NOT NULL;
