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
    const school = await prisma.school.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            campuses: true,
            programs: true,
            accreditations: true,
            statsRecords: true,
          },
        },
      },
    });

    if (!school) {
      return NextResponse.json({ error: "École introuvable" }, { status: 404 });
    }

    const [pricingCount, rankingCount, capacityCount] = await Promise.all([
      prisma.pricingRecord.count({ where: { program: { schoolId: id } } }),
      prisma.rankingRecord.count({ where: { program: { schoolId: id } } }),
      prisma.capacityRecord.count({
        where: { programCampus: { campus: { schoolId: id } } },
      }),
    ]);

    const statsYears = await prisma.schoolStatsRecord.findMany({
      where: { schoolId: id },
      select: { academic_year: true },
      orderBy: { academic_year: "desc" },
    });

    return NextResponse.json({
      ...school,
      _counts: {
        campuses: school._count.campuses,
        programs: school._count.programs,
        accreditations: school._count.accreditations,
        statsRecords: school._count.statsRecords,
        pricingRecords: pricingCount,
        rankingRecords: rankingCount,
        capacityRecords: capacityCount,
        statsYears: statsYears.map((s) => s.academic_year),
      },
    });
  } catch (err) {
    console.error(`GET /api/admin/schools/${id}/manage error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
