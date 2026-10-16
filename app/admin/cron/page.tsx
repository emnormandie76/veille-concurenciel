import { requirePage } from "@/lib/auth";
import CronMonitoringClient from "./CronMonitoringClient";

/**
 * /admin/cron — passes dues, recherche ciblée et historique du pipeline.
 *
 * Réservé à ADMIN (plan gestion-contenu, étape 1 : l'IA est réservée à
 * l'admin). Le contrôle se fait ici, côté serveur, et dans chaque route que
 * l'écran appelle (`guardAdmin`). Un gestionnaire est renvoyé vers les écoles.
 */
export default async function CronPage() {
  const session = await requirePage("admin");
  return <CronMonitoringClient isAdmin={session.user.role === "ADMIN"} />;
}
