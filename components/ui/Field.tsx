import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

/**
 * components/ui/Field.tsx — champ, zone de texte, liste déroulante et leur
 * libellé (charte, étape 4)
 *
 * `Field` relie le libellé, l'aide et l'erreur au contrôle : `htmlFor`,
 * `aria-describedby` (aide puis erreur) et `aria-invalid`. L'identifiant est
 * donné par l'appelant, stable, pour que les tests et les lecteurs d'écran
 * le retrouvent ; l'aide reçoit `<id>-hint`, l'erreur `<id>-error`.
 *
 * Les contrôles sont natifs (D8) : la liste déroulante est un `<select>`,
 * habillé d'une flèche.
 */

const CONTROL =
  "w-full rounded-control border border-line-strong bg-surface text-ink placeholder:text-ink-3 " +
  "outline-hidden transition-[border-color,box-shadow] focus:border-focus focus:ring-2 focus:ring-focus/25 " +
  "disabled:opacity-60 aria-[invalid=true]:border-danger aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-danger/20";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(CONTROL, "h-9 px-3 text-sm", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(CONTROL, "px-3 py-2 text-sm leading-relaxed", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select className={cx(CONTROL, "h-9 cursor-pointer appearance-none pr-8 pl-3 text-sm", className)} {...props}>
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-2"
      >
        <path d="M6 8l4 4 4-4" />
      </svg>
    </div>
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cx("text-sm font-medium text-ink", className)} {...props} />;
}

/** Ce que `Field` transmet au contrôle qu'il entoure. */
export interface ControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

interface FieldProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: (control: ControlProps) => ReactNode;
}

export function Field({ id, label, hint, error, className, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && (
        <p id={hintId} className="text-xs leading-relaxed text-ink-2">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
