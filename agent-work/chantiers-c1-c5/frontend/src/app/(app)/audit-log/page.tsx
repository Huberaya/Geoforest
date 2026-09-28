"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  type AuditEvent,
  type AuditEventList,
  type OrgUser,
  listAuditEvents,
  listOrgUsers,
} from "@/lib/api";

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
  "risk_case.created": "Dossier DDR créé",
  "risk_case.updated": "Dossier DDR modifié",
  "risk_decision.recorded": "Décision humaine enregistrée",
  "declaration_preparation.created": "Préparation interne générée",
  "declaration_preparation.exported": "Préparation interne exportée",
};

const OBJECT_TYPES: Array<[string, string]> = [
  ["organization", "Organisation"],
  ["user", "Comptes utilisateurs"],
  ["supplier", "Fournisseurs"],
  ["product", "Produits"],
  ["shipment", "Lots"],
  ["plot", "Parcelles"],
  ["document", "Documents"],
  ["document_checklist_item", "Checklist documentaire"],
  ["risk_case", "Dossiers DDR"],
  ["risk_case_origin", "Origines DDR"],
  ["risk_evidence", "Éléments de preuve DDR"],
  ["risk_finding", "Constats DDR"],
  ["risk_mitigation_action", "Actions de mitigation"],
  ["risk_decision", "Décisions DDR"],
  ["declaration_preparation", "Préparations internes"],
];

const INITIAL_FILTERS = {
  objectType: "all",
  action: "",
  actorUserId: "all",
  fromDate: "",
  toDate: "",
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Europe/Paris",
  }).format(date);
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] || action.replaceAll(".", " · ").replaceAll("_", " ");
}

function memberLabel(user: OrgUser): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return `${name ? `${name} — ` : ""}${user.email}${user.is_active ? "" : " (désactivé)"}`;
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
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-800">{actionLabel(event.action)}</span>
            <span className="font-mono text-xs text-slate-500">{event.object_type}:{event.object_id}</span>
          </div>
          <div className="mt-2 text-sm text-slate-800">{event.actor_email || "Compte désactivé / inconnu"}</div>
          <div className="mt-0.5 text-xs text-slate-500">{formatDate(event.occurred_at)} · IP {event.ip_address || "non disponible"}</div>
          {event.user_agent && <div className="mt-1 max-w-4xl truncate text-[11px] text-slate-400" title={event.user_agent}>{event.user_agent}</div>}
        </div>
        <button className="btn-secondary shrink-0 px-3 py-1.5 text-xs" onClick={onToggle}>
          {expanded ? "Masquer les changements" : "Voir avant / après"}
        </button>
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
  const [members, setMembers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [draft, setDraft] = useState(INITIAL_FILTERS);
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const limit = 50;

  const load = useCallback(async (nextOffset: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listAuditEvents({
        limit,
        offset: nextOffset,
        object_type: filters.objectType === "all" ? undefined : filters.objectType,
        action: filters.action.trim() || undefined,
        actor_user_id: filters.actorUserId === "all" ? undefined : filters.actorUserId,
        from_date: filters.fromDate || undefined,
        to_date: filters.toDate || undefined,
      });
      setData(result);
      setOffset(nextOffset);
      setExpandedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Journal d'audit indisponible.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load(0);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void listOrgUsers().then((result) => {
      if (!cancelled) setMembers(result);
    }).catch(() => {
      if (!cancelled) setMembers([]);
    });
    return () => { cancelled = true; };
  }, []);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters({ ...draft });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Journal d’audit</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Historique append-only des actions sur l’organisation et ses données. Consultation réservée aux rôles admin et conformité.
          </p>
        </div>
        <button className="btn-secondary" disabled={loading} onClick={() => void load(offset)}>↻ Actualiser</button>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
        Les snapshots d’audit masquent les géométries et coordonnées précises; les données originales restent conservées dans l’événement en base. L’adresse IP, l’agent utilisateur et les autres champs du journal restent des données sensibles.
      </div>

      <form className="card space-y-3" onSubmit={applyFilters}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="space-y-1 text-xs font-medium text-slate-600">
            <span>Type d’objet</span>
            <select className="input" value={draft.objectType} onChange={(event) => setDraft({ ...draft, objectType: event.target.value })}>
              <option value="all">Tous les objets</option>
              {OBJECT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-600">
            <span>Acteur</span>
            <select className="input" value={draft.actorUserId} onChange={(event) => setDraft({ ...draft, actorUserId: event.target.value })}>
              <option value="all">Tous les acteurs</option>
              {members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-600">
            <span>Action exacte</span>
            <input className="input" value={draft.action} maxLength={100} placeholder="ex. risk_decision.recorded" onChange={(event) => setDraft({ ...draft, action: event.target.value })} />
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-600">
            <span>Du (heure de Paris)</span>
            <input className="input" type="date" value={draft.fromDate} onChange={(event) => setDraft({ ...draft, fromDate: event.target.value })} />
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-600">
            <span>Au (inclus, heure de Paris)</span>
            <input className="input" type="date" value={draft.toDate} onChange={(event) => setDraft({ ...draft, toDate: event.target.value })} />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">La date de fin est incluse; les filtres sont appliqués dans le fuseau Europe/Paris.</p>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => { setDraft(INITIAL_FILTERS); setFilters({ ...INITIAL_FILTERS }); }}>Effacer les filtres</button>
            <button type="submit" className="btn-primary" disabled={loading}>Filtrer</button>
          </div>
        </div>
      </form>

      {error && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold">Impossible de consulter le journal</div>
          <div className="mt-1">{error}</div>
          <div className="mt-2 text-xs">La consultation est réservée aux rôles admin et conformité de l’organisation.</div>
        </div>
      )}

      {!error && data && <div className="text-xs text-slate-500">{data.total} événement(s) · affichage {data.items.length ? offset + 1 : 0}–{Math.min(offset + data.items.length, data.total)}</div>}
      {loading && <div className="card py-10 text-center text-sm text-slate-500">Chargement du journal…</div>}
      {!loading && !error && data && data.items.length === 0 && (
        <div className="card py-12 text-center">
          <div className="text-3xl">📜</div>
          <h2 className="mt-2 font-semibold text-slate-800">Aucun événement d’audit enregistré</h2>
          <p className="mt-1 text-sm text-slate-500">Les créations et modifications tracées apparaîtront ici.</p>
        </div>
      )}
      {!loading && !error && data && (
        <div className="space-y-2">
          {data.items.map((auditEvent) => (
            <AuditRow
              key={auditEvent.id}
              event={auditEvent}
              expanded={expandedId === auditEvent.id}
              onToggle={() => setExpandedId(expandedId === auditEvent.id ? null : auditEvent.id)}
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
