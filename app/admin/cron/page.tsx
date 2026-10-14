import { getSession } from "@/lib/auth";
import CronMonitoringClient from "./CronMonitoringClient";

/**
 * /admin/cron — passes dues, recherche ciblée et historique du pipeline.
 *
 * Lecture : toute session (le layout admin redirige sans session). Les
 * lancements (passes dues, recherche ciblée) sont réservés à ADMIN : les
 * routes le vérifient (`guardAdmin`), et l'écran ne les propose qu'à un ADMIN
 * (architecture.md §7.4). Le rôle est lu ici, côté serveur, comme sur
 * /admin/users.
 */
export default async function CronPage() {
  let isAdmin = false;
  try {
    const session = await getSession();
    isAdmin = session?.user.role === "ADMIN";
  } catch {
    // Cookie illisible : le layout admin redirige vers la connexion. Faute de
    // rôle, l'écran ne propose aucun lancement.
  }
  return <CronMonitoringClient isAdmin={isAdmin} />;
}
