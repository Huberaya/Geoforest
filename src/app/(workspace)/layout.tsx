import { frFR } from "@clerk/localizations";
import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { authProvider } from "@/auth-provider";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  if (authProvider() === "oidc") return children;
  return (
    <ClerkProvider
      localization={frFR}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInForceRedirectUrl="/espace"
      signUpForceRedirectUrl="/espace"
      telemetry={false}
    >
      {children}
    </ClerkProvider>
  );
}
