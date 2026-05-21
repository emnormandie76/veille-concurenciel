import { NextResponse } from "next/server";
import { guardAuth } from "@/lib/auth";

export async function GET(request: Request) {
  // Guard authentication
  const { error } = await guardAuth();
  if (error) return error;

  const fastapiUrl = process.env.FASTAPI_URL || "http://localhost:8000";
  const token = process.env.FASTAPI_INTERNAL_TOKEN;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

    const res = await fetch(`${fastapiUrl}/internal/pipeline-status`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
      next: { revalidate: 0 }, // bypass cache
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Le backend a renvoyé une erreur: ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("Erreur de connexion au backend FastAPI:", err);
    // Return 503 to signal backend is down/starting up
    return NextResponse.json(
      { error: "Backend indisponible (Cold Start possible)" },
      { status: 503 }
    );
  }
}
