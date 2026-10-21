import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * components/layout/SiteNavLink.tsx — une entrée de la barre du site
 *
 * Sortie de SiteShell.tsx à l'étape 10 (D104), pour que le lien
 * « Back-office » demandé par la barre (BackOfficeLink.tsx, composant
 * client) soit le même que celui des pages qui lisent la session.
 */

export function SiteNavLink({ href, current, children }: { href: string; current: boolean; children: ReactNode }) {
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

/** Le lien « Back-office », pour un gestionnaire ou un admin. */
export function BackOfficeNavLink() {
  return (
    <SiteNavLink href="/admin/schools" current={false}>
      Back-office
    </SiteNavLink>
  );
}
