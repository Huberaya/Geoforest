"use client";

import { useRouter } from "next/navigation";
import { useAuth, useClerk } from "@clerk/nextjs";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AuthSessionContext } from "./AuthSession";

async function closeLocalSession() {
  const response = await fetch("/api/auth/clerk/logout", {
    method: "POST",
    headers: { "X-GFT-Logout": "1" },
    credentials: "same-origin",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new Error("Fermeture de la session locale impossible.");
}

export function ClerkSessionBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken, userId, sessionId } = useAuth();
  const clerk = useClerk();
  const router = useRouter();
  const identityKey = `${isSignedIn}:${userId || ""}:${sessionId || ""}`;
  const [readyFor, setReadyFor] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [generation, setGeneration] = useState(0);
  const [retry, setRetry] = useState(0);
  const stopped = useRef(false);
  const pending = useRef<Promise<void> | null>(null);
  const lastCsrf = useRef("");
  const expiresAt = useRef(0);

  const logout = useCallback(async () => {
    stopped.current = true;
    // Drain a refresh before revoking, so its Set-Cookie cannot undo logout.
    await pending.current?.catch(() => {});
    let localFailed = false;
    try {
      await closeLocalSession();
    } catch {
      localFailed = true;
    }
    try {
      await clerk.signOut();
    } catch {
      setStatus("error");
      throw new Error(
        "Déconnexion Clerk non confirmée. Réessayez la fermeture de votre session.",
      );
    }
    if (localFailed) {
      setStatus("error");
      throw new Error(
        "Clerk déconnecté. La session locale expirera sous 60 secondes ; réessayez sa fermeture.",
      );
    }
    router.replace("/");
    router.refresh();
  }, [clerk, router]);

  useEffect(() => {
    let disposed = false;
    stopped.current = false;
    const sdkTimeout = window.setTimeout(() => {
      if (!isLoaded && !disposed) setStatus("error");
    }, 15000);
    const refresh = () => {
      if (stopped.current || disposed || pending.current || !isLoaded) return;
      const task = async () => {
        try {
          if (!isSignedIn) {
            await closeLocalSession();
            if (!disposed && lastCsrf.current) {
              lastCsrf.current = "";
              expiresAt.current = 0;
              setGeneration((value) => value + 1);
            }
          } else {
            if (expiresAt.current <= Date.now() / 1000) setStatus("loading");
            let tokenTimeout: ReturnType<typeof setTimeout>;
            const token = await Promise.race([
              getToken({ skipCache: true }),
              new Promise<never>((_, reject) => {
                tokenTimeout = setTimeout(
                  () => reject(new Error("Délai identité dépassé")),
                  12000,
                );
              }),
            ]).finally(() => clearTimeout(tokenTimeout));
            if (!token) throw new Error("Preuve absente");
            if (disposed || stopped.current) return;
            const response = await fetch("/api/auth/clerk/exchange", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
              credentials: "same-origin",
              cache: "no-store",
              signal: AbortSignal.timeout(12000),
            });
            if (!response.ok) throw new Error("Session non vérifiable");
            const data = await response.json();
            if (!disposed && !stopped.current) {
              expiresAt.current = data.expires_at;
              if (lastCsrf.current !== data.csrf_token) {
                lastCsrf.current = data.csrf_token;
                setGeneration((value) => value + 1);
              }
            }
          }
          if (!disposed && !stopped.current) {
            setReadyFor(identityKey);
            setStatus("ready");
          }
        } catch {
          if (!disposed && !stopped.current) setStatus("error");
        }
      };
      pending.current = task().finally(() => {
        pending.current = null;
      });
    };
    if (pending.current) void pending.current.then(refresh);
    refresh();
    const interval = window.setInterval(refresh, 20000);
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.clearTimeout(sdkTimeout);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [isLoaded, isSignedIn, getToken, userId, sessionId, identityKey, retry]);

  const visibleStatus =
    status === "ready" && readyFor !== identityKey ? "loading" : status;
  if (status !== "ready" || readyFor !== identityKey)
    return (
      <main className="auth-shell">
        <section className="auth-card" aria-live="polite">
          <span className="eyebrow">GEOFOREST TRACE · DÉVELOPPEMENT</span>
          <h1>
            {visibleStatus === "loading"
              ? "Vérification de votre connexion"
              : "Connexion indisponible"}
          </h1>
          <p>
            {visibleStatus === "loading"
              ? "Nous préparons votre session sécurisée."
              : "Le service d’identité ou GeoForest n’a pas pu vérifier votre session. Aucun accès métier n’est accordé sans vérification."}
          </p>
          {visibleStatus === "error" && (
            <>
              <button
                className="button primary"
                onClick={() => {
                  setStatus("loading");
                  if (!isLoaded) window.location.reload();
                  else setRetry((value) => value + 1);
                }}
              >
                Réessayer
              </button>
              {isLoaded && isSignedIn && (
                <button
                  className="button"
                  onClick={() => {
                    void logout().catch(() => setStatus("error"));
                  }}
                >
                  Fermer ma session
                </button>
              )}
            </>
          )}
          <p className="muted">
            Environnement de test local — aucune connexion à Neon Production.
          </p>
        </section>
      </main>
    );
  return (
    <AuthSessionContext.Provider
      value={{ provider: "clerk_development", generation, logout }}
    >
      {children}
    </AuthSessionContext.Provider>
  );
}
