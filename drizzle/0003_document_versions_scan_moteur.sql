-- P1-02 — moteur d'analyse antivirus consigné sur chaque version.
-- Sans lui, l'historique indique un verdict (CLEAN / NOT_SCANNED) sans
-- pouvoir dire quel moteur l'a produit : au moment de justifier un dossier,
-- on saurait que la pièce n'a pas été analysée mais pas par qui elle
-- aurait dû l'être.
ALTER TABLE "gf_document_versions" ADD COLUMN "scan_moteur" text;
