import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardAuth } from "@/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardAuth();
  if (error) return error;

  const { id: programCampusId } = await params;

  try {
    const body = await request.json();
    const { spots_available, academic_year, source_url } = body;

    const spotsNum = parseInt(spots_available);
    if (isNaN(spotsNum) || spotsNum < 0) {
      return NextResponse.json(
        { error: "Le nombre de places disponibles doit être un entier ≥ 0" },
        { status: 400 }
      );
    }

    const yearNum = parseInt(academic_year);
    const currentYear = new Date().getFullYear();
    if (isNaN(yearNum) || yearNum < 2000 || yearNum > currentYear + 2) {
      return NextResponse.json(
        { error: `L'année académique doit être comprise entre 2000 et ${currentYear + 2}` },
        { status: 400 }
      );
    }

    const pc = await prisma.programCampus.findUnique({ where: { id: programCampusId } });
    if (!pc) {
      return NextResponse.json({ error: "Association Programme-Campus introuvable" }, { status: 404 });
    }

    const existing = await prisma.capacityRecord.findUnique({
      where: {
        programCampusId_academic_year: {
          programCampusId,
          academic_year: yearNum,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Une capacité existe déjà pour ce programme-campus et cette année" },
        { status: 400 }
      );
    }

    const record = await prisma.capacityRecord.create({
      data: {
        programCampusId,
        spots_available: spotsNum,
        academic_year: yearNum,
        source_url: source_url?.trim() || null,
      },
    });

    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    console.error(`POST /api/admin/program-campuses/${programCampusId}/capacity error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
