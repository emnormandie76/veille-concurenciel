import Link from "next/link";
import type { ReactNode } from "react";

/**
 * components/layout/AdminPage.tsx — le gabarit des écrans du back-office
 * (charte, étape 4)
 *
 * L'en-tête de l'écran (titre, phrase d'explication, actions), puis son
 * contenu. Il se pose dans le cadre du back-office (app/admin/layout.tsx :
 * le menu latéral et le `main`, dans la charte depuis l'étape 9, lot 6).
 *
 * Deux emplacements facultatifs (étape 9, lot 2, sur la maquette A) : un
 * lien de retour au-dessus du titre (`back`), et un badge à côté du titre,
 * hors du `h1` (`badge` : le statut d'une école). Sans eux, le rendu est
 * celui de l'étape 4.
 */

interface AdminPageProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Le lien qui ramène à l'écran parent, au-dessus du titre. */
  back?: { href: string; label: ReactNode };
  /** Un badge à côté du titre (un statut), hors du titre lui-même. */
  badge?: ReactNode;
  children: ReactNode;
}

export function AdminPage({ title, description, actions, back, badge, children }: AdminPageProps) {
  const heading = <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">{title}</h1>;
  const header = (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        {badge ? (
          <div className="flex flex-wrap items-center gap-3">
            {heading}
            {badge}
          </div>
        ) : (
          heading
        )}
        {description && <p className="max-w-[70ch] text-sm leading-relaxed text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );

  return (
    <div className="flex flex-col gap-6">
      {back ? (
        <div className="flex flex-col gap-3">
          <Link
            href={back.href}
            className="inline-flex w-fit items-center gap-1.5 rounded-control text-sm text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {back.label}
          </Link>
          {header}
        </div>
      ) : (
        header
      )}
      {children}
    </div>
  );
}
