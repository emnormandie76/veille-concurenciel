import Link from "next/link";
import type { ReactNode } from "react";
import SignOutButton from "@/app/SignOutButton";
import { buttonClasses } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";

/**
 * components/layout/SiteShell.tsx — le gabarit des pages du site (charte,
 * étape 4)
 *
 * La barre du site (écoles, API, back-office pour qui y a droit, « Mon
 * compte », déconnexion), puis une colonne de contenu. Toutes les pages du
 * site s'y posent depuis l'étape 9 (lot 1).
 *
 * `showBackOffice` vient de la session relue en base (`requirePage`, D1) : le
 * lien n'est qu'une commodité, le layout /admin contrôle l'accès.
 */

export type SiteSection = "schools" | "api" | "account";

interface SiteShellProps {
  current?: SiteSection;
  showBackOffice: boolean;
  /** `narrow` pour un formulaire (48 rem), `wide` pour des listes (72 rem). */
  width?: "narrow" | "wide";
  children: ReactNode;
}

function NavLink({ href, current, children }: { href: string; current: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cx(
        "inline-flex h-8 items-center rounded-control px-3 text-compact",
        current ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

export function SiteShell({ current, showBackOffice, width = "wide", children }: SiteShellProps) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-2.5">
          <Link href="/" className="font-display text-lg font-semibold tracking-tight text-ink">
            EduData France
          </Link>
          <nav aria-label="Navigation du site" className="flex flex-wrap items-center gap-1">
            <NavLink href="/" current={current === "schools"}>
              Écoles
            </NavLink>
            <NavLink href="/api-docs" current={current === "api"}>
              API
            </NavLink>
            {showBackOffice && (
              <NavLink href="/admin/schools" current={false}>
                Back-office
              </NavLink>
            )}
            <NavLink href="/account" current={current === "account"}>
              Mon compte
            </NavLink>
            <SignOutButton className={buttonClasses({ variant: "secondary", className: "ml-2" })} />
          </nav>
        </div>
      </header>
      <main className={cx("mx-auto px-5 py-8 sm:py-10", width === "narrow" ? "max-w-3xl" : "max-w-6xl")}>{children}</main>
    </div>
  );
}
