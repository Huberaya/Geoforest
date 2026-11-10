import { Badge } from "./PageShell";
import type { RiskLevel } from "@/lib/eudr/types";

const TONES: Record<RiskLevel, string> = {
  LOW: "green",
  STANDARD: "blue",
  HIGH: "amber",
  CRITICAL: "red",
};

const LABELS: Record<RiskLevel, string> = {
  LOW: "Faible",
  STANDARD: "Standard",
  HIGH: "Élevé",
  CRITICAL: "Critique",
};

export default function RiskBadge({ level }: { level: RiskLevel | string }) {
  const key = (level in TONES ? level : "STANDARD") as RiskLevel;
  return <Badge tone={TONES[key]}>{LABELS[key] ?? level}</Badge>;
}
