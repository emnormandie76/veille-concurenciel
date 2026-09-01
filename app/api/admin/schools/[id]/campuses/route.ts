import { guardAuth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardAuth();
  if (error) return error;

  const { id: schoolId } = await params;

  try {
    const campuses = await prisma.campus.findMany({
      where: { schoolId },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(campuses);
  } catch (error) {
    console.error(`GET /api/admin/schools/${schoolId}/campuses error:`, error);
    return NextResponse.json({ error: "Erreur serveur lors de la récupération des campus" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardAuth();
  if (error) return error;

  const { id: schoolId } = await params;

  try {
    const body = await request.json();
    const { name, city } = body;

    if (!name) {
      return NextResponse.json({ error: "Le nom du campus est requis" }, { status: 400 });
    }

    const cleanName = name.trim();
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
      },
    });

    return NextResponse.json(campus, { status: 201 });
  } catch (error) {
    console.error(`POST /api/admin/schools/${schoolId}/campuses error:`, error);
    return NextResponse.json({ error: "Erreur serveur lors de la création du campus" }, { status: 500 });
  }
}
