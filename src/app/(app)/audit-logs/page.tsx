"use client";

import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/PageShell";
import { ApiError, getAuditLogs } from "@/lib/api";
import type { AuditLogEntry } from "@/lib/eudr/types";
import { useEffect, useState } from "react";

const ACTION_TONES: Record<string, string> = {
  CREATE: "green",
  UPDATE: "blue",
  DELETE: "red",
  AUDIT: "blue",
  EXPORT: "blue",
  VALIDATE: "green",
  LOGIN: "grey",
  ACCESS_DENIED: "red",
};

export default function AuditLogsPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setEntries(await getAuditLogs());
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Impossible de charger le journal.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div>
      <PageHeader
        title="Journal d'audit"
        subtitle="Événements enregistrés pour votre organisation, du plus récent au plus ancien."
      />

      {error && (
        <div className="mb-4">
          <ErrorState message={error} />
        </div>
      )}

      <Card>
        {loading ? (
          <LoadingState />
        ) : entries.length === 0 ? (
          <EmptyState
            title="Aucun événement enregistré"
            message="Le journal se remplit au fil des créations, modifications et validations. Les événements antérieurs à la mise en place de la journalisation n'existent pas et ne peuvent pas être reconstitués."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2">Horodatage</th>
                  <th className="px-4 py-2">Utilisateur</th>
                  <th className="px-4 py-2">Action</th>
                  <th className="px-4 py-2">Entité</th>
                  <th className="px-4 py-2">Détails</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[10px] text-slate-500">
                      {new Date(e.createdAt).toLocaleString("fr-FR")}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{e.userEmail}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={ACTION_TONES[e.action] ?? "grey"}>{e.action}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {e.entityType}
                      <div className="font-mono text-[10px] text-slate-400">{e.entityId.slice(0, 8)}</div>
                    </td>
                    <td className="px-4 py-2.5 text-[10px] text-slate-500">
                      {e.details ? (
                        <code className="break-all">{JSON.stringify(e.details)}</code>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
