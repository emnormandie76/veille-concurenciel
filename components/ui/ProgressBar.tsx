import type { ComponentProps } from "react";
import { cx } from "./cx";

/**
 * components/ui/ProgressBar.tsx — la barre de progression (charte, étape 9)
 *
 * L'élément natif `<progress>` (D8) : valeur et maximum lus par les lecteurs
 * d'écran, sans largeur posée par un `style` en ligne. Plan gestion-contenu,
 * étape 9, lot 5, D86 : les barres de /admin/cron (la progression d'une
 * tâche, les crédits du mois, l'usage d'une clé Tavily).
 *
 * Le ton colore la valeur ; il dit un état (charte §1), l'accent une simple
 * avancée. La barre est nommée par l'appelant (`aria-label` ou
 * `aria-labelledby`), et les chiffres restent écrits à côté : la couleur
 * n'est jamais seule. Sans animation (charte §8).
 *
 * Chrome et Safari dessinent la piste et la valeur par
 * `::-webkit-progress-bar` et `::-webkit-progress-value`, Firefox par
 * l'élément lui-même et `::-moz-progress-bar`. Pas de `block` : homonyme
 * d'une ancienne classe, jamais généré (app/globals.css).
 */

export type ProgressTone = "accent" | "success" | "warning" | "danger";

const TONES: Record<ProgressTone, string> = {
  accent: "[&::-webkit-progress-value]:bg-accent [&::-moz-progress-bar]:bg-accent",
  success: "[&::-webkit-progress-value]:bg-success [&::-moz-progress-bar]:bg-success",
  warning: "[&::-webkit-progress-value]:bg-warning [&::-moz-progress-bar]:bg-warning",
  danger: "[&::-webkit-progress-value]:bg-danger [&::-moz-progress-bar]:bg-danger",
};

// La piste en `line` : en `surface-2`, elle disparaissait sur le fond des
// cartes de tâches de /admin/cron (contrôle visuel du lot 5).
const BASE =
  "h-1.5 w-full appearance-none overflow-hidden rounded-full border-0 bg-line align-middle " +
  "[&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-line " +
  "[&::-webkit-progress-value]:rounded-full [&::-moz-progress-bar]:rounded-full";

type ProgressBarProps = Omit<ComponentProps<"progress">, "value" | "max" | "children"> & {
  value: number;
  max: number;
  tone?: ProgressTone;
};

export function ProgressBar({ value, max, tone = "accent", className, ...props }: ProgressBarProps) {
  return <progress value={value} max={max} className={cx(BASE, TONES[tone], className)} {...props} />;
}
