import {
  bigserial,
  boolean,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * 1. Organisations (Tenants B2B)
 */
export const organizations = pgTable(
  "gf_organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    eori: text("eori"),
    country: text("country").notNull().default("FR"),
    address: text("address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_gf_organizations_slug").on(table.slug)],
);

/**
 * 2. Utilisateurs & Rôles
 *
 * Colonnes d'authentification ajoutées dans le cadre du chantier P0-01.
 */
export const users = pgTable(
  "gf_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: text("role").notNull().default("compliance_officer"), // admin, compliance_officer, auditor, viewer, supplier
    status: text("status").notNull().default("active"), // active, suspended, invited
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

    // --- Authentification (P0-01) -------------------------------------------
    /** Format `scrypt:N:r:p:salt:hash`. Null = compte invité, mot de passe à définir. */
    passwordHash: text("password_hash"),
    passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }),
    /** Incrémenté pour révoquer toutes les sessions (changement de mot de passe, verrouillage). */
    tokenVersion: integer("token_version").notNull().default(0),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),

    // --- Double authentification (TOTP RFC 6238) ----------------------------
    /** Secret TOTP (base32). Null tant que la MFA n'est pas activée. */
    mfaSecret: text("mfa_secret"),
    mfaEnabledAt: timestamp("mfa_enabled_at", { withTimezone: true }),
    /** Codes de secours à usage unique, stockés hachés (SHA-256). */
    mfaRecoveryCodes: jsonb("mfa_recovery_codes").$type<string[]>(),
  },
  (table) => [
    index("idx_gf_users_org").on(table.organizationId),
    index("idx_gf_users_email").on(table.email),
    index("idx_gf_users_org_email").on(table.organizationId, table.email),
  ],
);

/**
 * 2 bis. Sessions (jetons de rafraîchissement)
 *
 * Le jeton d'accès est un JWT sans état ; le jeton de rafraîchissement est
 * opaque, stocké **haché**, et permet la révocation immédiate.
 */
export const sessions = pgTable(
  "gf_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 du jeton opaque : le jeton en clair n'est jamais conservé. */
    refreshTokenHash: text("refresh_token_hash").notNull().unique(),
    familyId: uuid("family_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedBy: uuid("replaced_by"),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_gf_sessions_user").on(table.userId),
    index("idx_gf_sessions_family").on(table.familyId),
    index("idx_gf_sessions_hash").on(table.refreshTokenHash),
  ],
);

/**
 * 2 ter. Tentatives de connexion (limitation de débit persistante)
 */
export const loginAttempts = pgTable(
  "gf_login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Clé de fenêtre : adresse IP + email normalisé. */
    windowKey: text("window_key").notNull(),
    attempts: integer("attempts").notNull().default(0),
    firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_gf_login_attempts_key").on(table.windowKey)],
);

/**
 * 3. Fournisseurs (Suppliers)
 */
export const suppliers = pgTable(
  "gf_suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    eori: text("eori"),
    country: text("country").notNull().default("CI"),
    commodity: text("commodity").notNull(), // cocoa, coffee, palm_oil, rubber, soya, cattle, wood
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    completenessScore: integer("completeness_score").notNull().default(0), // 0 to 100%
    riskLevel: text("risk_level").notNull().default("STANDARD"), // LOW, STANDARD, HIGH, CRITICAL
    status: text("status").notNull().default("ACTIVE"), // ACTIVE, PENDING_INVITE, SUSPENDED
    plotsCount: integer("plots_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // ------------------------------------------------------------------ P1-10
    // Suppression **logique**. Une suppression physique efface la preuve avec
    // la ligne : un contrôle qui demande « quelle pièce était jointe à cette
    // date » devient impossible à satisfaire, et l'effacement est indiscernable
    // d'une manipulation. La ligne est donc marquée, jamais détruite — elle ne
    // disparaît du produit que parce que la politique RLS l'exclut.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
  },
  (table) => [
    index("idx_gf_suppliers_org").on(table.organizationId),
    unique("uq_gf_suppliers_tenant").on(table.id, table.organizationId),
    index("idx_gf_suppliers_org_created").on(table.organizationId, table.createdAt),
  ],
);

/**
 * 4. Produits / Matières premières
 */
export const products = pgTable(
  "gf_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sku: text("sku"),
    commodity: text("commodity").notNull(),
    hsCode: text("hs_code").notNull(),
    countryOfOrigin: text("country_of_origin").notNull().default("FR"),
    annualVolumeKg: doublePrecision("annual_volume_kg").default(0),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // ------------------------------------------------------------------ P1-10
    // Suppression **logique**. Une suppression physique efface la preuve avec
    // la ligne : un contrôle qui demande « quelle pièce était jointe à cette
    // date » devient impossible à satisfaire, et l'effacement est indiscernable
    // d'une manipulation. La ligne est donc marquée, jamais détruite — elle ne
    // disparaît du produit que parce que la politique RLS l'exclut.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
  },
  (table) => [
    index("idx_gf_products_org").on(table.organizationId),
    unique("uq_gf_products_tenant").on(table.id, table.organizationId),
    index("idx_gf_products_org_created").on(table.organizationId, table.createdAt),
  ],
);

/**
 * 5. Lots & Expéditions (Shipments)
 */
export const shipments = pgTable(
  "gf_shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    reference: text("reference").notNull(),
    netWeightKg: doublePrecision("net_weight_kg").notNull().default(0),
    harvestDate: text("harvest_date").notNull(),
    customsDeclarationRef: text("customs_declaration_ref"),
    status: text("status").notNull().default("IN_PREPARATION"), // IN_PREPARATION, AUDITED, READY, SHIPPED
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // ------------------------------------------------------------------ P1-10
    // Suppression **logique**. Une suppression physique efface la preuve avec
    // la ligne : un contrôle qui demande « quelle pièce était jointe à cette
    // date » devient impossible à satisfaire, et l'effacement est indiscernable
    // d'une manipulation. La ligne est donc marquée, jamais détruite — elle ne
    // disparaît du produit que parce que la politique RLS l'exclut.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
  },
  (table) => [
    index("idx_gf_shipments_org").on(table.organizationId),
    unique("uq_gf_shipments_tenant").on(table.id, table.organizationId),
    index("idx_gf_shipments_org_created").on(table.organizationId, table.createdAt),
    foreignKey({ columns: [table.supplierId, table.organizationId], foreignColumns: [suppliers.id, suppliers.organizationId], name: "fk_gf_shipments_supplier_tenant" }).onDelete("set null"),
    foreignKey({ columns: [table.productId, table.organizationId], foreignColumns: [products.id, products.organizationId], name: "fk_gf_shipments_product_tenant" }).onDelete("set null"),
  ],
);

/**
 * 6. Parcelles SIG & Données Géographiques
 */
export const plots = pgTable(
  "gf_plots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    reference: text("reference"),
    commodity: text("commodity").notNull(),
    countryCode: text("country_code").notNull().default("XX"),
    geometry: jsonb("geometry").notNull(),
    geometryType: text("geometry_type").notNull(),
    areaHa: doublePrecision("area_ha").notNull().default(0),
    vertexCount: integer("vertex_count").notNull().default(0),
    centroidLon: doublePrecision("centroid_lon").notNull().default(0),
    centroidLat: doublePrecision("centroid_lat").notNull().default(0),
    status: text("status").notNull().default("PENDING"), // COMPLIANT, NON_COMPLIANT, INVALID_GEOMETRY, PENDING
    riskLevel: text("risk_level").notNull().default("STANDARD"),
    lossYear: integer("loss_year"),
    confidenceScore: doublePrecision("confidence_score").default(0),
    lastAuditAt: timestamp("last_audit_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // ------------------------------------------------------------------ P1-10
    // Suppression **logique**. Une suppression physique efface la preuve avec
    // la ligne : un contrôle qui demande « quelle pièce était jointe à cette
    // date » devient impossible à satisfaire, et l'effacement est indiscernable
    // d'une manipulation. La ligne est donc marquée, jamais détruite — elle ne
    // disparaît du produit que parce que la politique RLS l'exclut.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
  },
  (table) => [
    index("idx_gf_plots_org").on(table.organizationId),
    unique("uq_gf_plots_tenant").on(table.id, table.organizationId),
    index("idx_gf_plots_org_created").on(table.organizationId, table.createdAt),
    foreignKey({ columns: [table.supplierId, table.organizationId], foreignColumns: [suppliers.id, suppliers.organizationId], name: "fk_gf_plots_supplier_tenant" }).onDelete("set null"),
  ],
);

/**
 * 7. Coffre Documentaire Légalité & Certificats
 */
export const documents = pgTable(
  "gf_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    plotId: uuid("plot_id").references(() => plots.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    category: text("category").notNull(), // LAND_TENURE, HARVEST_PERMIT, TAX_CLEARANCE, LABOR_COMPLIANCE, CERTIFICATE_FSC_PEFC
    fileName: text("file_name").notNull(),
    fileUrl: text("file_url"),
    fileSize: integer("file_size").default(0),
    expiryDate: text("expiry_date"),
    // ---------------------------------------------------------------- P1-02
    // Métadonnées du fichier **réellement** déposé. Nullables : un document
    // peut être déclaré avant que sa pièce ne soit disponible, et « aucune
    // pièce » doit rester un état représentable.
    /** Emplacement de l'objet dans le support. Opaque. */
    storageKey: text("storage_key"),
    /** Condensat SHA-256 du contenu, hexadécimal. */
    sha256: text("sha256"),
    /** Taille mesurée à la lecture, en octets — jamais celle annoncée. */
    sizeBytes: integer("size_bytes"),
    /** Type lu dans les octets (nombres magiques), pas celui déclaré. */
    mimeDetected: text("mime_detected"),
    /** Type annoncé par le client, conservé pour pouvoir le confronter. */
    mimeDeclared: text("mime_declared"),
    /**
     * Vrai si le type annoncé ne correspond pas aux octets.
     *
     * Stocké et non recalculé à l'affichage : la règle qui décide ce qui est
     * un mensonge (cf. `ecartDeType`) est volontairement nuancée — un envoi en
     * `application/octet-stream` n'est pas une tromperie. Figer le résultat au
     * dépôt évite qu'une évolution de la règle ne réécrive l'histoire d'une
     * pièce déjà versée au dossier.
     */
    mimeMismatch: boolean("mime_mismatch").notNull().default(false),
    /** Numéro de version courante. Un dépôt sur un document existant l'incrémente. */
    version: integer("version").notNull().default(1),
    /**
     * Résultat de l'analyse antivirus.
     * `NOT_SCANNED` signifie « aucun moteur n'a été interrogé » — ce n'est pas
     * une affirmation de salubrité, et l'interface ne doit pas le présenter
     * comme tel (cf. `src/lib/storage/antivirus.ts`).
     */
    scanStatus: text("scan_status").notNull().default("NOT_SCANNED"),
    scanDetail: text("scan_detail"),
    scanMoteur: text("scan_moteur"),
    uploadedBy: text("uploaded_by"),
    status: text("status").notNull().default("TO_VERIFY"), // VALID, EXPIRED, TO_VERIFY, REJECTED
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // ------------------------------------------------------------------ P1-10
    // Suppression **logique**. Une suppression physique efface la preuve avec
    // la ligne : un contrôle qui demande « quelle pièce était jointe à cette
    // date » devient impossible à satisfaire, et l'effacement est indiscernable
    // d'une manipulation. La ligne est donc marquée, jamais détruite — elle ne
    // disparaît du produit que parce que la politique RLS l'exclut.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
  },
  (table) => [
    index("idx_gf_documents_org").on(table.organizationId),
    index("idx_gf_documents_org_created").on(table.organizationId, table.createdAt),
    // P1-02 — requis par la clé étrangère composite de `gf_document_versions` :
    // PostgreSQL exige que la paire référencée soit unique. La même convention
    // `uq_*_tenant` est déjà appliquée aux parcelles, fournisseurs et produits ;
    // elle manquait ici, ce qui n'avait jamais été remarqué faute de table
    // fille. Elle garantit aussi, par la structure, qu'une version ne peut pas
    // rattacher un document à une autre organisation.
    unique("uq_gf_documents_tenant").on(table.id, table.organizationId),
    foreignKey({ columns: [table.supplierId, table.organizationId], foreignColumns: [suppliers.id, suppliers.organizationId], name: "fk_gf_documents_supplier_tenant" }).onDelete("set null"),
    foreignKey({ columns: [table.plotId, table.organizationId], foreignColumns: [plots.id, plots.organizationId], name: "fk_gf_documents_plot_tenant" }).onDelete("set null"),
  ],
);

/**
 * 8. Dossiers de Diligence Raisonnée (DDR / Due Diligence Statements)
 */
export const dueDiligenceStatements = pgTable(
  "gf_due_diligence_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    title: text("title").notNull(),
    commodity: text("commodity").notNull(),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    status: text("status").notNull().default("DRAFT"),
    // DRAFT, MISSING_DATA, IN_ANALYSIS, UNDER_REVIEW, RISK_IDENTIFIED, ACTION_REQUIRED, READY_FOR_DECLARATION, DECLARED, ARCHIVED
    riskLevel: text("risk_level").notNull().default("STANDARD"),
    completenessScore: integer("completeness_score").notNull().default(0),
    plotsCount: integer("plots_count").notNull().default(0),
    totalAreaHa: doublePrecision("total_area_ha").notNull().default(0),
    netWeightKg: doublePrecision("net_weight_kg").notNull().default(0),
    tracesPayloadJson: jsonb("traces_payload_json"),
    tracesReference: text("traces_reference"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // ------------------------------------------------------------------ P1-10
    // Suppression **logique**. Une suppression physique efface la preuve avec
    // la ligne : un contrôle qui demande « quelle pièce était jointe à cette
    // date » devient impossible à satisfaire, et l'effacement est indiscernable
    // d'une manipulation. La ligne est donc marquée, jamais détruite — elle ne
    // disparaît du produit que parce que la politique RLS l'exclut.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
  },
  (table) => [
    index("idx_gf_dds_org").on(table.organizationId),
    unique("uq_gf_dds_tenant").on(table.id, table.organizationId),
    index("idx_gf_dds_org_created").on(table.organizationId, table.createdAt),
    foreignKey({ columns: [table.supplierId, table.organizationId], foreignColumns: [suppliers.id, suppliers.organizationId], name: "fk_gf_dds_supplier_tenant" }).onDelete("set null"),
    foreignKey({ columns: [table.productId, table.organizationId], foreignColumns: [products.id, products.organizationId], name: "fk_gf_dds_product_tenant" }).onDelete("set null"),
  ],
);

/**
 * 9. Risques & Tâches d'Atténuation (Compliance Tasks)
 */
export const complianceTasks = pgTable(
  "gf_compliance_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    diligenceId: uuid("diligence_id").references(() => dueDiligenceStatements.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    severity: text("severity").notNull().default("MEDIUM"), // LOW, MEDIUM, HIGH, CRITICAL
    status: text("status").notNull().default("TO_HANDLE"), // TO_HANDLE, IN_PROGRESS, RESOLVED, VALIDATED
    assignee: text("assignee"),
    dueDate: text("due_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // ------------------------------------------------------------------ P1-10
    // Suppression **logique** (cf. `gf_plots`).
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
  },
  (table) => [
    index("idx_gf_tasks_org").on(table.organizationId),
    index("idx_gf_tasks_org_created").on(table.organizationId, table.createdAt),
    foreignKey({ columns: [table.diligenceId, table.organizationId], foreignColumns: [dueDiligenceStatements.id, dueDiligenceStatements.organizationId], name: "fk_gf_tasks_dds_tenant" }).onDelete("cascade"),
  ],
);

/**
 * 10. Piste d'Audit Immuable (Audit Log)
 */
export const auditLogs = pgTable(
  "gf_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable : un événement système (échec de connexion sur un compte inconnu)
    // n'appartient à aucune organisation. La politique RLS le rend invisible
    // aux tenants, ce qui est le comportement attendu.
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    userEmail: text("user_email").notNull().default("system"),
    action: text("action").notNull(), // CREATE, UPDATE, AUDIT, EXPORT, TRANSMIT, VALIDATE
    entityType: text("entity_type").notNull(), // SUPPLIER, PLOT, DOCUMENT, DDS, SHIPMENT
    entityId: text("entity_id").notNull(),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    // ------------------------------------------------------------------ P1-10
    // ⚠️ Un journal qui ne dit pas **ce qui a changé** ne sert à rien : il
    //   prouve qu'une modification a eu lieu, pas laquelle. « Le fournisseur a
    //   été modifié » ne répond à aucune question de contrôle ; « le pays est
    //   passé de CI à GH » y répond. L'avant et l'après sont donc conservés
    //   intégralement, et non réduits à la liste des champs touchés.
    avant: jsonb("avant"),
    apres: jsonb("apres"),
    /** Identifiant de l'utilisateur à l'origine de l'action (et non son seul e-mail, qui peut changer). */
    acteurId: uuid("acteur_id"),
    /** Rôle au moment de l'action : la même personne n'a pas les mêmes droits selon son rôle. */
    acteurRole: text("acteur_role"),
    /** Identifiant de corrélation (P1-06) : relie la ligne au journal applicatif. */
    requestId: text("request_id"),

    /**
     * Chaîne de hachage par organisation.
     *
     * ⚠️ Un journal modifiable n'est pas une preuve : la première chose que
     *   fait qui veut dissimuler une action, c'est effacer la ligne qui la
     *   consigne. Le chaînage ne rend pas l'altération impossible — rien ne
     *   l'empêche pour qui tient la base — mais la rend **décelable** : chaque
     *   ligne porte le condensat de la précédente, si bien qu'une ligne
     *   supprimée ou modifiée rompt la chaîne à cet endroit précis. C'est la
     *   différence entre « on ne peut pas savoir » et « on saura ».
     */
    sequence: bigserial("sequence", { mode: "number" }).notNull(),
    hashPrecedent: text("hash_precedent"),
    hash: text("hash"),
  },
  (table) => [
    index("idx_gf_audit_logs_org").on(table.organizationId), index("idx_gf_audit_logs_created_at").on(table.createdAt),
    index("idx_gf_audit_logs_org_created").on(table.organizationId, table.createdAt),
    // Unicité de la chaîne au sein d'une organisation : deux insertions
    // concurrentes ne peuvent pas revendiquer le même rang.
    unique("uq_gf_audit_logs_org_sequence").on(table.organizationId, table.sequence),
  ],
);

/**
 * 11. Table des audits unitaires de parcelles (compatibilité moteur SIG & TRACES)
 */
export const parcelAudits = pgTable(
  "parcel_audits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    operatorName: text("operator_name").notNull(),
    operatorEori: text("operator_eori").notNull(),
    operatorCountry: text("operator_country").notNull().default("FR"),
    operatorAddress: text("operator_address"),
    /**
     * P1-16 — identité du **producteur**, distincte de l'opérateur.
     *
     * L'export de déclaration répétait le nom de l'opérateur dans le nœud
     * `producers`, faute de champ où consigner le producteur : une déclaration
     * désignait donc comme producteur une entité qui n'est pas celle qui a
     * produit la marchandise.
     *
     * Nullables, et c'est essentiel : « nous ne connaissons pas le producteur »
     * est un état qui doit rester représentable. Le remplacer par l'opérateur
     * est exactement le défaut que ce champ corrige.
     */
    producerName: text("producer_name"),
    producerCountry: text("producer_country"),
    commodity: text("commodity").notNull(),
    hsCode: text("hs_code").notNull(),
    harvestDate: text("harvest_date").notNull(),
    parcelReference: text("parcel_reference"),
    geometry: jsonb("geometry").notNull(),
    geometryType: text("geometry_type").notNull(),
    areaHa: doublePrecision("area_ha").notNull().default(0),
    vertexCount: integer("vertex_count").notNull().default(0),
    centroidLon: doublePrecision("centroid_lon").notNull().default(0),
    centroidLat: doublePrecision("centroid_lat").notNull().default(0),
    countryCode: text("country_code").notNull().default("XX"),
    countryRisk: text("country_risk").notNull().default("STANDARD"),
    // `compliant` est nullable : une analyse non probante n'a PAS de verdict,
    // et « pas de verdict » est différent de « non conforme » (P0-04).
    compliant: boolean("compliant"),
    lossYear: integer("loss_year"),
    // Nullable : un score de 0 % serait lu comme une mesure, alors qu'il
    // signifie « aucune confiance calculable ».
    confidenceScore: doublePrecision("confidence_score"),
    // Provenance de l'analyse, conservée avec l'audit : on doit pouvoir
    // relire un audit ancien et savoir s'il reposait sur des données réelles.
    analysisSource: text("analysis_source").notNull().default("unavailable"),
    analysisProbative: boolean("analysis_probative").notNull().default(false),
    analysisEvidence: jsonb("analysis_evidence"),
    // ------------------------------------------------------------------ P1-10
    // ⚠️ Traçabilité de **l'analyse elle-même**, pas seulement de son
    //   résultat. Un verdict de non-déforestation ne vaut que par la méthode
    //   qui l'a produit : relire un audit vieux de trois ans sans savoir quel
    //   moteur l'a calculé, avec quelle version et quels paramètres, c'est
    //   lire un chiffre sans unité. Les limites sont conservées au même titre
    //   que le résultat — un audit qui ne dit pas ce qu'il n'a pas pu mesurer
    //   se fait passer pour plus complet qu'il n'est.
    analysisMethod: text("analysis_method").notNull().default("non_renseignee"),
    analysisVersion: text("analysis_version"),
    analysisParams: jsonb("analysis_params"),
    analysisLimits: jsonb("analysis_limits"),
    riskLevel: text("risk_level").notNull().default("STANDARD"),
    status: text("status").notNull(),
    validation: jsonb("validation").notNull(),
    satellite: jsonb("satellite"),
    // P0-06 : on ne parle plus de « transmission ». L'export produit un
    // BROUILLON au format interne GeoForest, jamais une déclaration déposée.
    draftReference: text("draft_reference"),
    draftGeneratedAt: timestamp("draft_generated_at", { withTimezone: true }),
    /**
     * État de la transmission au système d'information EUDR.
     *
     * `NOT_TRANSMITTED` est la seule valeur que le produit puisse produire
     * aujourd'hui : aucun client EUDR-IS n'est implémenté. Les autres valeurs
     * existent pour que le jour où ce client existera, un audit ancien ne
     * puisse pas être relu comme « transmis » par défaut.
     */
    transmissionStatus: text("transmission_status").notNull().default("NOT_TRANSMITTED"),
    /** Accusé de réception du SI EUDR — NULL tant qu'aucune transmission réelle n'a eu lieu. */
    transmittedAt: timestamp("transmitted_at", { withTimezone: true }),
    transmissionAck: jsonb("transmission_ack"),
  },
  (table) => [
    index("idx_parcel_audits_created_at").on(table.createdAt),
    index("idx_parcel_audits_org_created").on(table.organizationId, table.createdAt),
  ],
);

/**
 * P1-02 — historique des versions d'une pièce justificative.
 *
 * ⚠️ Une nouvelle version ne remplace pas l'ancienne : elle s'ajoute. Un
 * dossier de conformité s'audité après coup, et l'on doit pouvoir établir
 * quelle pièce était jointe à une date donnée. Écraser l'ancien fichier
 * rendrait cette question impossible à trancher.
 */
export const documentVersions = pgTable(
  "gf_document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    fileName: text("file_name").notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    mimeDetected: text("mime_detected").notNull(),
    mimeDeclared: text("mime_declared"),
    scanStatus: text("scan_status").notNull().default("NOT_SCANNED"),
    scanMoteur: text("scan_moteur"),
    uploadedBy: text("uploaded_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_gf_doc_versions_org").on(table.organizationId),
    index("idx_gf_doc_versions_document").on(table.documentId),
    // Deux versions d'un même document ne peuvent pas porter le même numéro.
    uniqueIndex("uq_gf_doc_versions_doc_version").on(table.documentId, table.version),
    // Le cloisonnement est garanti par la structure, pas seulement par les
    // politiques RLS : une version ne peut pas référencer un document d'une
    // autre organisation.
    foreignKey({
      columns: [table.documentId, table.organizationId],
      foreignColumns: [documents.id, documents.organizationId],
      name: "fk_gf_doc_versions_document_tenant",
    }).onDelete("cascade"),
  ],
);

export type ParcelAuditRow = typeof parcelAudits.$inferSelect;
export type NewParcelAuditRow = typeof parcelAudits.$inferInsert;
export type OrganizationRow = typeof organizations.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type SupplierRow = typeof suppliers.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type ShipmentRow = typeof shipments.$inferSelect;
export type PlotRow = typeof plots.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type DueDiligenceRow = typeof dueDiligenceStatements.$inferSelect;
export type ComplianceTaskRow = typeof complianceTasks.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;

