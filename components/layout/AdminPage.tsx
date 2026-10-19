import type { ReactNode } from "react";

/**
 * components/layout/AdminPage.tsx — le gabarit des écrans du back-office
 * (charte, étape 4)
 *
 * L'en-tête de l'écran (titre, phrase d'explication, actions), puis son
 * contenu. Il se pose dans le cadre du back-office (app/admin/layout.tsx),
 * dont le menu latéral reste l'ancien jusqu'à l'étape 9 (décision du
 * 19 octobre) ; la zone de contenu prend le fond de la charte
 * (app/charte.css, « Transition »).
 */

interface AdminPageProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function AdminPage({ title, description, actions, children }: AdminPageProps) {
  return (
    <div className="charte flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {description && <p className="max-w-[70ch] text-sm leading-relaxed text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}
