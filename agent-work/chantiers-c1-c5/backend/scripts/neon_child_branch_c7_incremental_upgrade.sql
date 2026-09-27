-- TEST-ONLY incremental DDL from 20260925_0001 to C7 head 20260926_0002.
-- Use only on a disposable Neon child that has been independently verified at 20260925_0001.
-- NEVER run on production. Confirm the Neon branch selector before any execution.

BEGIN;

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
