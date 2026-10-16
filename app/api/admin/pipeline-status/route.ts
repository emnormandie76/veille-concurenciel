/**
 * GET /api/admin/pipeline-status
 *
 * Relaie `GET /internal/pipeline-status` du backend local : état de la base,
 * erreurs du démarrage, jobs actifs, crédits Tavily, bloc `scheduler`
 * (architecture.md §2.3). Lecture : ADMIN seulement (`guardAdmin`, plan
 * gestion-contenu, étape 1 : l'IA est réservée à l'admin).
 *
 * En ligne, sans `FASTAPI_URL` : 503 `BACKEND_LOCAL_ONLY` tout de suite, sans
 * appel réseau. L'écran /admin/cron affiche alors « pilotage depuis le poste
 * local » et l'historique lu en base (/api/admin/pipeline-jobs). Les autres
 * cas : lib/internal-api.ts (`relayToBackend`).
 */

import { guardAdmin } from "@/lib/auth";
import { BACKEND_TIMEOUTS_MS, relayToBackend } from "@/lib/internal-api";

export async function GET() {
  const { error } = await guardAdmin();
  if (error) return error;

  return relayToBackend("/internal/pipeline-status", { timeoutMs: BACKEND_TIMEOUTS_MS.status });
}
