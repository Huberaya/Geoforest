"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { type Api, type Catalogue, countryName } from "./types";

export function Dialog({
  title,
  children,
  onClose,
  busy = false,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={"supply-dialog" + (wide ? " wide" : "")}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">GEOFOREST TRACE</span>
          <h2>{title}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          disabled={busy}
          aria-label="Fermer la fenêtre"
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function CountrySelect({
  name,
  label = "Pays",
  value,
  defaultValue,
  catalogue,
  required = false,
  onChange,
}: {
  name: string;
  label?: string;
  value?: string;
  defaultValue?: string;
  catalogue: Catalogue;
  required?: boolean;
  onChange?: (v: string) => void;
}) {
  return (
    <label>
      {label}
      {required ? " *" : ""}
      <select
        name={name}
        value={value}
        defaultValue={defaultValue}
        onChange={(e) => onChange?.(e.target.value)}
        required={required}
      >
        <option value="">Non renseigné</option>
        {[...catalogue.countries]
          .sort((a, b) =>
            countryName(a.code).localeCompare(countryName(b.code), "fr"),
          )
          .map((c) => (
            <option key={c.code} value={c.code}>
              {countryName(c.code)}
            </option>
          ))}
      </select>
    </label>
  );
}
export function Lookup({
  api,
  kind,
  label,
  value,
  onChange,
  multiple = false,
  supplierId,
  required = false,
}: {
  api: Api;
  kind: "suppliers" | "products";
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  multiple?: boolean;
  supplierId?: string;
  required?: boolean;
}) {
  const [q, setQ] = useState(""),
    [items, setItems] = useState<
      { id: string; name: string; reference: string }[]
    >([]),
    [total, setTotal] = useState(0),
    [error, setError] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api(
        "/" +
          kind +
          "?limit=50&q=" +
          encodeURIComponent(q) +
          (supplierId ? "&supplier_id=" + supplierId : ""),
        "GET",
        undefined,
        ctrl.signal,
      )
        .then((data) => {
          const d = data as {
            items: { id: string; name: string; reference: string }[];
            total: number;
          };
          setItems(d.items);
          setTotal(d.total);
          setNames((prev) => ({
            ...prev,
            ...Object.fromEntries(d.items.map((x) => [x.id, x.name])),
          }));
          setError("");
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        });
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [api, kind, q, supplierId]);
  return (
    <fieldset className="lookup">
      <legend>
        {label}
        {required ? " *" : ""}
      </legend>
      <input
        aria-label={"Rechercher : " + label}
        type="search"
        placeholder="Rechercher par nom ou référence…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        maxLength={200}
      />
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {multiple ? (
        <>
          <div className="lookup-options">
            {items.map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={value.includes(item.id)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...value, item.id]
                        : value.filter((v) => v !== item.id),
                    )
                  }
                />
                <span>
                  {item.name}
                  <small>{item.reference}</small>
                </span>
              </label>
            ))}
          </div>
          {value.length > 0 && (
            <div className="chips">
              {value.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChange(value.filter((v) => v !== id))}
                  title="Retirer la sélection"
                >
                  {names[id] || "Fournisseur sélectionné"} ×
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <select
          aria-label={label}
          required={required}
          value={value[0] || ""}
          onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
        >
          <option value="">Sélectionner…</option>
          {value
            .filter((id) => !items.some((x) => x.id === id))
            .map((id) => (
              <option key={id} value={id}>
                {names[id] || "Sélection actuelle"}
              </option>
            ))}
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.reference}
            </option>
          ))}
        </select>
      )}
      <p className="caption">
        {total} résultat(s).{" "}
        {total > 50 ? "50 affichés : affinez la recherche." : ""}
        {multiple
          ? " Sélection facultative, plusieurs fournisseurs possibles."
          : ""}
      </p>
    </fieldset>
  );
}
