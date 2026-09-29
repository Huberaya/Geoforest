import type { ReactNode } from "react";
import { authProvider } from "@/auth-provider";
import { ClerkSessionBridge } from "@/components/auth/ClerkSessionBridge";

export default function PrivateWorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const provider = authProvider();
  if (provider === "oidc") return children;
  return (
    <ClerkSessionBridge provider={provider}>{children}</ClerkSessionBridge>
  );
}
