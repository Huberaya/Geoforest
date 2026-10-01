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
│   • Visualiseur Multi-Spectral Satellite (NDVI, Hansen, ESA)           │
│   • Coffre Documentaire de Légalité & Droits Coutumiers FPIC          │
│   • Workflow DDR 9 Statuts & Passerelle TRACES-NT                      │
│   • Journal d'Audit Immuable (Rétention 5 ans - Art. 12)               │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
    Drizzle ORM     │                                │ HTTP / Internal API
                    ▼                                ▼
┌──────────────────────────────┐  ┌──────────────────────────────────────┐
│  PostgreSQL (Neon Serverless)│  │   Python 3.13 FastAPI Engine         │
│   • Multi-Tenant Isolation   │  │   • Shapely & GeoPandas GIS Engine   │
│   • Schema `gf_*` Tables     │  │   • Hansen GFW (30m) & Sentinel-2    │
│   • JSONB Payloads & RLS     │  │   • ESA WorldCover & Buffer 50-100m  │
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
- `gf_plots` : Parcelles géolocalisées avec géométries polygonales WGS84 et centroïdes.
- `gf_documents` : Coffre documentaire (Titres fonciers, permis de récolte, fiscalité, FPIC).
- `gf_due_diligence_statements` : Dossiers DDR avec cycle de vie à 9 statuts.
- `gf_compliance_tasks` : Actions de réduction et de mitigation des risques (Art. 10/11).
- `gf_audit_logs` : Piste d'audit inaltérable scellée pour les autorités compétentes (Art. 12).

---

## 3. Sécurité & Durcissement (Security Hardening)

1. **En-têtes HTTP de Sécurité** :
   - `Content-Security-Policy` & `X-Frame-Options: SAMEORIGIN`
   - `X-Content-Type-Options: nosniff`
   - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=(self)`
2. **Isolation des Données & Anti-Fuite** :
   - Aucune visibilité inter-tenants.
   - Contrôle strict des paramètres d'ingestion GeoJSON/KML (limites de sommets, détection d'auto-intersection, fermeture des anneaux polygonaux).
3. **Principe Anti-Hallucination & Transparence** :
   - Pas de déclaration fictive : marquage « Déclaré » réservé à l'enregistrement du véritable numéro TRACES-NT.
   - Les analyses satellites fournissent les scores de confiance, sources, périodes d'observation et résolutions spatiales sans boîte noire.
