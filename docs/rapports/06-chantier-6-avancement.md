# Chantier 6 — premier incrément : stockage privé et antivirus

28 septembre 2026 · branche `chantier-6/documents-legality-risk`

**CHANTIER EN COURS, NON CLÔTURÉ.** Le choix utilisateur est un coffre privé auto-hébergé, avec documents fictifs pour la recette. Aucun GO7. Application et schéma restent 0.6.0 / 0005 : cet incrément n’ajoute pas encore de dépôt accessible dans l’interface ou l’API.

## Fait

- Plan, dépendances, fichiers et critères de sortie : `../adr/006-documents-legality-risk.md`.
- Vérification réglementaire initiale : article 12/13 et section légalité du guide de la Commission du 13 juillet 2026 ; nécessité de contextualiser les justificatifs, sans titre foncier universellement obligatoire. Lecture réglementaire à compléter avant moteur juridique.
- Adaptateur de stockage local : racine privée 0700 détenue par le compte du service, dossiers organisation opaques, objets UUID générés serveur, aucun chemin ou nom fourni par le déposant ; limite 20 Mio, blocs 64 Kio, au plus 4 096 blocs ; empreinte SHA-256 et taille calculées. Écriture temporaire puis publication atomique sans écrasement, nettoyage des transferts incomplets, objets en lecture seule applicative 0400.
- Lecture interne après vérification complète taille/empreinte/permissions, sur le même inode ouvert ; refus des liens symboliques et des objets avec liens physiques multiples. Le stockage n’autorise **pas** à lui seul un téléchargement : l’API devra vérifier identité, tenant, fournisseur et état de quarantaine.
- Adaptateur antivirus local réel : ClamAV **1.4.6**, signatures officielles actualisées. Aucun octet envoyé à un scanner cloud. Seules les trois bases éditeur sont passées au moteur, pas des listes d’exclusion supplémentaires trouvées dans le répertoire.
- Sous-processus sans secrets applicatifs ni proxy hérité ; limites mémoire virtuelle 2 Gio, CPU 45 s, délai parent 65 s, fichiers 80 Mio par fichier, descripteurs 64, pas de core dump. La sortie lue est bornée à 64 Kio plus un octet sentinelle et un dépassement ne peut donner un scan réussi. Fichiers temporaires privés supprimés après exécution.
- Politique de scan : 20 Mio par fichier, 80 Mio analysés, 1 000 fichiers internes, récursion 8 ; chiffrement/macros/limites/détection empêchent le succès. Le délai interne susceptible de traiter un dépassement comme sain est désactivé : délai parent avec arrêt du groupe de processus à la place.
- Bases absentes, périmées (72 h pour `daily`, choix opérationnel et non obligation EUDR), dates incohérentes, erreur, changement de version des bases pendant le scan, moteur non qualifié ou timeout : `SCAN_UNAVAILABLE`, jamais succès par défaut.

`SCAN_PASSED` signifie uniquement aucune détection dans les conditions de ce scan. Ce n’est ni une validation de format documentaire, ni une authentification de pièce, ni une décision de légalité.

## Qualification du moteur

Le paquet système initial fournit ClamAV 1.4.3. Il n’a **pas** été admis comme moteur documentaire : la publication de sécurité de l’éditeur du 7 août 2026 documente notamment des corrections de parseur PDF dans 1.4.6 / 1.5.4. [1](https://blog.clamav.net/2026/08/clamav-154-and-146-security-patch.html)

Le moteur testé est extrait du paquet officiel :

- URL : `https://github.com/Cisco-Talos/clamav/releases/download/clamav-1.4.6/clamav-1.4.6.linux.x86_64.deb`
- Métadonnées : `https://api.github.com/repos/Cisco-Talos/clamav/releases/tags/clamav-1.4.6`
- Taille : **94 663 320 octets**.
- SHA-256 vérifié contre les métadonnées de l’API GitHub : `d3ee9e401974855a1edc1761b1425417d126de618d5f0c91cd51209f69f6fcc2`.
- Signature détachée de l’éditeur non vérifiée séparément ; ne pas confondre ce contrôle d’empreinte et de provenance HTTPS avec une telle vérification.

Bases chargées pour la recette : daily 28137, main 63, bytecode 339. Versions, dates et nombres de signatures figurent dans la preuve JSON. Le moteur et les bases sont des dépendances de recette hors Git ; une nouvelle machine doit les provisionner et requalifier. Les téléchargements portent uniquement sur les logiciels/signatures publics, jamais sur des documents d’entreprise.

## Tests exécutés

| Contrôle | Résultat |
|---|---|
| Tests unitaires stockage / scanner | **30 réussis** |
| Régression unitaire forestière | **112 réussis**, 12 avertissements Rasterio/Affine préexistants |
| Texte fictif, antivirus réel | `SCAN_PASSED` |
| Texte fictif de 280 000 octets, antivirus réel | `SCAN_PASSED` |
| Chaîne standard de test EICAR, moteur et bases réels | `SCAN_REJECTED` — aucun vrai malware utilisé |
| Timeout forcé | `SCAN_UNAVAILABLE` |
| Bases synthétiques malformées soumises au vrai moteur | `SCAN_UNAVAILABLE` |
| Ruff sur nouveaux modules/tests/script | Réussi |

Preuves : `preuves-chantier-6/antivirus-reel.json`, `unit-storage-scanner.txt`, `regression-forest-unit.txt`, `ruff.txt`.

Reproduction après provisionnement :

```sh
PYTHONPATH=backend .venv/bin/python scripts/qualify-document-scanner.py \
  --engine /chemin/prive/clamav/usr/local/bin/clamscan \
  --library-path /chemin/prive/clamav/usr/local/lib \
  --database /var/lib/clamav
```

Ce script utilise exclusivement des octets fictifs et la chaîne de test EICAR, puis efface les objets temporaires. Les tests unitaires emploient aussi des données et réponses synthétiques ; ils sont distincts de la qualification du moteur réel.

## Non fait — nécessaire avant livraison du chantier 6

- Migration 0006, métadonnées documentaires/versionnement métier, réservation de quotas, concurrence et reprise DB/objets.
- Dépôt authentifié borné dans API/interface/portail ; filtrage MIME et validation des formats ; téléchargement autorisé conditionné par l’état de scan ; antivirus derrière une file/concurrence globale bornée.
- Revue documentaire, liens typés, émetteurs/validité, certificats et expiration contextualisée.
- Checklist de légalité avec applicabilité et sources nationales effectivement qualifiées ; évaluation de risque explicable et décisions motivées/historisées.
- Tâches, rappels, outbox et éventuelle qualification SMTP ; aucun email envoyé.
- OCR local assisté optionnel ; aucune extraction IA, aucun document transmis à un tiers.
- Recette API/RLS/fournisseur, E2E mobile, migrations peuplées, sauvegarde/restauration conjointe DB + objets, documentation utilisateur finale.

La suite backend complète et les E2E n’ont pas été rejoués pour ce premier incrément. Les 604 backend et 7 E2E du chantier 5 restent des résultats historiques, pas la validation du chantier 6.

## Risques et prochaines actions

L’isolation de ressources du scanner **n’est pas un sandbox OS**. L’API ne doit pas être ouverte à des documents réels sans durcissement du processus/conteneur, egress, droits, quotas disque/concurrence, mises à jour et monitoring. Les permissions Unix ne constituent ni chiffrement au repos ni immutabilité face à un administrateur. Hébergement UE de production, clés, rétention, droits RGPD, quotas et sauvegardes restent à qualifier.

Prochaine étape du même chantier : intégrer le modèle documentaire et le flux de quarantaine, avec contrôle des droits avant réception des fichiers, puis livrer les fonctions de revue/légalité/risque. Aucun passage au chantier 7 et aucune clôture prématurée.

La modification préexistante de `infra/bootstrap-db.sh` est laissée intacte et exclue des commits de ce chantier. Aucun push GitHub ni déploiement de production effectué.
