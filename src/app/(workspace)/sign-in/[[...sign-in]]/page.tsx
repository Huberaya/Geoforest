import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authProvider } from "@/auth-provider";
import { AccountForm } from "@/components/auth/AccountForm";

export const metadata: Metadata = {
  title: "Se connecter — GeoForest Trace",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  if (authProvider() === "oidc") redirect("/api/auth/login");
  return <AccountForm mode="sign-in" />;
}
