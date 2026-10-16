import { requirePage } from "@/lib/auth";
import UsersManagerClient from "./UsersManagerClient";

/**
 * /admin/users — les comptes, réservés à ADMIN. Le contrôle se fait ici, côté
 * serveur, et dans les routes /api/admin/users (`guardAdmin`). Un gestionnaire
 * est renvoyé vers les écoles.
 */
export default async function UsersPage() {
  const session = await requirePage("admin");
  return <UsersManagerClient currentUserId={session.user.id} />;
}
