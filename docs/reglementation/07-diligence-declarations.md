# Chantier 7 — vérification des dossiers et déclarations

Consultation : 29 septembre 2026. Document de conception, pas avis juridique.

## Sources effectivement consultées

1. Règlement (UE) 2023/1115 consolidé au 26 décembre 2025, annexes II–III : https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226 (extraits 15 et 16).
2. Page officielle actuelle du système d’information : https://green-forum.ec.europa.eu/nature-and-biodiversity/deforestation-regulation-implementation/information-system-deforestation-regulation_en . Distingue PRODUCTION et ACCEPTANCE, accès séparés, API et documentation CIRCABC.
3. Règlement d’exécution (UE) 2026/1565 du 13 juillet 2026, modifiant 2024/3084 : https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:L_202601565 . Identification du texte et extraits 3–4 effectivement lus : noms scientifiques du bois, déclarations simplifiées, références/identifiants/numéros de vérification, visibilité du risque, groupements et webservices.
4. Dossier API lié par la Commission : https://circabc.europa.eu/ui/group/34861680-e799-4d7c-bbad-da83c45da458/library/3819b9e2-b889-4714-9bb3-b4dde1ebe649?p=1&n=10&sort=modified_DESC . La récupération a retourné une coquille JavaScript « Loading... », pas les spécifications. Aucun WSDL/OpenAPI ni appel authentifié qualifié par cette lecture.

Le règlement délégué 2026/2102 relatif à l’annexe I, identifié au chantier 6, reste à prendre en compte pour le champ produit : https://eur-lex.europa.eu/eli/reg_del/2026/2102/oj/eng . Aucun classement SH automatique ajouté.

## Conséquences pour les données

Annexe II : nom et adresse de l’opérateur ; EORI lorsque les produits entrent/sortent du marché ; code SH, description commerciale, nom scientifique lorsque pertinent, quantité ; pays de production et géolocalisation de toutes les parcelles/établissements pertinents. Pour import/export : masse nette en kg et unités supplémentaires lorsqu’applicables. Pas de conversion M3/PCS→KG sans masse réelle fournie et justifiée.

Le texte de déclaration de l’annexe II correspond à une soumission par l’opérateur. Il ne doit pas être affiché comme déclaration déjà effectuée lors d’un téléchargement. La signature interne identifie l’utilisateur et sa décision ; elle n’est pas une signature électronique qualifiée ni une validation administrative.

Annexe III : déclaration simplifiée unique des micro/petits opérateurs primaires, avec caractéristiques et conditions spécifiques, dont estimation annuelle et possibilités de géolocalisation/adresse. Ce n’est pas une copie de la déclaration ordinaire par lot. Les parcours aval, trader et simplifié restent explicitement à qualifier dans l’outil avant validation de ces régimes.

## État exact de la connexion officielle

- **Existence de l’API : confirmée par la Commission.** Ne pas écrire « pas d’API officielle ».
- **Spécification technique exploitable : non qualifiée ici** ; la page CIRCABC nécessiterait une autre méthode de consultation.
- **Accès authentifié : non fourni/non testé.** Aucun compte, mandat ou identifiant créé ; aucune déclaration transmise.
- **Mode du chantier : assisté/manuel**, exports internes et architecture prête à accueillir un adaptateur ultérieur. Aucun fichier présenté comme directement importable dans TRACES sans recette dédiée.
- ACCEPTANCE est destiné à la formation/test : ses soumissions n’ont aucune valeur juridique. PRODUCTION et ACCEPTANCE nécessitent des inscriptions distinctes.

## Ne pas confondre les références et résultats

Le numéro de référence d’une DDS et l’identifiant d’une déclaration simplifiée sont attribués par le système officiel. Le numéro de vérification est un numéro de sécurité d’accès aux données : exclu des exports usuels, non requis dans le premier modèle de dossier.

Le risque interne GeoForest ne correspond pas au statut de risque attribué par les autorités. L’article 6 amendé réserve la visibilité de ce statut aux acteurs autorisés du système, pas à l’utilisateur économique. Aucune référence reçue ou saisie manuellement ne constitue un certificat de conformité.

Le groupement officiel crée des relations et états propres dans le système d’information. Un regroupement interne de lots ou un export ZIP ne doit pas être présenté comme un groupement TRACES. Retrait/correction internes ne modifient pas les déclarations officielles.

## Limites de la lecture et vérifications restantes

Lecture ciblée, non exhaustive, du règlement d’exécution. Avant connexion officielle : spécification actualisée, authentification, mandats, droits par environnement, formats, erreurs/rejeu, limites, sécurité des numéros de vérification et vraie recette ACCEPTANCE. Avant application d’un régime : validation de l’acteur, du produit, des dates et des dispositions nationales pertinentes. Aucun changement des réserves de production du chantier 6.
