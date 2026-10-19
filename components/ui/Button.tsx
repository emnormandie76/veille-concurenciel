import type { ComponentProps } from "react";
import { cx } from "./cx";

/**
 * components/ui/Button.tsx — le bouton de la charte (étape 4)
 *
 * `type="button"` par défaut : un bouton n'envoie un formulaire que si on le
 * demande (`type="submit"`). `buttonClasses` habille aussi un lien
 * (`next/link`) qui doit avoir l'air d'un bouton.
 */

export type ButtonVariant = "primary" | "secondary" | "danger" | "danger-soft" | "ghost";
export type ButtonSize = "md" | "sm" | "icon";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-control border font-medium whitespace-nowrap " +
  "transition-colors disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const SIZES: Record<ButtonSize, string> = {
  md: "h-8 px-3 text-compact",
  sm: "h-7 px-2.5 text-xs",
  icon: "size-8",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "border-accent bg-accent text-accent-ink enabled:hover:border-accent-strong enabled:hover:bg-accent-strong",
  secondary: "border-line-strong bg-surface text-ink enabled:hover:bg-surface-2",
  danger: "border-danger bg-danger text-danger-ink enabled:hover:opacity-90",
  "danger-soft": "border-transparent bg-danger-soft text-danger enabled:hover:border-danger",
  ghost: "border-transparent bg-transparent text-ink-2 enabled:hover:bg-surface-2 enabled:hover:text-ink",
};

interface ButtonLook {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

export function buttonClasses({ variant = "secondary", size = "md", className }: ButtonLook = {}): string {
  return cx(BASE, SIZES[size], VARIANTS[variant], className);
}

export type ButtonProps = ComponentProps<"button"> & ButtonLook;

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClasses({ variant, size, className })} {...props} />;
}
