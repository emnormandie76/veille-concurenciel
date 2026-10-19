import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * components/ui/Badge.tsx — le badge (charte, étape 4)
 *
 * Un état ou une catégorie, en une étiquette courte. Les tons sémantiques
 * (`success`, `warning`, `danger`) disent un état ; `accent` et `solid`
 * distinguent une catégorie (les rôles, par exemple) ; `neutral` ne dit rien
 * de plus que son texte.
 */

export type BadgeTone = "neutral" | "accent" | "solid" | "success" | "warning" | "danger";

const TONES: Record<BadgeTone, string> = {
  neutral: "border border-line bg-surface-2 text-ink-2",
  accent: "bg-accent-soft text-accent-strong",
  solid: "bg-ink text-page",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
