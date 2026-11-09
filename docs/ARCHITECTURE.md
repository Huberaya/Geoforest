# GeoForest Trace — Architecture Technique & Sécurité

**GeoForest Trace** est une plateforme SaaS B2B européenne d'orchestration et de diligence raisonnée au titre du Règlement (UE) 2023/1115 (EUDR).

---

## 1. Vue d'Ensemble de la Stack Technique

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Navigateur Utilisateur                          │
│           (Cockpit Entreprise Desktop / Portail Fournisseur Mobile)    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS (TLS 1.3 / HSTS)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Next.js 16 (App Router & SSR)                      │
│   • Cockpit Navigation & Dual View Map/Table                           │
│   • Portail Fournisseur Mobile-First (GPS WGS84 Navigator)             │
│   • Analyse de perte forestière Hansen/UMD (source unique)             │
│   • Coffre Documentaire de Légalité & Droits Coutumiers FPIC          │
│   • Workflow DDR 9 Statuts & Passerelle TRACES-NT                      │
│   • Journal d'Audit Immuable (Rétention 5 ans - Art. 12)               │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
    Drizzle ORM     │                                │ HTTP / Internal API
                    ▼                                ▼
┌──────────────────────────────┐  ┌──────────────────────────────────────┐
│  PostgreSQL (Neon Serverless)│  │   FastAPI — SQLite, sans auth (C5)   │
│   • Multi-Tenant Isolation   │  │   • 5 routes, non authentifiées      │
│   • Schema `gf_*` Tables     │  │   • Hansen/UMD 30 m (GFW) uniquement │
│   • JSONB Payloads & RLS     │  │   • Sentinel-2, WorldCover : ABSENTS │
│   • Immutable Audit Trail    │  │   • Normalisation XML/JSON TRACES-NT │
└──────────────────────────────┘  └──────────────────────────────────────┘
```

---

## 2. Modèle de Données & Schéma Multi-Tenant

Toutes les entités du domaine EUDR sont isolées au niveau organisationnel (`organization_id`) :

- `gf_organizations` : Entreprises clientes et opérateurs déclarants (EORI, pays UE).
- `gf_users` : Utilisateurs et rôles RBAC (Admin, Compliance Lead, Auditeur, Fournisseur).
- `gf_suppliers` : Fournisseurs et coopératives avec score de complétude (0-100%).
- `gf_products` : Produits et matières premières de l'Annexe I (Café, Cacao, Soja, Huile de palme, Caoutchouc, Bois, Bovins).
- `gf_shipments` : Lots et expéditions rattachés aux déclarations en douane.
- `gf_plots` : Parcelles géolocalisées (géoJSON WGS84 en `jsonb` et centroïdes). ⚠️ **Pas de PostGIS** : aucune colonne géométrique native, donc aucun index spatial et aucune détection de chevauchement côté base — cf. chantier C8.
- `gf_documents` : Coffre documentaire (Titres fonciers, permis de récolte, fiscalité, FPIC).
- `gf_due_diligence_statements` : Dossiers DDR. ⚠️ Le « cycle à 9 statuts » n'a pas été vérifié contre le schéma ; à confirmer ou retirer.
- `gf_compliance_tasks` : Actions de réduction et de mitigation des risques (Art. 10/11).
- `gf_audit_logs` : Piste d'audit inaltérable scellée pour les autorités compétentes (Art. 12).

---

## 3. Sécurité & Durcissement (Security Hardening)

1. **En-têtes HTTP de Sécurité** — valeurs **exactes**, vérifiées dans
   `src/proxy.ts` et `next.config.ts` le 05/11/2026 :

   | En-tête | Valeur réelle | Remarque |
   |---|---|---|
   | `Content-Security-Policy-Report-Only` | posé | ⚠️ **Report-Only** : aucun blocage effectif, seulement des signalements |
   | `X-Frame-Options` | `SAMEORIGIN` | |
   | `X-Content-Type-Options` | `nosniff` | |
   | `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | ⚠️ **sans `preload`** |
   | `Permissions-Policy` | `camera=(), microphone=(), geolocation=(self)` | |

   ⚠️ Une version antérieure de ce document annonçait une CSP applicative et un
   HSTS `preload`. Les deux étaient faux. C'est mesurable : `grep -n
   "Content-Security-Policy\|Strict-Transport" src/proxy.ts`.
2. **Isolation des Données & Anti-Fuite** :
   - Aucune visibilité inter-tenants.
   - Contrôle strict des paramètres d'ingestion GeoJSON/KML (limites de sommets, détection d'auto-intersection, fermeture des anneaux polygonaux).
3. **Principe Anti-Hallucination & Transparence** :
   - Pas de déclaration fictive : marquage « Déclaré » réservé à l'enregistrement du véritable numéro TRACES-NT.
   - Les analyses satellites fournissent les scores de confiance, sources, périodes d'observation et résolutions spatiales sans boîte noire.

---

## 4. Ce que ce document ne doit pas laisser croire

Ajouté le 05/11/2026, après relevé d'écarts entre la documentation et le code
(détail et mesures : `docs/TEST_REPORT.md` §4).

- **Sources satellites** : seule la perte forestière **Hansen/UMD** est
  interrogée. **Sentinel-2 et ESA WorldCover ne sont pas implémentés** ; ils
  figuraient dans ce document comme s'ils l'étaient.
- **Backend Python** : il est décrit ici comme un « moteur GIS Shapely &
  GeoPandas ». Il tourne sur **SQLite**, **sans authentification**, et expose
  cinq routes. Sa place dans l'architecture est à trancher au chantier C5.
- **CSP** : en mode *Report-Only*. Une politique qui signale sans bloquer n'est
  pas une protection.
- **PostGIS** : absent. Toute affirmation sur l'indexation spatiale ou la
  détection de chevauchement entre parcelles serait fausse.

Règle : dans ce dépôt, un document d'architecture décrit ce qui **est**, et
signale ce qui **n'est pas**. Les fonctionnalités prévues vont dans la roadmap,
pas dans le diagramme.
