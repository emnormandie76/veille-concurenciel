"use client";

import { signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import { navFor } from "./nav";

/**
 * app/admin/SidebarClient.tsx — le menu du back-office (charte, étape 9, lot 6)
 *
 * Sombre, sur les jetons `side-*` (D92, maquette A), texte seul (D93), le
 * rôle en texte sous le nom (D95). Au-delà de 1 024 px, une colonne de
 * 240 px collée en haut de la fenêtre ; en deçà, une barre et un bouton
 * « Menu » qui ouvre le menu sous elle et pousse le contenu, sans calque
 * (D94) ; il se referme quand la page change.
 *
 * Le menu ne montre que ce que le rôle permet ; le contrôle réel est côté
 * serveur (requirePage) et dans les API (app/admin/nav.ts).
 */

interface MenuUser {
  name?: string | null;
  role: UserRole;
}

const MENU_ID = "admin-menu";

// Le bleu du focus ne tiendrait que 2:1 sur le fond `side` : le menu prend
// `side-ink` (D92).
const ENTRY =
  "flex min-h-9 w-full items-center rounded-control px-3 py-1.5 text-left text-sm transition-colors " +
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-side-ink";
const ENTRY_IDLE = "text-side-ink-2 hover:bg-side-active hover:text-side-ink";
// L'entrée choisie : un fond, une graisse et un filet à gauche, pas la couleur seule (D92).
const ENTRY_CURRENT = "bg-side-active font-medium text-side-ink shadow-[inset_3px_0_0_var(--color-side-ink)]";

function MenuLink({ href, current, children }: { href: string; current: boolean; children: ReactNode }) {
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className={cx(ENTRY, current ? ENTRY_CURRENT : ENTRY_IDLE)}>
      {children}
    </Link>
  );
}

/** Le menu sans état : le chemin affiché et l'ouverture viennent de l'appelant. */
export function AdminMenu({
  user,
  pathname,
  open,
  onToggle,
}: {
  user: MenuUser;
  pathname: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <div className="flex h-12 items-center justify-between gap-4 border-b border-side-line bg-side px-4 text-side-ink lg:hidden">
        <div className="font-display font-semibold tracking-tight">School Data Pipeline</div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={MENU_ID}
          onClick={onToggle}
          className="inline-flex h-8 items-center rounded-control px-3 text-compact font-medium text-side-ink transition-colors hover:bg-side-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-side-ink"
        >
          Menu
        </button>
      </div>
      <aside
        id={MENU_ID}
        className={cx(
          open ? "flex" : "hidden",
          "flex-col border-b border-side-line bg-side text-side-ink",
          "lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-b-0",
        )}
      >
        <div className="hidden h-14 shrink-0 items-center border-b border-side-line px-5 font-display font-semibold tracking-tight lg:flex">
          School Data Pipeline
        </div>
        <div className="flex items-center gap-3 border-b border-side-line px-5 py-4">
          <div aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-side-active text-xs font-semibold">
            {user.name?.substring(0, 2).toUpperCase() || "AD"}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-medium wrap-break-word">{user.name}</p>
            <p className="text-xs text-side-ink-2">{ROLE_LABELS[user.role]}</p>
          </div>
        </div>

        <nav aria-label="Navigation du back-office" className="flex flex-1 flex-col gap-1 px-3 py-4">
          {navFor(user.role).map((item) => (
            <MenuLink key={item.href} href={item.href} current={pathname.startsWith(item.href)}>
              {item.label}
            </MenuLink>
          ))}
        </nav>

        <div className="flex flex-col gap-1 border-t border-side-line px-3 py-4">
          {/* Hors du menu par rôle : « Aide » (étape 14, D109) et « Mon compte » sont des pages du site, ouvertes à toute session. */}
          <MenuLink href="/help" current={pathname.startsWith("/help")}>
            Aide
          </MenuLink>
          <MenuLink href="/account" current={pathname.startsWith("/account")}>
            Mon compte
          </MenuLink>
          <button type="button" onClick={() => signOut({ callbackUrl: "/admin/login" })} className={cx(ENTRY, ENTRY_IDLE)}>
            Déconnexion
          </button>
        </div>
      </aside>
    </>
  );
}

export default function SidebarClient({ user }: { user: MenuUser }) {
  const pathname = usePathname();
  // Le menu replié s'ouvre pour la page affichée : il se referme de lui-même
  // quand elle change (D94), sans effet à synchroniser.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;

  return <AdminMenu user={user} pathname={pathname} open={open} onToggle={() => setOpenOn(open ? null : pathname)} />;
}
