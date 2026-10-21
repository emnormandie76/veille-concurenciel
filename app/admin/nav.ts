/**
 * app/admin/nav.ts — Le menu du back-office, par rôle
 *
 * Chaque entrée porte le niveau de l'écran qu'elle ouvre ; le contrôle réel
 * se fait côté serveur (`requirePage`, lib/auth.ts) et dans les API. Le menu
 * ne fait que ne pas montrer ce que le rôle ne permet pas
 * (test/admin-pages.test.ts). Texte seul depuis l'étape 9, lot 6 (D93) :
 * les émojis des entrées sont partis avec le champ `icon`.
 */

import { hasAccess, type AccessLevel, type UserRole } from "@/lib/roles";

export interface NavItem {
  href: string;
  label: string;
  level: AccessLevel;
}

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin/schools", label: "Écoles & Campus", level: "manager" },
  // Étape 6 (D31) : les signalements, à part de l'inbox, qui reste à l'IA.
  { href: "/admin/reports", label: "Signalements", level: "manager" },
  { href: "/admin/inbox", label: "Validation Inbox", level: "admin" },
  { href: "/admin/cron", label: "Monitoring & Cron", level: "admin" },
  { href: "/admin/users", label: "Comptes", level: "admin" },
];

/** Les entrées que `role` peut ouvrir, dans l'ordre du menu. */
export function navFor(role: UserRole): NavItem[] {
  // Un USER ne voit pas le back-office du tout (layout /admin).
  if (!hasAccess(role, "manager")) return [];
  return ADMIN_NAV.filter((item) => hasAccess(role, item.level));
}
