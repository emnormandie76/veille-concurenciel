import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardManager } from "@/lib/auth";
import { AUTHOR_SELECT, forManager } from "@/lib/provenance";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardManager();
  if (error) return error;

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get("year");
  const programIdParam = searchParams.get("programId");

  try {
    const school = await prisma.school.findUnique({ where: { id } });
    if (!school) {
      return NextResponse.json({ error: "École introuvable" }, { status: 404 });
    }

    const whereFilter: any = {
      program: { schoolId: id },
    };

    if (yearParam) {
      const year = parseInt(yearParam);
      if (!isNaN(year)) whereFilter.academic_year = year;
    }

    if (programIdParam) {
      whereFilter.programId = programIdParam;
    }

    const records = await prisma.rankingRecord.findMany({
      where: whereFilter,
      include: {
        updatedBy: AUTHOR_SELECT,
        program: {
          select: { id: true, name: true },
        },
      },
      orderBy: [{ academic_year: "desc" }, { ranking_name: "asc" }],
    });

    const yearsRaw = await prisma.rankingRecord.findMany({
      where: { program: { schoolId: id } },
      select: { academic_year: true },
      distinct: ["academic_year"],
      orderBy: { academic_year: "desc" },
    });

    const availableYears = yearsRaw.map((r) => r.academic_year);

    return NextResponse.json({
      availableYears,
      // « Modifié par … le … » de chaque ligne : le nom et la date (étape 5, D29).
      records: records.map(forManager),
    });
  } catch (err) {
    console.error(`GET /api/admin/schools/${id}/rankings error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
