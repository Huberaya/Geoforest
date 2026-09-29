"use client";

import { useAuth, useClerk, useReverification } from "@clerk/nextjs";
import { useState } from "react";

/** The SDK dialog cannot grant rights: the backend verifies the new proof again. */
export function ClerkSecurityControls({
  onVerified,
}: {
  onVerified: () => void;
}) {
  const { getToken } = useAuth();
  const clerk = useClerk();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const verify = useReverification(async () => {
    const token = await getToken({ skipCache: true });
    if (!token)
      throw new Error("Reconnectez-vous avant de vérifier votre identité.");
    const response = await fetch("/api/auth/clerk/assurance", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json();
    if (response.status === 403 && data.clerk_error) return data;
    if (!response.ok || data.verified !== true)
      throw new Error(
        typeof data.detail === "string"
          ? data.detail
          : "Vérification indisponible.",
      );
    return data;
  });
  return (
    <aside
      id="clerk-security"
      className="clerk-security"
      aria-label="Sécurité du compte"
    >
      <p>
        Les actions administrateur nécessitent une double authentification
        récente.
      </p>
      <div>
        <button className="button" onClick={() => clerk.openUserProfile()}>
          Sécurité du compte
        </button>
        <button
          className="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const result = await verify();
              if (result?.verified !== true)
                throw new Error("Double authentification non confirmée.");
              onVerified();
            } catch {
              setError(
                "Vérification non confirmée. Activez la double authentification dans Sécurité du compte, puis réessayez. Une annulation n’accorde aucun accès supplémentaire.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Vérification…" : "Vérifier mon identité"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}
