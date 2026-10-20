import type { Metadata } from "next";
import ReportsManagerClient from "./ReportsManagerClient";

export const metadata: Metadata = { title: "Signalements" };

/**
 * /admin/reports — les signalements (plan gestion-contenu, étape 6, D31)
 *
 * Gestionnaires et admins : le layout du back-office l'impose
 * (`requirePage("manager")`, app/admin/layout.tsx), et les routes qui portent
 * les données aussi (GET /api/admin/reports, PATCH /api/admin/reports/[id],
 * `guardManager`). À part de l'inbox, qui reste à l'admin et à l'IA.
 */
export default function ReportsPage() {
  return <ReportsManagerClient />;
}
