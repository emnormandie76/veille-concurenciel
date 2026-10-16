import { requirePage } from "@/lib/auth";
import SidebarClient from "./SidebarClient";

/**
 * Layout du back-office : gestionnaires et admins seulement (plan
 * gestion-contenu, étape 1, piège 2). Sans session, `requirePage` renvoie vers
 * la connexion (un cookie illisible compte comme une absence de session) ; un
 * USER est renvoyé vers le site. Le rôle est relu en base (D1).
 *
 * /admin/login est dans app/(admin-auth)/admin/login/ (route group séparé) :
 * ce layout ne s'y applique jamais, aucune boucle possible.
 *
 * Ce contrôle ne remplace pas ceux des écrans réservés à ADMIN
 * (inbox/layout.tsx, cron/page.tsx, users/page.tsx), ni les gardes des API qui
 * portent les données (lib/auth.ts).
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePage("manager");

  return (
    <div className="admin-layout-wrapper">
      <SidebarClient user={session.user} />
      <div className="admin-content-area">
        <div className="admin-container">{children}</div>
      </div>
    </div>
  );
}
