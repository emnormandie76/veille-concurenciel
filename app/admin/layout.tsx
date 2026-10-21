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
 *
 * Le cadre, dans la charte depuis l'étape 9 (lot 6) : le menu (une colonne
 * au-delà de 1 024 px, une barre et un menu repliable en deçà, D94), puis le
 * `main`, qui garde sur grand écran les marges d'avant (40 px, 1 200 px au
 * plus) et ne laisse que 16 px de gouttière sur un téléphone. `min-w-0` : un
 * tableau large défile dans son cadre au lieu d'élargir la page.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePage("manager");

  return (
    <div className="min-h-screen lg:flex">
      <SidebarClient user={session.user} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:p-10">
        <div className="mx-auto w-full max-w-300">{children}</div>
      </main>
    </div>
  );
}
