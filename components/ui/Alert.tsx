import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * components/ui/Alert.tsx — le message d'erreur, de réussite ou
 * d'information (charte, étape 4)
 *
 * Une erreur est annoncée tout de suite par les lecteurs d'écran
 * (`role="alert"`) ; une réussite ou une information attend la fin de la
 * phrase en cours (`role="status"`). Le texte reste en couleur d'encre : la
 * teinte est portée par le fond, la bordure et l'icône.
 */

export type AlertTone = "danger" | "success" | "info";

const TONES: Record<AlertTone, string> = {
  danger: "border-danger/30 bg-danger-soft text-danger",
  success: "border-success/30 bg-success-soft text-success",
  info: "border-accent/25 bg-accent-soft text-accent-strong",
};

const PATHS: Record<AlertTone, string> = {
  danger:
    "M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 4a1 1 0 0 1 1 1v3.5a1 1 0 1 1-2 0V7a1 1 0 0 1 1-1Zm0 9a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2Z",
  success:
    "M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm3.7 6.2a1 1 0 0 0-1.4-1.4L9 10.1 7.7 8.8a1 1 0 0 0-1.4 1.4l2 2a1 1 0 0 0 1.4 0l4-4Z",
  info: "M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 4.9a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2ZM9 9a1 1 0 0 1 2 0v4.5a1 1 0 1 1-2 0V9Z",
};

interface AlertProps {
  tone?: AlertTone;
  children: ReactNode;
  className?: string;
}

export function Alert({ tone = "info", children, className }: AlertProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx("flex items-start gap-2.5 rounded-control border px-3 py-2.5 text-sm leading-relaxed", TONES[tone], className)}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="mt-px size-5">
        <path fillRule="evenodd" clipRule="evenodd" d={PATHS[tone]} />
      </svg>
      <div className="min-w-0 text-ink">{children}</div>
    </div>
  );
}
