-- ==============================================================================
-- GEOFOREST TRACE — MIGRATION INITIALE DU SCHÉMA MULTI-TENANT EUDR (UE 2023/1115)
-- Préfixe d'isolation : gf_*
-- Compatible PostgreSQL 15+ / Neon / Supabase
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Organisations (Tenants B2B)
CREATE TABLE IF NOT EXISTS gf_organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    eori TEXT,
    country TEXT NOT NULL DEFAULT 'FR',
    address TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gf_organizations_slug ON gf_organizations(slug);

-- 2. Utilisateurs & Rôles RBAC
CREATE TABLE IF NOT EXISTS gf_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES gf_organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'compliance_officer', -- admin_operator, compliance_officer, auditor, viewer
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gf_users_org ON gf_users(organization_id);

-- 3. Fournisseurs & Producteurs
CREATE TABLE IF NOT EXISTS gf_suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES gf_organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    eori TEXT,
    country TEXT NOT NULL DEFAULT 'CI',
    commodity TEXT NOT NULL, -- cocoa, coffee, palm_oil, rubber, soya, cattle, wood
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    completeness_score INTEGER NOT NULL DEFAULT 0,
    risk_level TEXT NOT NULL DEFAULT 'STANDARD', -- LOW, STANDARD, HIGH, CRITICAL
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, PENDING_INVITE, SUSPENDED
    plots_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gf_suppliers_org ON gf_suppliers(organization_id);

-- 4. Produits & Référentiel Douanier
CREATE TABLE IF NOT EXISTS gf_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES gf_organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sku TEXT,
    commodity TEXT NOT NULL,
    hs_code TEXT NOT NULL,
    country_of_origin TEXT NOT NULL DEFAULT 'FR',
    annual_volume_kg DOUBLE PRECISION DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gf_products_org ON gf_products(organization_id);

-- 5. Lots & Expéditions (Shipments)
CREATE TABLE IF NOT EXISTS gf_shipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES gf_organizations(id) ON DELETE CASCADE,
    supplier_id UUID REFERENCES gf_suppliers(id) ON DELETE SET NULL,
    product_id UUID REFERENCES gf_products(id) ON DELETE SET NULL,
    reference TEXT NOT NULL,
    net_weight_kg DOUBLE PRECISION NOT NULL DEFAULT 0,
    harvest_date TEXT NOT NULL,
    customs_declaration_ref TEXT,
    status TEXT NOT NULL DEFAULT 'IN_PREPARATION', -- IN_PREPARATION, AUDITED, READY, SHIPPED
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gf_shipments_org ON gf_shipments(organization_id);

-- 6. Parcelles SIG & Géométries WGS84
CREATE TABLE IF NOT EXISTS gf_plots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES gf_organizations(id) ON DELETE CASCADE,
    supplier_id UUID REFERENCES gf_suppliers(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    reference TEXT,
    commodity TEXT NOT NULL,
    country_code TEXT NOT NULL DEFAULT 'XX',
    geometry JSONB NOT NULL,
    geometry_type TEXT NOT NULL,
    area_ha DOUBLE PRECISION NOT NULL DEFAULT 0,
    vertex_count INTEGER NOT NULL DEFAULT 0,
    centroid_lon DOUBLE PRECISION NOT NULL DEFAULT 0,
    centroid_lat DOUBLE PRECISION NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'PENDING', -- COMPLIANT, NON_COMPLIANT, INVALID_GEOMETRY, PENDING
    risk_level TEXT NOT NULL DEFAULT 'STANDARD',
    loss_year INTEGER,
    confidence_score DOUBLE PRECISION DEFAULT 0,
    last_audit_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gf_plots_org ON gf_plots(organization_id);

-- 7. Coffre Documentaire Légalité
CREATE TABLE IF NOT EXISTS gf_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES gf_organizations(id) ON DELETE CASCADE,
    supplier_id UUID REFERENCES gf_suppliers(id) ON DELETE SET NULL,
    plot_id UUID REFERENCES gf_plots(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL, -- LAND_TENURE, HARVEST_PERMIT, TAX_CLEARANCE, LABOR_COMPLIANCE, CERTIFICATE_FSC_PEFC
    file_name TEXT NOT NULL,
    file_url TEXT,
    file_size INTEGER DEFAULT 0,
    expiry_date TEXT,
    status TEXT NOT NULL DEFAULT 'TO_VERIFY', -- VALID, EXPIRED, TO_VERIFY, REJECTED
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gf_documents_org ON gf_documents(organization_id);

-- 8. Dossiers de Diligence Raisonnée (DDR)
CREATE TABLE IF NOT EXISTS gf_due_diligence_statements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES gf_organizations(id) ON DELETE CASCADE,
    reference TEXT NOT NULL,
    title TEXT NOT NULL,
    commodity TEXT NOT NULL,
    supplier_id UUID REFERENCES gf_suppliers(id) ON DELETE SET NULL,
    product_id UUID REFERENCES gf_products(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    risk_level TEXT NOT NULL DEFAULT 'STANDARD',
    completeness_score INTEGER NOT NULL DEFAULT 0,
    plots_count INTEGER NOT NULL DEFAULT 0,
    total_area_ha DOUBLE PRECISION NOT NULL DEFAULT 0,
    net_weight_kg DOUBLE PRECISION NOT NULL DEFAULT 0,
    traces_payload_json JSONB,
    traces_reference TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gf_dds_org ON gf_due_diligence_statements(organization_id);

-- 9. Tâches d'Atténuation des Risques
CREATE TABLE IF NOT EXISTS gf_compliance_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES gf_organizations(id) ON DELETE CASCADE,
    diligence_id UUID REFERENCES gf_due_diligence_statements(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    severity TEXT NOT NULL DEFAULT 'MEDIUM', -- LOW, MEDIUM, HIGH, CRITICAL
    status TEXT NOT NULL DEFAULT 'TO_HANDLE', -- TO_HANDLE, IN_PROGRESS, RESOLVED, VALIDATED
    assignee TEXT,
    due_date TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gf_tasks_org ON gf_compliance_tasks(organization_id);

-- 10. Piste d'Audit Immuable (Audit Logs)
CREATE TABLE IF NOT EXISTS gf_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES gf_organizations(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL DEFAULT 'system',
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gf_audit_logs_org ON gf_audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_gf_audit_logs_created_at ON gf_audit_logs(created_at);

-- 11. Audits unitaires de parcelles (Moteur SIG & TRACES-NT)
CREATE TABLE IF NOT EXISTS parcel_audits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES gf_organizations(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    operator_name TEXT NOT NULL,
    operator_eori TEXT NOT NULL,
    operator_country TEXT NOT NULL DEFAULT 'FR',
    operator_address TEXT,
    commodity TEXT NOT NULL,
    hs_code TEXT NOT NULL,
    harvest_date TEXT NOT NULL,
    parcel_reference TEXT,
    geometry JSONB NOT NULL,
    geometry_type TEXT NOT NULL,
    area_ha DOUBLE PRECISION NOT NULL DEFAULT 0,
    vertex_count INTEGER NOT NULL DEFAULT 0,
    centroid_lon DOUBLE PRECISION NOT NULL DEFAULT 0,
    centroid_lat DOUBLE PRECISION NOT NULL DEFAULT 0,
    country_code TEXT NOT NULL DEFAULT 'XX',
    country_risk TEXT NOT NULL DEFAULT 'STANDARD',
    compliant BOOLEAN NOT NULL DEFAULT FALSE,
    loss_year INTEGER,
    confidence_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    risk_level TEXT NOT NULL DEFAULT 'STANDARD',
    status TEXT NOT NULL,
    validation JSONB NOT NULL,
    satellite JSONB,
    traces_reference TEXT,
    exported_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_parcel_audits_created_at ON parcel_audits(created_at);
