"use client";

import { useEffect, useState } from "react";
import { type AuditEvent, type AuditEventList, listAuditEvents } from "@/lib/api";

const ACTION_LABELS: Record<string, string> = {
  "organization.created": "Organisation créée",
  "user.registered": "Compte créé",
  "user.profile_updated": "Profil modifié",
  "user.password_changed": "Mot de passe changé",
  "user.invited": "Membre invité",
  "user.deactivated": "Membre désactivé",
  "supplier.created": "Fournisseur créé",
  "supplier.updated": "Fournisseur modifié",
  "supplier.archived": "Fournisseur archivé",
  "supplier.invited": "Invitation fournisseur générée",
  "product.created": "Produit créé",
  "product.updated": "Produit modifié",
  "product.archived": "Produit archivé",
  "shipment.created": "Lot créé",
  "shipment.updated": "Lot modifié",
  "shipment.deleted": "Lot supprimé",
  "plot.created": "Parcelle créée",
  "plot.updated": "Parcelle modifiée",
  "plot.validated": "Validation géométrique relancée",
  "plot.deleted": "Parcelle supprimée",
  "plot.deforestation_screened": "Dépistage satellitaire de la parcelle",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Europe/Paris",
  }).format(new Date(value));
}

function Snapshot({ label, value }: { label: string; value: Record<string, unknown> | null }) {
  return (
    <details className="min-w-0 rounded-lg border border-slate-200 bg-white">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700">{label}</summary>
      <pre className="max-h-80 overflow-auto border-t border-slate-100 bg-slate-50 p-3 text-[10px] leading-relaxed text-slate-700">
        {value ? JSON.stringify(value, null, 2) : "—"}
      </pre>
    </details>
  );
}

function AuditRow({ event, expanded, onToggle }: { event: AuditEvent; expanded: boolean; onToggle: () => void }) {
  const label = ACTION_LABELS[event.action] || event.action;
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-800">{label}</span>
            <span className="font-mono text-xs text-slate-500">{event.object_type}:{event.object_id}</span>
          </div>
          <div className="mt-2 text-sm text-slate-800">{event.actor_email || "Utilisateur désactivé / inconnu"}</div>
          <div className="mt-0.5 text-xs text-slate-500">{formatDate(event.occurred_at)} · IP {event.ip_address || "non disponible"}</div>
          {event.user_agent && <div className="mt-1 max-w-4xl truncate text-[11px] text-slate-400" title={event.user_agent}>{event.user_agent}</div>}
        </div>
        <button className="btn-secondary shrink-0 px-3 py-1.5 text-xs" onClick={onToggle}>{expanded ? "Masquer les changements" : "Voir avant / après"}</button>
      </div>
      {expanded && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <Snapshot label="État précédent" value={event.previous_data} />
          <Snapshot label="Nouvel état" value={event.new_data} />
        </div>
      )}
    </article>
  );
}

export default function AuditLogPage() {
  const [data, setData] = useState<AuditEventList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [objectType, setObjectType] = useState("all");
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const limit = 50;

  async function load(nextOffset = offset) {
    setLoading(true);
    setError(null);
    try {
      const result = await listAuditEvents({
        limit,
        offset: nextOffset,
        object_type: objectType === "all" ? undefined : objectType,
      });
      setData(result);
      setOffset(nextOffset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Journal d'audit indisponible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(0);
  }, [objectType]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Journal d'audit</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Historique append-only des changements sur l'organisation, les comptes, les fournisseurs, les produits, les lots et les parcelles : acteur, date, objet, IP et snapshots avant / après. Consultation réservée aux rôles admin et conformité.
          </p>
        </div>
        <button className="btn-secondary" disabled={loading} onClick={() => void load(offset)}>↻ Actualiser</button>
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-800">Événements de l'organisation</div>
          <div className="text-xs text-slate-500">Snapshots avant / après; les mots de passe, hashes et secrets d'invitation sont exclus.</div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Objet</span>
          <select className="input w-auto" value={objectType} onChange={(e) => setObjectType(e.target.value)}>
            <option value="all">Tous les objets</option>
            <option value="organization">Organisation</option>
            <option value="user">Comptes utilisateurs</option>
            <option value="supplier">Fournisseurs</option>
            <option value="product">Produits</option>
            <option value="shipment">Lots</option>
            <option value="plot">Parcelles</option>
          </select>
        </label>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold">Impossible de consulter le journal</div>
          <div className="mt-1">{error}</div>
          <div className="mt-2 text-xs">La consultation de l'audit trail est réservée aux rôles admin et conformité de l'organisation.</div>
        </div>
      )}

      {!error && data && <div className="text-xs text-slate-500">{data.total} événement(s) · affichage {data.items.length ? offset + 1 : 0}–{Math.min(offset + data.items.length, data.total)}</div>}
      {loading && <div className="card py-10 text-center text-sm text-slate-500">Chargement du journal…</div>}
      {!loading && !error && data && data.items.length === 0 && (
        <div className="card py-12 text-center">
          <div className="text-3xl">📜</div>
          <h2 className="mt-2 font-semibold text-slate-800">Aucun événement d'audit enregistré</h2>
          <p className="mt-1 text-sm text-slate-500">Les créations et modifications des données métier apparaîtront ici sous forme d'événements traçables.</p>
        </div>
      )}
      {!loading && data && (
        <div className="space-y-2">
          {data.items.map((event) => (
            <AuditRow
              key={event.id}
              event={event}
              expanded={expandedId === event.id}
              onToggle={() => setExpandedId(expandedId === event.id ? null : event.id)}
            />
          ))}
        </div>
      )}
      {!error && data && data.total > limit && (
        <div className="flex justify-center gap-2">
          <button className="btn-secondary" disabled={offset === 0 || loading} onClick={() => void load(Math.max(0, offset - limit))}>← Plus récents</button>
          <button className="btn-secondary" disabled={offset + limit >= data.total || loading} onClick={() => void load(offset + limit)}>Plus anciens →</button>
        </div>
      )}
    </div>
  );
}
