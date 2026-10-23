import { guardManager } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidateContent } from "@/lib/content-cache";
import { provenance } from "@/lib/provenance";
import { invalidBody } from "@/lib/account-admin";
import { readFormBody } from "@/lib/request-body";

export async function GET() {
  const { error } = await guardManager();
  if (error) return error;

  try {
    const schools = await prisma.school.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { campuses: true }
        }
      }
    });
    return NextResponse.json(schools);
  } catch (error) {
    console.error("GET /api/admin/schools error:", error);
    return NextResponse.json({ error: "Erreur serveur lors de la récupération" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { session, error } = await guardManager();
  if (error) return error;

  try {
    const body = await readFormBody(request);
    if (!body) return invalidBody();
    const { name, official_domain } = body;

    // Contrôle après nettoyage : jusqu'au 14 octobre 2026, un nom fait d'espaces
    // passait et une chaîne vide était écrite (décision 12, plan backend-local).
    const cleanName = typeof name === "string" ? name.trim() : "";
    const cleanDomain = typeof official_domain === "string" ? official_domain.trim().toLowerCase() : "";

    if (!cleanName || !cleanDomain) {
      return NextResponse.json({ error: "Le nom et le domaine officiel sont requis" }, { status: 400 });
    }

    // Vérifier l'existence d'une école avec le même nom ou domaine
    const existing = await prisma.school.findFirst({
      where: {
        OR: [
          { name: cleanName },
          { official_domain: cleanDomain }
        ]
      }
    });

    if (existing) {
      return NextResponse.json(
        { error: "Une école avec ce nom ou ce domaine officiel existe déjà." },
        { status: 400 }
      );
    }

    const school = await prisma.school.create({
      data: {
        name: cleanName,
        official_domain: cleanDomain,
        status: "ACTIVE",
        // L'auteur vient de la session, jamais du corps (étape 5, D10).
        ...provenance(session.user.id, "MANUAL"),
      }
    });

    revalidateContent();
    return NextResponse.json(school, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/schools error:", error);
    return NextResponse.json({ error: "Erreur serveur lors de la création" }, { status: 500 });
  }
}
