import { guardManager } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidateContent } from "@/lib/content-cache";
import { AUTHOR_SELECT, forManager, provenance } from "@/lib/provenance";
import { invalidBody } from "@/lib/account-admin";
import { readFormBody } from "@/lib/request-body";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardManager();
  if (error) return error;

  const { id: schoolId } = await params;

  try {
    // Une école inconnue est un 404, comme sur les routes voisines ; jusqu'au
    // 14 octobre 2026, elle rendait une liste vide (décision 14, plan
    // backend-local).
    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) {
      return NextResponse.json({ error: "École introuvable" }, { status: 404 });
    }

    const campuses = await prisma.campus.findMany({
      where: { schoolId },
      orderBy: { name: "asc" },
      include: { updatedBy: AUTHOR_SELECT },
    });
    // « Modifié par … le … » de chaque ligne : le nom et la date (étape 5, D29).
    return NextResponse.json(campuses.map(forManager));
  } catch (error) {
    console.error(`GET /api/admin/schools/${schoolId}/campuses error:`, error);
    return NextResponse.json({ error: "Erreur serveur lors de la récupération des campus" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await guardManager();
  if (error) return error;

  const { id: schoolId } = await params;

  try {
    const body = await readFormBody(request);
    if (!body) return invalidBody();
    const { name, city } = body;

    // Contrôle après nettoyage : jusqu'au 14 octobre 2026, un nom fait d'espaces
    // passait et une chaîne vide était écrite (décision 12, plan backend-local).
    const cleanName = typeof name === "string" ? name.trim() : "";
    if (!cleanName) {
      return NextResponse.json({ error: "Le nom du campus est requis" }, { status: 400 });
    }

    const cleanCity = city?.trim() || null;

    // Vérifier que l'école existe
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
    });

    if (!school) {
      return NextResponse.json({ error: "École introuvable" }, { status: 404 });
    }

    // Vérifier l'unicité @@unique([schoolId, name])
    const existing = await prisma.campus.findUnique({
      where: {
        schoolId_name: {
          schoolId,
          name: cleanName,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Un campus avec ce nom existe déjà pour cette école" },
        { status: 400 }
      );
    }

    const campus = await prisma.campus.create({
      data: {
        schoolId,
        name: cleanName,
        city: cleanCity,
        ...provenance(session.user.id, "MANUAL"),
      },
    });

    revalidateContent();
    return NextResponse.json(campus, { status: 201 });
  } catch (error) {
    console.error(`POST /api/admin/schools/${schoolId}/campuses error:`, error);
    return NextResponse.json({ error: "Erreur serveur lors de la création du campus" }, { status: 500 });
  }
}
