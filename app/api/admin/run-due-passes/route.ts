/**
 * POST /api/admin/run-due-passes
 *
 * Les passes dues, lancées depuis /admin/cron : relaie
 * `POST /internal/run-due-passes` du backend local (architecture.md §2.3 et
 * §5.5). ADMIN seulement : une passe réelle paie Research.
 *
 * Body : `{ max_passes?: 1..5, dry_run: boolean }`, relu par
 * `parseRunDuePassesBody` (lib/rotation-status.ts) avec les règles du backend :
 * `dry_run` exigé et booléen, aucun autre champ. Une passe payante ne part
 * jamais par défaut. Refus en 400, sans appel au backend.
 *
 * - `dry_run: true` → 200 et le plan, sans job ni appel Research ;
 * - `dry_run: false` → 202 et ce qui part, après la synchro `/usage` du
 *   backend (jusqu'à 20 s) : le délai de la route la couvre ;
 * - 409, 503 (`USAGE_SYNC_FAILED`, `KEY_MANAGER_MISSING`) du backend : tels
 *   quels ;
 * - en ligne, sans `FASTAPI_URL` : 503 `BACKEND_LOCAL_ONLY`, sans appel.
 */

import { NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth";
import { BACKEND_TIMEOUTS_MS, backendTarget, backendUnavailable, relayToBackend } from "@/lib/internal-api";
import { parseRunDuePassesBody } from "@/lib/rotation-status";

export async function POST(request: Request) {
  const { error } = await guardAdmin();
  if (error) return error;

  const target = backendTarget();
  if (!target.ok) return backendUnavailable(target.code);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON illisible" }, { status: 400 });
  }

  const parsed = parseRunDuePassesBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  return relayToBackend("/internal/run-due-passes", {
    method: "POST",
    body: parsed.forward,
    timeoutMs: BACKEND_TIMEOUTS_MS.duePasses,
    mayHaveStarted: !parsed.forward.dry_run,
  });
}
