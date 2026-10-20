import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardManager } from "@/lib/auth";
import { revalidateContent } from "@/lib/content-cache";
import { AUTHOR_SELECT, forManager, provenance, readSourceUrl } from "@/lib/provenance";

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
      include: { updatedBy: AUTHOR_SELECT },
    });

    // « Modifié par … le … » de chaque ligne : le nom et la date (étape 5, D29).
    return NextResponse.json(accreditations.map(forManager));
  } catch (err) {
    console.error(`GET /api/admin/schools/${id}/accreditations error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await guardManager();
  if (error) return error;

  const { id } = await params;

  try {
    const body = await request.json();
    const { accreditation_name, accreditation_type, year_obtained, is_active, source_url } = body;

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

    // Le lien source de l'accréditation (D12), contrôlé comme toute saisie (D27).
    const source = readSourceUrl(source_url);
    if (!source.ok) {
      return NextResponse.json({ error: source.error }, { status: 400 });
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
        source_url: source.value,
        ...provenance(session.user.id, "MANUAL"),
      },
    });

    revalidateContent();
    return NextResponse.json(accreditation, { status: 201 });
  } catch (err) {
    console.error(`POST /api/admin/schools/${id}/accreditations error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
