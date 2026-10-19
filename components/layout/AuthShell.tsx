import type { ReactNode } from "react";

/**
 * components/layout/AuthShell.tsx — le gabarit des pages sans session
 * (charte, étape 4) : la connexion et la première connexion.
 *
 * Une colonne étroite au centre de l'écran : le titre, une carte qui porte le
 * formulaire, puis le lien vers l'autre page. Pas de barre de navigation :
 * sans session, il n'y a nulle part où aller.
 */

interface AuthShellProps {
  title: ReactNode;
  subtitle?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function AuthShell({ title, subtitle, footer, children }: AuthShellProps) {
  return (
    <main className="charte grid min-h-screen place-items-center px-4 py-12 sm:py-16">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-1.5 text-center">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-balance text-ink">{title}</h1>
          {subtitle && <p className="text-sm leading-relaxed text-ink-2">{subtitle}</p>}
        </div>
        <div className="flex flex-col gap-5 rounded-card border border-line bg-surface p-6 shadow-sm">{children}</div>
        {footer && <p className="text-center text-sm leading-relaxed text-ink-2">{footer}</p>}
      </div>
    </main>
  );
}

/** Ce qui s'affiche pendant que la page lit son adresse (Suspense). */
export function AuthShellLoading() {
  return (
    <main className="charte grid min-h-screen place-items-center px-4 text-sm text-ink-2" aria-busy="true">
      Chargement...
    </main>
  );
}
