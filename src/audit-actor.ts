/** Display system actions without falsely attributing them to a human. */
export function auditActorLabel(event: {
  actor_kind: "user" | "supplier" | "system";
  actor_id: string | null;
  supplier_actor_id: string | null;
}): string {
  if (event.actor_kind === "system") return "Système · contrôle documentaire";
  if (event.actor_kind === "supplier")
    return (
      "Portail fournisseur · " + (event.supplier_actor_id ?? "non renseigné")
    );
  return event.actor_id ?? "Utilisateur non renseigné";
}
