-- TEST-ONLY DDL for a confirmed empty disposable Neon child branch.
-- Full Alembic chain from base through C7 head 20260926_0002; generated offline.
-- NEVER run on production. Confirm the Neon branch selector before any execution.

BEGIN;

CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL,
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running upgrade  -> 20260925_0001

CREATE TABLE organizations (
    id VARCHAR(36) NOT NULL,
    name VARCHAR(200) NOT NULL,
    legal_name VARCHAR(250),
    siret VARCHAR(50),
    eori VARCHAR(50),
    address TEXT,
    country VARCHAR(2) NOT NULL,
    plan VARCHAR(30) NOT NULL,
    contact_email VARCHAR(200),
    is_active BOOLEAN NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id)
);

CREATE INDEX ix_organizations_eori ON organizations (eori);

CREATE TYPE productstatus AS ENUM ('active', 'archived');

CREATE TABLE products (
    id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL,
    name VARCHAR(200) NOT NULL,
    commodity VARCHAR(50) NOT NULL,
    hs_code VARCHAR(15),
    description TEXT,
    status productstatus NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
    CONSTRAINT uq_product_org_name_commodity UNIQUE (organization_id, name, commodity)
);

CREATE INDEX ix_products_commodity ON products (commodity);

CREATE INDEX ix_products_organization_id ON products (organization_id);

CREATE TYPE suppliertype AS ENUM ('producer', 'cooperative', 'trader', 'processor', 'other');

CREATE TYPE supplierstatus AS ENUM ('pending', 'active', 'suspended', 'archived');

CREATE TYPE supplierriskrating AS ENUM ('unknown', 'low', 'medium', 'high');

CREATE TABLE suppliers (
    id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL,
    name VARCHAR(200) NOT NULL,
    legal_name VARCHAR(250),
    supplier_type suppliertype NOT NULL,
    status supplierstatus NOT NULL,
    country VARCHAR(2) NOT NULL,
    address TEXT,
    region VARCHAR(150),
    email VARCHAR(250),
    phone VARCHAR(50),
    website VARCHAR(250),
    tax_id VARCHAR(100),
    registration_number VARCHAR(100),
    eori VARCHAR(50),
    contact_name VARCHAR(200),
    contact_email VARCHAR(250),
    contact_phone VARCHAR(50),
    risk_rating supplierriskrating NOT NULL,
    notes TEXT,
    portal_enabled BOOLEAN NOT NULL,
    invite_token VARCHAR(64),
    invite_sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
    CONSTRAINT uq_supplier_org_name_country UNIQUE (organization_id, name, country)
);

CREATE INDEX ix_suppliers_country ON suppliers (country);

CREATE UNIQUE INDEX ix_suppliers_invite_token ON suppliers (invite_token);

CREATE INDEX ix_suppliers_name ON suppliers (name);

CREATE INDEX ix_suppliers_organization_id ON suppliers (organization_id);

CREATE TYPE shipmentstatus AS ENUM ('draft', 'awaiting_data', 'analyzed', 'ready', 'rejected');

CREATE TABLE shipments (
    id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL,
    reference VARCHAR(100) NOT NULL,
    supplier_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    quantity NUMERIC(18, 4),
    unit VARCHAR(20),
    country_of_production VARCHAR(2),
    harvest_date DATE,
    received_date DATE,
    notes TEXT,
    status shipmentstatus NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE RESTRICT,
    FOREIGN KEY(supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT
);

CREATE INDEX ix_shipments_country_of_production ON shipments (country_of_production);

CREATE INDEX ix_shipments_organization_id ON shipments (organization_id);

CREATE INDEX ix_shipments_product_id ON shipments (product_id);

CREATE INDEX ix_shipments_reference ON shipments (reference);

CREATE INDEX ix_shipments_supplier_id ON shipments (supplier_id);

CREATE TYPE userrole AS ENUM ('admin', 'compliance', 'procurement', 'analyst', 'viewer', 'supplier');

CREATE TABLE users (
    id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36),
    supplier_id VARCHAR(36),
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(512),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(50),
    role userrole NOT NULL,
    locale VARCHAR(5) NOT NULL,
    is_active BOOLEAN NOT NULL,
    email_verified_at TIMESTAMP WITH TIME ZONE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    refresh_token_jti VARCHAR(128),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
    FOREIGN KEY(supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX ix_users_email ON users (email);

CREATE INDEX ix_users_organization_id ON users (organization_id);

CREATE INDEX ix_users_supplier_id ON users (supplier_id);

CREATE TYPE alertlevel AS ENUM ('info', 'success', 'warning', 'critical');

CREATE TYPE alertcategory AS ENUM ('onboarding', 'plot', 'document', 'supplier', 'analysis', 'dds', 'compliance', 'system');

CREATE TABLE alerts (
    id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36),
    level alertlevel NOT NULL,
    category alertcategory NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT,
    link VARCHAR(300),
    context JSONB NOT NULL,
    is_read BOOLEAN NOT NULL,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_alerts_organization_id ON alerts (organization_id);

CREATE INDEX ix_alerts_user_id ON alerts (user_id);

CREATE TABLE audit_events (
    id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL,
    actor_user_id VARCHAR(36),
    action VARCHAR(100) NOT NULL,
    object_type VARCHAR(60) NOT NULL,
    object_id VARCHAR(36) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    ip_address VARCHAR(64),
    user_agent VARCHAR(500),
    previous_data JSONB,
    new_data JSONB,
    PRIMARY KEY (id),
    FOREIGN KEY(actor_user_id) REFERENCES users (id) ON DELETE SET NULL,
    FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE CASCADE
);

CREATE INDEX ix_audit_events_action ON audit_events (action);

CREATE INDEX ix_audit_events_actor_user_id ON audit_events (actor_user_id);

CREATE INDEX ix_audit_events_object_id ON audit_events (object_id);

CREATE INDEX ix_audit_events_object_type ON audit_events (object_type);

CREATE INDEX ix_audit_events_occurred_at ON audit_events (occurred_at);

CREATE INDEX ix_audit_events_organization_id ON audit_events (organization_id);

CREATE TYPE plotsource AS ENUM ('manual', 'geojson', 'kml', 'csv', 'gps', 'supplier');

CREATE TYPE plotstatus AS ENUM ('draft', 'validating', 'valid', 'invalid', 'analyzed', 'rejected');

CREATE TABLE plots (
    id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL,
    shipment_id VARCHAR(36) NOT NULL,
    internal_ref VARCHAR(100),
    name VARCHAR(200),
    notes TEXT,
    source plotsource NOT NULL,
    geometry JSONB,
    geometry_type VARCHAR(30),
    area_ha FLOAT,
    declared_area_ha FLOAT,
    vertex_count INTEGER,
    centroid JSONB,
    bbox JSONB,
    min_decimals_found INTEGER,
    precision_ok BOOLEAN NOT NULL,
    eudr_geometry_rule VARCHAR(30),
    harvest_year INTEGER,
    acquired_at TIMESTAMP WITH TIME ZONE,
    gps_accuracy_m FLOAT,
    status plotstatus NOT NULL,
    validation_errors JSONB,
    validation_warnings JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
    FOREIGN KEY(shipment_id) REFERENCES shipments (id) ON DELETE CASCADE,
    CONSTRAINT uq_plot_shipment_ref UNIQUE (shipment_id, internal_ref)
);

CREATE INDEX ix_plots_organization_id ON plots (organization_id);

CREATE INDEX ix_plots_shipment_id ON plots (shipment_id);

CREATE TABLE supplier_invitations (
    id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL,
    supplier_id VARCHAR(36) NOT NULL,
    created_by_user_id VARCHAR(36),
    target_email VARCHAR(250) NOT NULL,
    purpose VARCHAR(20) NOT NULL,
    jti_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE,
    consumed_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (id),
    FOREIGN KEY(created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
    FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
    FOREIGN KEY(supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE
);

CREATE INDEX ix_supplier_invitations_created_by_user_id ON supplier_invitations (created_by_user_id);

CREATE INDEX ix_supplier_invitations_expires_at ON supplier_invitations (expires_at);

CREATE UNIQUE INDEX ix_supplier_invitations_jti_hash ON supplier_invitations (jti_hash);

CREATE INDEX ix_supplier_invitations_organization_id ON supplier_invitations (organization_id);

CREATE INDEX ix_supplier_invitations_supplier_id ON supplier_invitations (supplier_id);

CREATE INDEX ix_supplier_invitations_target_email ON supplier_invitations (target_email);

INSERT INTO alembic_version (version_num) VALUES ('20260925_0001') RETURNING alembic_version.version_num;

-- Running upgrade 20260925_0001 -> 20260926_0002

CREATE TABLE documents (
    id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL,
    created_by_user_id VARCHAR(36),
    title VARCHAR(200) NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT,
    issuer_name VARCHAR(200),
    reference_number VARCHAR(120),
    issued_at DATE,
    expires_at DATE,
    country_code VARCHAR(2),
    commodity_code VARCHAR(50),
    current_version_number INTEGER NOT NULL,
    review_status VARCHAR(20) DEFAULT 'to_review' NOT NULL,
    review_note TEXT,
    supplier_visible BOOLEAN DEFAULT false NOT NULL,
    is_archived BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT ck_documents_review_status CHECK (review_status IN ('to_review', 'reviewed', 'follow_up')),
    FOREIGN KEY(created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
    FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE CASCADE
);

CREATE INDEX ix_documents_organization_id ON documents (organization_id);

CREATE INDEX ix_documents_created_by_user_id ON documents (created_by_user_id);

CREATE INDEX ix_documents_category ON documents (category);

CREATE INDEX ix_documents_org_expires ON documents (organization_id, expires_at);

CREATE TABLE document_versions (
    id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL,
    document_id VARCHAR(36) NOT NULL,
    uploaded_by_user_id VARCHAR(36),
    version_number INTEGER NOT NULL,
    storage_key VARCHAR(500) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(120) NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    sha256 VARCHAR(64) NOT NULL,
    scan_status VARCHAR(20) DEFAULT 'clean' NOT NULL,
    scanner_name VARCHAR(80) DEFAULT 'ClamAV' NOT NULL,
    scanned_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT ck_document_version_positive_size CHECK (file_size_bytes > 0),
    CONSTRAINT ck_document_version_scan_status CHECK (scan_status IN ('clean', 'infected', 'error')),
    FOREIGN KEY(document_id) REFERENCES documents (id) ON DELETE CASCADE,
    FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
    FOREIGN KEY(uploaded_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT uq_document_version_number UNIQUE (document_id, version_number),
    CONSTRAINT uq_document_version_storage_key UNIQUE (storage_key)
);

CREATE INDEX ix_document_versions_organization_id ON document_versions (organization_id);

CREATE INDEX ix_document_versions_document_id ON document_versions (document_id);

CREATE INDEX ix_document_versions_uploaded_by_user_id ON document_versions (uploaded_by_user_id);

CREATE INDEX ix_document_versions_sha256 ON document_versions (sha256);

CREATE INDEX ix_document_versions_org_doc ON document_versions (organization_id, document_id);

CREATE TABLE document_links (
    id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL,
    document_id VARCHAR(36) NOT NULL,
    target_type VARCHAR(20) NOT NULL,
    target_id VARCHAR(36) NOT NULL,
    created_by_user_id VARCHAR(36),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT ck_document_link_target_type CHECK (target_type IN ('supplier', 'shipment', 'product', 'plot')),
    FOREIGN KEY(created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
    FOREIGN KEY(document_id) REFERENCES documents (id) ON DELETE CASCADE,
    FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
    CONSTRAINT uq_document_link_target UNIQUE (document_id, target_type, target_id)
);

CREATE INDEX ix_document_links_organization_id ON document_links (organization_id);

CREATE INDEX ix_document_links_document_id ON document_links (document_id);

CREATE INDEX ix_document_links_org_target ON document_links (organization_id, target_type, target_id);

CREATE TABLE document_checklist_items (
    id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL,
    created_by_user_id VARCHAR(36),
    scope_type VARCHAR(20) DEFAULT 'organization' NOT NULL,
    scope_id VARCHAR(36),
    title VARCHAR(200) NOT NULL,
    category VARCHAR(50) NOT NULL,
    country_code VARCHAR(2),
    commodity_code VARCHAR(50),
    source_title VARCHAR(200),
    source_url VARCHAR(500),
    note TEXT,
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT ck_document_checklist_scope_type CHECK (scope_type IN ('organization', 'supplier', 'shipment', 'product', 'plot')),
    CONSTRAINT ck_document_checklist_scope_id CHECK ((scope_type = 'organization' AND scope_id IS NULL) OR (scope_type <> 'organization' AND scope_id IS NOT NULL)),
    FOREIGN KEY(created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
    FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE CASCADE
);

CREATE INDEX ix_document_checklist_items_organization_id ON document_checklist_items (organization_id);

CREATE INDEX ix_document_checklist_items_created_by_user_id ON document_checklist_items (created_by_user_id);

CREATE INDEX ix_document_checklist_org_active ON document_checklist_items (organization_id, is_active);

UPDATE alembic_version SET version_num='20260926_0002' WHERE alembic_version.version_num = '20260925_0001';

COMMIT;
