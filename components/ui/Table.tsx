import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

/**
 * components/ui/Table.tsx — le tableau (charte, étape 4)
 *
 * Un `<table>` natif, dans un cadre qui défile en largeur sur un petit écran
 * (la page, elle, ne défile jamais de côté). `caption` donne au tableau un
 * nom pour les lecteurs d'écran, sans l'afficher. Les nombres passent par
 * `numeric` : chiffres alignés (Plex Mono, chiffres tabulaires), à droite.
 */

interface TableProps {
  caption?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Table({ caption, className, children }: TableProps) {
  return (
    <div className={cx("overflow-x-auto rounded-card border border-line bg-surface", className)}>
      <table className="w-full text-compact">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function THead({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cx("border-b border-line bg-surface-2", className)} {...props} />;
}

export function TBody(props: ComponentProps<"tbody">) {
  return <tbody {...props} />;
}

export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cx("border-b border-line last:border-b-0", className)} {...props} />;
}

type Align = "left" | "right";

export function Th({ align = "left", className, scope = "col", ...props }: ComponentProps<"th"> & { align?: Align }) {
  return (
    <th
      scope={scope}
      className={cx(
        "px-3 py-2 text-xs font-semibold tracking-wider whitespace-nowrap text-ink-2 uppercase",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

/** `numeric` aligne à droite, sauf `align` contraire (une date sous un en-tête à gauche, par exemple). */
export function Td({
  align,
  numeric = false,
  className,
  ...props
}: ComponentProps<"td"> & { align?: Align; numeric?: boolean }) {
  const side = align ?? (numeric ? "right" : "left");
  return (
    <td
      className={cx(
        "px-3 py-2 align-middle",
        numeric && "font-mono tabular-nums",
        side === "right" ? "text-right" : "text-left",
        className,
      )}
      {...props}
    />
  );
}
