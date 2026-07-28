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
  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get("year");

  try {
    const school = await prisma.school.findUnique({ where: { id } });
    if (!school) {
      return NextResponse.json({ error: "École introuvable" }, { status: 404 });
    }

    const allRecords = await prisma.schoolStatsRecord.findMany({
      where: { schoolId: id },
      select: { academic_year: true },
      orderBy: { academic_year: "desc" },
    });

    const availableYears = allRecords.map((r) => r.academic_year);

    let record = null;
    if (yearParam) {
      const year = parseInt(yearParam);
      if (!isNaN(year)) {
        record = await prisma.schoolStatsRecord.findUnique({
          where: {
            schoolId_academic_year: {
              schoolId: id,
              academic_year: year,
            },
          },
        });
      }
    } else if (availableYears.length > 0) {
      record = await prisma.schoolStatsRecord.findUnique({
        where: {
          schoolId_academic_year: {
            schoolId: id,
            academic_year: availableYears[0],
          },
        },
      });
    }

    return NextResponse.json({
      availableYears,
      record,
    });
  } catch (err) {
    console.error(`GET /api/admin/schools/${id}/stats error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardAuth();
  if (error) return error;

  const { id } = await params;

  try {
    const body = await request.json();
    const {
      academic_year,
      total_students,
      total_alumni,
      partner_companies,
      annual_internship_offers,
      abroad_campuses,
      partner_universities,
      permanent_professors,
      international_professors_pct,
      external_speakers_pct,
    } = body;

    const yearNum = parseInt(academic_year);
    const currentYear = new Date().getFullYear();
    if (isNaN(yearNum) || yearNum < 2000 || yearNum > currentYear + 2) {
      return NextResponse.json(
        { error: `L'année académique doit être comprise entre 2000 et ${currentYear + 2}` },
        { status: 400 }
      );
    }

    const school = await prisma.school.findUnique({ where: { id } });
    if (!school) {
      return NextResponse.json({ error: "École introuvable" }, { status: 404 });
    }

    const parseOptInt = (val: any) => (val !== undefined && val !== null && val !== "" ? parseInt(val) : null);
    const parseOptFloat = (val: any) => (val !== undefined && val !== null && val !== "" ? parseFloat(val) : null);

    const data = {
      total_students: parseOptInt(total_students),
      total_alumni: parseOptInt(total_alumni),
      partner_companies: parseOptInt(partner_companies),
      annual_internship_offers: parseOptInt(annual_internship_offers),
      abroad_campuses: parseOptInt(abroad_campuses),
      partner_universities: parseOptInt(partner_universities),
      permanent_professors: parseOptInt(permanent_professors),
      international_professors_pct: parseOptFloat(international_professors_pct),
      external_speakers_pct: parseOptFloat(external_speakers_pct),
    };

    const record = await prisma.schoolStatsRecord.upsert({
      where: {
        schoolId_academic_year: {
          schoolId: id,
          academic_year: yearNum,
        },
      },
      update: data,
      create: {
        schoolId: id,
        academic_year: yearNum,
        ...data,
      },
    });

    return NextResponse.json(record);
  } catch (err) {
    console.error(`PUT /api/admin/schools/${id}/stats error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
