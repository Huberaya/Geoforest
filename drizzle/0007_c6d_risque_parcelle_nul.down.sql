-- Retour arrière de C6d.
--
-- ⚠️ Rendre `risk_level` NOT NULL exige de combler les NULL existants.
--    On écrit 'STANDARD', PAS 'LOW' ni 'HIGH' :
--      - 'HIGH' accuserait une parcelle dont on ne sait rien ;
--      - 'LOW' innocenterait une parcelle dont on ne sait rien.
--    'STANDARD' est le seul niveau qui ne porte aucun jugement, et il
--    correspond au défaut prévu par l'article 1(2) du règlement d'exécution
--    (UE) 2025/1093 pour un pays non listé.
update "parcel_audits" set "risk_level" = 'STANDARD' where "risk_level" is null;--> statement-breakpoint
alter table "parcel_audits" alter column "risk_level" set default 'STANDARD';--> statement-breakpoint
alter table "parcel_audits" alter column "risk_level" set not null;--> statement-breakpoint
alter table "parcel_audits" drop column if exists "country_statut";
