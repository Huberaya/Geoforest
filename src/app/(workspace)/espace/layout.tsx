import type { ReactNode } from "react";
import { authProvider } from "@/auth-provider";
import { ClerkSessionBridge } from "@/components/auth/ClerkSessionBridge";

export default function PrivateWorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (authProvider() !== "clerk_development") return children;
  return <ClerkSessionBridge>{children}</ClerkSessionBridge>;
}
