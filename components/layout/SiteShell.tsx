import Link from "next/link";
import type { ReactNode } from "react";
import SignOutButton from "@/app/SignOutButton";
import { buttonClasses } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import BackOfficeLink from "./BackOfficeLink";
import { BackOfficeNavLink, SiteNavLink } from "./SiteNavLink";

/**
 * components/layout/SiteShell.tsx — le gabarit des pages du site (charte,
 * étape 4)
 *
 * La barre du site (écoles, API, back-office pour qui y a droit, aide,
 * « Mon compte », déconnexion), puis une colonne de contenu. Toutes les pages
 * du site s'y posent depuis l'étape 9 (lot 1). « Aide » mène à la page d'aide
 * (étape 14, D109).
 *
 * « Back-office » (étape 10, D104, revient sur D57) : une page qui lit la
 * session (relue en base, `requirePage`, D1) passe `showBackOffice` ; une
 * page qui ne la lit pas (l'accueil, les fiches en cache, /api-docs) ne le
 * passe pas, et la barre le demande elle-même (`BackOfficeLink`). Le lien
 * n'est qu'une commodité : le layout /admin contrôle l'accès.
 */

export type SiteSection = "schools" | "api" | "help" | "account";

interface SiteShellProps {
  current?: SiteSection;
  /** Ce que la page sait de la session ; absent, la barre le demande. */
  showBackOffice?: boolean;
  /** `narrow` pour un formulaire (48 rem), `wide` pour des listes (72 rem). */
  width?: "narrow" | "wide";
  children: ReactNode;
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
            <SiteNavLink href="/" current={current === "schools"}>
              Écoles
            </SiteNavLink>
            <SiteNavLink href="/api-docs" current={current === "api"}>
              API
            </SiteNavLink>
            {showBackOffice === undefined ? <BackOfficeLink /> : showBackOffice && <BackOfficeNavLink />}
            <SiteNavLink href="/help" current={current === "help"}>
              Aide
            </SiteNavLink>
            <SiteNavLink href="/account" current={current === "account"}>
              Mon compte
            </SiteNavLink>
            <SignOutButton className={buttonClasses({ variant: "secondary", className: "ml-2" })} />
          </nav>
        </div>
      </header>
      <main className={cx("mx-auto px-5 py-8 sm:py-10", width === "narrow" ? "max-w-3xl" : "max-w-6xl")}>{children}</main>
    </div>
  );
}
