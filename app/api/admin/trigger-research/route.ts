import { NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth";
import { internalApiToken, fastapiUrl } from "@/lib/internal-api";

/**
 * POST /api/admin/trigger-research
 * 
 * Proxy vers FastAPI /internal/trigger-targeted-research/{school_id}
 * Permet de lancer une recherche ciblée depuis le panneau admin/cron.
 * 
 * Body: { school_id, phase, program_id?, categories? }
 */
export async function POST(request: Request) {
  const { error } = await guardAdmin();
  if (error) return error;

  const baseUrl = fastapiUrl();
  const token = internalApiToken();

  try {
    const body = await request.json();
    const { school_id, phase, program_id, categories } = body;

    if (!school_id) {
      return NextResponse.json(
        { error: "school_id est requis" },
        { status: 400 }
      );
    }

    if (!phase || !["1", "2"].includes(phase)) {
      return NextResponse.json(
        { error: "phase doit être '1' ou '2'" },
        { status: 400 }
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(
      `${baseUrl}/internal/trigger-targeted-research/${school_id}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phase,
          program_id: program_id || null,
          categories: categories || null,
        }),
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
