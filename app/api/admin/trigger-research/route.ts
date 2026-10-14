import { NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth";
import { BACKEND_TIMEOUTS_MS, backendTarget, backendUnavailable, relayToBackend } from "@/lib/internal-api";
import { parseTriggerResearchBody } from "@/lib/trigger-research";

/**
 * POST /api/admin/trigger-research
 *
 * Proxy vers FastAPI /internal/trigger-targeted-research/{school_id}
 * Permet de lancer une recherche ciblée depuis le panneau admin/cron.
 * ADMIN seulement : elle paie Research.
 *
 * Body: { school_id, phase, program_id?, categories?, collect_campus_attachments? }
 *
 * `collect_campus_attachments` (Phase 1 seulement) vaut false par défaut :
 * voir lib/trigger-research.ts.
 *
 * En ligne, sans `FASTAPI_URL` : 503 `BACKEND_LOCAL_ONLY`, sans appel. Corps
 * invalide ou illisible : 400. Sinon la réponse du backend passe telle quelle
 * (lib/internal-api.ts, `relayToBackend`).
 */
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

  const parsed = parseTriggerResearchBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  return relayToBackend(
    `/internal/trigger-targeted-research/${encodeURIComponent(parsed.schoolId)}`,
    {
      method: "POST",
      body: parsed.forward,
      timeoutMs: BACKEND_TIMEOUTS_MS.trigger,
      mayHaveStarted: true,
    }
  );
}
