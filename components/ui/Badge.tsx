import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * components/ui/Badge.tsx — le badge (charte, étape 4)
 *
 * Un état ou une catégorie, en une étiquette courte. Les tons sémantiques
 * (`success`, `warning`, `danger`) disent un état ; `accent` et `solid`
 * distinguent une catégorie (les rôles, par exemple) ; `neutral` ne dit rien
 * de plus que son texte.
 *
 * `wrap` laisse un texte long passer à la ligne (le concours d'un programme,
 * étape 9) : la hauteur devient un minimum et l'arrondi celui d'un contrôle,
 * pour qu'un badge de deux lignes ne devienne pas une pilule étirée.
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

interface BadgeProps {
  tone?: BadgeTone;
  /** Un texte long, qui peut passer à la ligne. */
  wrap?: boolean;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "neutral", wrap = false, children, className }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 px-2 text-xs font-medium",
        wrap ? "min-h-6 rounded-control py-0.5 leading-snug" : "h-6 rounded-full whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
