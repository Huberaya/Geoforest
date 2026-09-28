"use client";
import { useState, useEffect, type FormEvent } from "react";
import { Dialog, CountrySelect, Lookup } from "./controls";
import {
  type Api,
  type Catalogue,
  type Supplier,
  type Product,
  type Lot,
  type Collection,
} from "./types";
export type Kind = "suppliers" | "products" | "lots";
export type SupplyRecord = Supplier | Product | Lot;
export function RecordForm({
  kind,
  record,
  catalogue,
  api,
  onClose,
  onSaved,
}: {
  kind: Kind;
  record?: SupplyRecord;
  catalogue: Catalogue;
  api: Api;
  onClose: () => void;
  onSaved: () => void;
}) {
  const s = record as Supplier | undefined,
    p = record as Product | undefined,
    l = record as Lot | undefined;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [supplierIds, setSupplierIds] = useState<string[]>(
    kind === "products"
      ? p?.supplier_ids || []
      : l?.supplier_id
        ? [l.supplier_id]
        : [],
  );
  const [productIds, setProductIds] = useState<string[]>(
    l?.product_id ? [l.product_id] : [],
  );
  const [commodities, setCommodities] = useState<string[]>(
    p?.commodities || [],
  );
  const [sources, setSources] = useState<Collection[]>([]),
    [source, setSource] = useState(l?.source_collection_id || "");
  const [sourceError, setSourceError] = useState("");
  const supplierId = supplierIds[0];
  useEffect(() => {
    if (kind !== "lots" || !supplierId) return;
    const ctrl = new AbortController();
    api("/suppliers/" + supplierId, "GET", undefined, ctrl.signal)
      .then((result) => {
        const data = result as { collections: Collection[] };
        setSources(data.collections.filter((c) => c.status === "REVIEWED"));
        setSourceError("");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setSourceError(e.message);
      });
    return () => ctrl.abort();
  }, [api, kind, supplierId]);
  function supplierChanged(ids: string[]) {
    setSupplierIds(ids);
    setProductIds([]);
    setSource("");
    setSources([]);
    setSourceError("");
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) || "").trim();
    try {
      let body: Record<string, unknown> = { reference: get("reference") };
      if (kind === "suppliers")
        body = {
          ...body,
          name: get("name"),
          country: get("country") || null,
          email: get("email"),
          address: get("address"),
          legal_type: get("legal_type"),
          registration_id: get("registration_id"),
          notes: get("notes"),
        };
      if (kind === "products") {
        if (!commodities.length)
          throw new Error("Sélectionnez au moins une matière déclarée.");
        body = {
          ...body,
          name: get("name"),
          hs_code: get("hs_code"),
          description: get("description"),
          commodities,
          supplier_ids: supplierIds,
        };
      }
      if (kind === "lots") {
        if (!supplierIds.length || !productIds.length)
          throw new Error("Choisissez un fournisseur et un produit associé.");
        body = {
          ...body,
          supplier_id: supplierIds[0],
          product_id: productIds[0],
          quantity: get("quantity").replace(",", "."),
          unit: get("unit"),
          origin_country: get("origin_country") || null,
          production_start: get("production_start") || null,
          production_end: get("production_end") || null,
          source_collection_id: source || null,
          notes: get("notes"),
        };
      }
      await api(
        "/" + kind + (record ? "/" + record.id : ""),
        record ? "PUT" : "POST",
        record ? { ...body, version: record.version } : body,
      );
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const singular =
    kind === "suppliers"
      ? "fournisseur"
      : kind === "products"
        ? "produit"
        : "lot";
  return (
    <Dialog
      title={(record ? "Modifier le " : "Ajouter un ") + singular}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit} className="record-form">
        {error && (
          <div className="message error" role="alert">
            {error}
          </div>
        )}
        <p className="muted">
          Les champs marqués * sont nécessaires à la création. Une fiche
          incomplète reste identifiable comme telle.
        </p>
        <div className="form-grid">
          <label>
            Référence interne *
            <input
              name="reference"
              defaultValue={record?.reference}
              required
              minLength={2}
              maxLength={40}
              pattern="[A-Za-z0-9][A-Za-z0-9._/\-]+"
              placeholder={
                kind === "suppliers"
                  ? "FOUR-001"
                  : kind === "products"
                    ? "PROD-001"
                    : "LOT-001"
              }
            />
          </label>
          {kind !== "lots" && (
            <label>
              {kind === "suppliers"
                ? "Nom de l’organisation"
                : "Nom du produit"}{" "}
              *
              <input
                name="name"
                defaultValue={kind === "suppliers" ? s?.name : p?.name}
                required
                minLength={2}
                maxLength={200}
              />
            </label>
          )}
        </div>
        {kind === "suppliers" && (
          <>
            <div className="form-grid">
              <CountrySelect
                name="country"
                catalogue={catalogue}
                defaultValue={s?.country || ""}
              />
              <label>
                Type d’organisation
                <select
                  name="legal_type"
                  defaultValue={s?.legal_type || "unknown"}
                >
                  <option value="unknown">À préciser</option>
                  <option value="cooperative">Coopérative</option>
                  <option value="company">Entreprise</option>
                  <option value="individual">Producteur individuel</option>
                </select>
              </label>
            </div>
            <label>
              Email de l’organisation
              <input
                type="email"
                name="email"
                maxLength={320}
                defaultValue={s?.email}
              />
            </label>
            <label>
              Adresse
              <textarea
                name="address"
                rows={2}
                maxLength={1000}
                defaultValue={s?.address}
              />
            </label>
            <label>
              Identifiant d’immatriculation
              <input
                name="registration_id"
                maxLength={100}
                defaultValue={s?.registration_id}
              />
            </label>
            <label>
              Notes internes
              <textarea
                name="notes"
                maxLength={2000}
                rows={2}
                defaultValue={s?.notes}
              />
            </label>
            <p className="caption">
              Les contacts individuels et l’invitation au portail se gèrent dans
              la fiche fournisseur.
            </p>
          </>
        )}
        {kind === "products" && (
          <>
            <fieldset className="commodity-picker">
              <legend>Matières déclarées *</legend>
              {catalogue.commodities.map((c) => (
                <label key={c.code}>
                  <input
                    type="checkbox"
                    checked={commodities.includes(c.code)}
                    onChange={(e) =>
                      setCommodities(
                        e.target.checked
                          ? [...commodities, c.code]
                          : commodities.filter((v) => v !== c.code),
                      )
                    }
                  />
                  {c.label}
                </label>
              ))}
            </fieldset>
            <label>
              Code SH / NC déclaré
              <input
                name="hs_code"
                inputMode="numeric"
                defaultValue={p?.hs_code}
                maxLength={8}
                pattern="([0-9]{4}|[0-9]{6}|[0-9]{8})?"
                placeholder="4, 6 ou 8 chiffres — facultatif"
              />
            </label>
            <p className="caption">
              Aucun code n’est déduit automatiquement d’une matière. Le
              classement réglementaire reste à qualifier.
            </p>
            <Lookup
              api={api}
              kind="suppliers"
              label="Fournisseurs associés"
              multiple
              value={supplierIds}
              onChange={setSupplierIds}
            />
            <label>
              Description
              <textarea
                name="description"
                maxLength={2000}
                rows={2}
                defaultValue={p?.description}
              />
            </label>
          </>
        )}
        {kind === "lots" && (
          <>
            <Lookup
              api={api}
              kind="suppliers"
              label="Fournisseur du lot"
              required
              value={supplierIds}
              onChange={(ids) => void supplierChanged(ids)}
            />
            {supplierIds.length > 0 && (
              <Lookup
                key={supplierIds[0]}
                api={api}
                kind="products"
                label="Produit fourni"
                required
                value={productIds}
                onChange={setProductIds}
                supplierId={supplierIds[0]}
              />
            )}
            <p className="caption">
              Le produit doit être associé au fournisseur dans le référentiel
              Produits.
            </p>
            <div className="form-grid">
              <label>
                Quantité *
                <input
                  name="quantity"
                  defaultValue={l?.quantity}
                  required
                  inputMode="decimal"
                  pattern="[0-9]+([.,][0-9]{1,6})?"
                  placeholder="Ex. 2500,5"
                />
              </label>
              <label>
                Unité *
                <select name="unit" defaultValue={l?.unit || "KG"}>
                  {catalogue.units.map((u) => (
                    <option key={u} value={u}>
                      {
                        (
                          {
                            KG: "Kilogrammes",
                            T: "Tonnes",
                            M3: "Mètres cubes",
                            PCS: "Pièces",
                          } as Record<string, string>
                        )[u]
                      }
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <CountrySelect
              name="origin_country"
              label="Pays de production déclaré"
              catalogue={catalogue}
              defaultValue={l?.origin_country || ""}
            />
            <div className="form-grid">
              <label>
                Début de production
                <input
                  type="date"
                  name="production_start"
                  defaultValue={l?.production_start || ""}
                />
              </label>
              <label>
                Fin de production
                <input
                  type="date"
                  name="production_end"
                  defaultValue={l?.production_end || ""}
                />
              </label>
            </div>
            <label>
              Collecte fournisseur source
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="">Aucune collecte rattachée</option>
                {source && !sources.some((c) => c.id === source) && (
                  <option value={source}>Collecte source actuelle</option>
                )}
                {sources.map((c) => (
                  <option key={c.id} value={c.id}>
                    Collecte revue ·{" "}
                    {c.submitted_at
                      ? new Date(c.submitted_at).toLocaleDateString("fr-FR")
                      : c.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            {sourceError && (
              <p role="alert" className="inline-error">
                {sourceError}
              </p>
            )}
            <p className="caption">
              Rattachement facultatif à une collecte revue du même fournisseur.
              Il ne prouve pas la conformité du lot.
            </p>
            <label>
              Notes internes
              <textarea
                name="notes"
                defaultValue={l?.notes}
                maxLength={2000}
                rows={2}
              />
            </label>
          </>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Annuler
          </button>
          <button className="button primary" disabled={busy}>
            {busy
              ? "Enregistrement…"
              : "Enregistrer " +
                (kind === "suppliers"
                  ? "le fournisseur"
                  : kind === "products"
                    ? "le produit"
                    : "le lot")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
