import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardAuth } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardAuth();
  if (error) return error;

  const { id } = await params;

  try {
    const school = await prisma.school.findUnique({ where: { id } });
    if (!school) {
      return NextResponse.json({ error: "École introuvable" }, { status: 404 });
    }

    const programs = await prisma.program.findMany({
      where: { schoolId: id },
      orderBy: { name: "asc" },
      include: {
        campuses: {
          include: {
            campus: {
              select: { id: true, name: true, city: true },
            },
          },
        },
        _count: {
          select: {
            pricingRecords: true,
            rankingRecords: true,
          },
        },
      },
    });

    const formatted = programs.map((p) => ({
      id: p.id,
      schoolId: p.schoolId,
      name: p.name,
      admission_exam: p.admission_exam,
      is_alternance_possible: p.is_alternance_possible,
      is_expatriation_mandatory: p.is_expatriation_mandatory,
      min_expatriation_months: p.min_expatriation_months,
      max_internship_months: p.max_internship_months,
      _count: p._count,
      associatedCampuses: p.campuses.map((pc) => ({
        programCampusId: pc.id,
        campusId: pc.campus.id,
        campusName: pc.campus.name,
        campusCity: pc.campus.city,
      })),
    }));

    return NextResponse.json(formatted);
  } catch (err) {
    console.error(`GET /api/admin/schools/${id}/programs error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardAuth();
  if (error) return error;

  const { id } = await params;

  try {
    const body = await request.json();
    const {
      name,
      admission_exam,
      is_alternance_possible,
      is_expatriation_mandatory,
      min_expatriation_months,
      max_internship_months,
      campusIds,
    } = body;

    const cleanName = name?.trim();
    if (!cleanName) {
      return NextResponse.json(
        { error: "Le nom du programme est obligatoire" },
        { status: 400 }
      );
    }

    if (!Array.isArray(campusIds) || campusIds.length === 0) {
      return NextResponse.json(
        { error: "Au moins un campus doit être sélectionné" },
        { status: 400 }
      );
    }

    const school = await prisma.school.findUnique({ where: { id } });
    if (!school) {
      return NextResponse.json({ error: "École introuvable" }, { status: 404 });
    }

    const existingName = await prisma.program.findUnique({
      where: {
        schoolId_name: {
          schoolId: id,
          name: cleanName,
        },
      },
    });

    if (existingName) {
      return NextResponse.json(
        { error: "Un programme avec ce nom existe déjà pour cette école" },
        { status: 400 }
      );
    }

    const validCampuses = await prisma.campus.findMany({
      where: {
        id: { in: campusIds },
        schoolId: id,
      },
      select: { id: true },
    });

    if (validCampuses.length !== campusIds.length) {
      return NextResponse.json(
        { error: "Un ou plusieurs campus sélectionnés sont invalides" },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const program = await tx.program.create({
        data: {
          schoolId: id,
          name: cleanName,
          admission_exam: admission_exam?.trim() || null,
          is_alternance_possible: Boolean(is_alternance_possible),
          is_expatriation_mandatory: Boolean(is_expatriation_mandatory),
          min_expatriation_months: min_expatriation_months ? parseInt(min_expatriation_months) : null,
          max_internship_months: max_internship_months ? parseInt(max_internship_months) : null,
        },
      });

      await Promise.all(
        campusIds.map((campusId: string) =>
          tx.programCampus.create({
            data: {
              programId: program.id,
              campusId,
            },
          })
        )
      );

      return program;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error(`POST /api/admin/schools/${id}/programs error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
