import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardManager } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardManager();
  if (error) return error;

  const { id } = await params;

  try {
    const school = await prisma.school.findUnique({ where: { id } });
    if (!school) {
      return NextResponse.json({ error: "École introuvable" }, { status: 404 });
    }

    const accreditations = await prisma.accreditationRecord.findMany({
      where: { schoolId: id },
      orderBy: { accreditation_name: "asc" },
    });

    return NextResponse.json(accreditations);
  } catch (err) {
    console.error(`GET /api/admin/schools/${id}/accreditations error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardManager();
  if (error) return error;

  const { id } = await params;

  try {
    const body = await request.json();
    const { accreditation_name, accreditation_type, year_obtained, is_active } = body;

    const cleanName = accreditation_name?.trim();
    if (!cleanName) {
      return NextResponse.json(
        { error: "Le nom de l'accréditation est obligatoire" },
        { status: 400 }
      );
    }

    if (!accreditation_type || !["international", "state", "label"].includes(accreditation_type)) {
      return NextResponse.json(
        { error: "Le type doit être international, state ou label" },
        { status: 400 }
      );
    }

    // L'année est facultative : la colonne accepte NULL depuis que l'année
    // inconnue ne s'écrit plus 0. Fournie, elle reste bornée.
    let yearNum: number | null = null;
    if (year_obtained !== undefined && year_obtained !== null && year_obtained !== "") {
      const parsed = parseInt(year_obtained);
      const currentYear = new Date().getFullYear();
      if (isNaN(parsed) || parsed < 2000 || parsed > currentYear + 2) {
        return NextResponse.json(
          { error: `L'année d'obtention doit être comprise entre 2000 et ${currentYear + 2}` },
          { status: 400 }
        );
      }
      yearNum = parsed;
    }

    const school = await prisma.school.findUnique({ where: { id } });
    if (!school) {
      return NextResponse.json({ error: "École introuvable" }, { status: 404 });
    }

    const existing = await prisma.accreditationRecord.findUnique({
      where: {
        schoolId_accreditation_name: {
          schoolId: id,
          accreditation_name: cleanName,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Cette accréditation existe déjà pour cette école" },
        { status: 400 }
      );
    }

    const accreditation = await prisma.accreditationRecord.create({
      data: {
        schoolId: id,
        accreditation_name: cleanName,
        accreditation_type,
        year_obtained: yearNum,
        is_active: is_active ?? true,
      },
    });

    return NextResponse.json(accreditation, { status: 201 });
  } catch (err) {
    console.error(`POST /api/admin/schools/${id}/accreditations error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
