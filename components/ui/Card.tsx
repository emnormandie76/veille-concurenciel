import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

/**
 * components/ui/Card.tsx — la carte (charte, étape 4)
 *
 * Un bloc posé sur la page : un formulaire, un groupe de faits. À réserver à
 * ce qui doit se détacher ; une page n'est pas une pile de cartes.
 */

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cx("rounded-card border border-line bg-surface p-5", className)} {...props} />;
}

interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Identifiant du titre, pour `aria-labelledby` sur la carte. */
  titleId?: string;
}

export function CardHeader({ title, description, titleId }: CardHeaderProps) {
  return (
    <div className="flex flex-col gap-1">
      <h2 id={titleId} className="font-display text-lg leading-snug font-semibold text-ink">
        {title}
      </h2>
      {description && <p className="text-sm leading-relaxed text-ink-2">{description}</p>}
    </div>
  );
}
