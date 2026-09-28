import { NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth";
import { internalApiToken, fastapiUrl } from "@/lib/internal-api";
import { parseTriggerResearchBody } from "@/lib/trigger-research";

/**
 * POST /api/admin/trigger-research
 *
 * Proxy vers FastAPI /internal/trigger-targeted-research/{school_id}
 * Permet de lancer une recherche ciblée depuis le panneau admin/cron.
 *
 * Body: { school_id, phase, program_id?, categories?, collect_campus_attachments? }
 *
 * `collect_campus_attachments` (Phase 1 seulement) vaut false par défaut :
 * voir lib/trigger-research.ts.
 */
export async function POST(request: Request) {
  const { error } = await guardAdmin();
  if (error) return error;

  const baseUrl = fastapiUrl();
  const token = internalApiToken();

  try {
    const body = await request.json();
    const parsed = parseTriggerResearchBody(body);

    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.error },
        { status: 400 }
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(
      `${baseUrl}/internal/trigger-targeted-research/${parsed.schoolId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(parsed.forward),
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || `Erreur backend (${res.status})` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("Erreur trigger-research:", err);
    if (err.name === "AbortError") {
      return NextResponse.json(
        { error: "Timeout — le backend n'a pas répondu dans les temps" },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: "Backend indisponible" },
      { status: 503 }
    );
  }
}
