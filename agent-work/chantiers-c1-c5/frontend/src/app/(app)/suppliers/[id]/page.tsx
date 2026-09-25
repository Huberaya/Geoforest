"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  type Supplier,
  type SupplierInviteResult,
  getSupplier,
  inviteSupplier,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const TYPE_LABELS: Record<Supplier["supplier_type"], string> = {
  producer: "Producteur",
  cooperative: "Coopérative",
  trader: "Négociant",
  processor: "Transformateur",
  other: "Autre",
};

export default function SupplierDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [inviteResult, setInviteResult] = useState<SupplierInviteResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.id) return;
    let active = true;
    getSupplier(params.id)
      .then((value) => { if (active) setSupplier(value); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Fournisseur introuvable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [params.id]);

  useEffect(() => {
    if (!authLoading && user?.role === "supplier") router.replace("/supplier-portal");
  }, [authLoading, user?.role, router]);

  async function generateInvite() {
    if (!supplier) return;
    if (supplier.portal_enabled && !window.confirm("Générer un nouveau lien révoquera les anciens liens encore valides. Continuer ?")) return;
    setInviting(true);
    setError(null);
    setInviteResult(null);
    setCopied(false);
    try {
      const result = await inviteSupplier(supplier.id);
      setSupplier(result);
      setInviteResult(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de générer le lien.");
    } finally {
      setInviting(false);
    }
  }

  async function copyInvite() {
    if (!inviteResult?.invitation_url) return;
    try {
      await navigator.clipboard.writeText(inviteResult.invitation_url);
      setCopied(true);
    } catch {
      setError("Copie automatique indisponible. Sélectionnez et copiez le lien manuellement.");
    }
  }

  if (authLoading || user?.role === "supplier") return null;

  if (loading) return <div className="p-8 text-sm text-slate-500">Chargement du fournisseur…</div>;
  if (!supplier) {
    return (
      <div className="space-y-4">
        <Link href="/suppliers" className="text-sm font-semibold text-emerald-700 hover:underline">← Fournisseurs</Link>
        <div className="card text-sm text-red-700">{error || "Fournisseur introuvable."}</div>
      </div>
    );
  }

  const canInvite = user && ["admin", "compliance", "procurement"].includes(user.role);
  const deliveryMessage = inviteResult?.delivery_status === "email_sent"
    ? "Invitation envoyée par email. Le lien brut ne sera pas réaffiché."
    : inviteResult?.delivery_status === "email_failed"
      ? "Échec de l'envoi email. Transmettez manuellement le lien ci-dessous, de manière sécurisée."
      : inviteResult?.delivery_status === "ready_to_share"
        ? "SMTP non configuré : le lien est prêt à être transmis manuellement."
        : null;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link href="/suppliers" className="text-sm font-semibold text-emerald-700 hover:underline">← Retour aux fournisseurs</Link>
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <section className="card flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Fiche fournisseur</div>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">{supplier.name}</h1>
          <p className="mt-2 text-sm text-slate-500">{TYPE_LABELS[supplier.supplier_type]} · {supplier.country} · <span className="capitalize">{supplier.status}</span></p>
        </div>
        {canInvite && (
          <button className="btn btn-primary" onClick={generateInvite} disabled={inviting || !supplier.contact_email && !supplier.email}>
            {inviting ? "Génération…" : supplier.portal_enabled ? "Renvoyer / renouveler l'invitation" : "Inviter au portail"}
          </button>
        )}
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="card">
          <h2 className="text-lg font-bold text-slate-900">Coordonnées</h2>
          <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Detail label="Raison sociale" value={supplier.legal_name} />
            <Detail label="Pays" value={supplier.country} />
            <Detail label="Adresse" value={supplier.address} />
            <Detail label="Région" value={supplier.region} />
            <Detail label="Contact" value={supplier.contact_name} />
            <Detail label="Email d'invitation" value={supplier.contact_email || supplier.email} />
            <Detail label="Téléphone" value={supplier.contact_phone || supplier.phone} />
            <Detail label="Identifiant fiscal" value={supplier.tax_id} />
            <Detail label="Immatriculation" value={supplier.registration_number} />
            <Detail label="EORI" value={supplier.eori} />
          </dl>
        </div>

        <aside className="card h-fit">
          <h2 className="text-lg font-bold text-slate-900">Accès portail</h2>
          <p className="mt-1 text-sm text-slate-500">{supplier.portal_enabled ? "Portail activé" : "Aucune invitation générée"}</p>
          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            Les invitations expirent après 48 h et ne peuvent être utilisées qu'une seule fois. Un renvoi révoque tout lien précédent non consommé.
          </div>
          {inviteResult && deliveryMessage && (
            <div className={`mt-4 rounded-xl border p-3 text-sm ${inviteResult.delivery_status === "email_sent" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
              <p>{deliveryMessage}</p>
              <p className="mt-2 text-xs">Expire le {new Date(inviteResult.invitation_expires_at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</p>
              {inviteResult.invitation_url && (
                <div className="mt-3 space-y-2">
                  <textarea aria-label="Lien d'invitation à copier" className="input min-h-20 resize-y bg-white text-[11px]" readOnly value={inviteResult.invitation_url} onFocus={(event) => event.currentTarget.select()} />
                  <button type="button" className="btn btn-secondary w-full" onClick={copyInvite}>{copied ? "Lien copié" : "Copier le lien sécurisé"}</button>
                </div>
              )}
            </div>
          )}
          {!supplier.contact_email && !supplier.email && (
            <p className="mt-4 text-xs text-amber-800">Ajoutez un email de contact avant d'envoyer l'invitation.</p>
          )}
          {canInvite && <p className="mt-4 text-[11px] leading-5 text-slate-400">Ne partagez le lien manuel qu'avec le contact vérifié. Le lien n'est affiché qu'à cette étape.</p>}
        </aside>
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-800">{value || "—"}</dd>
    </div>
  );
}
