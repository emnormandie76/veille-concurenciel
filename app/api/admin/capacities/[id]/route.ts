import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardAuth } from "@/lib/auth";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardAuth();
  if (error) return error;

  const { id } = await params;

  try {
    const body = await request.json();
    const { spots_available, academic_year, source_url } = body;

    const existingRecord = await prisma.capacityRecord.findUnique({
      where: { id },
    });

    if (!existingRecord) {
      return NextResponse.json({ error: "Capacité introuvable" }, { status: 404 });
    }

    const data: Record<string, any> = {};

    if (spots_available !== undefined) {
      const spotsNum = parseInt(spots_available);
      if (isNaN(spotsNum) || spotsNum < 0) {
        return NextResponse.json(
          { error: "Le nombre de places doit être un entier ≥ 0" },
          { status: 400 }
        );
      }
      data.spots_available = spotsNum;
    }

    if (academic_year !== undefined) {
      const yearNum = parseInt(academic_year);
      const currentYear = new Date().getFullYear();
      if (isNaN(yearNum) || yearNum < 2000 || yearNum > currentYear + 2) {
        return NextResponse.json(
          { error: `L'année académique doit être comprise entre 2000 et ${currentYear + 2}` },
          { status: 400 }
        );
      }
      data.academic_year = yearNum;
    }

    if (source_url !== undefined) {
      data.source_url = source_url?.trim() || null;
    }

    const targetAcademicYear = data.academic_year || existingRecord.academic_year;

    if (targetAcademicYear !== existingRecord.academic_year) {
      const duplicate = await prisma.capacityRecord.findUnique({
        where: {
          programCampusId_academic_year: {
            programCampusId: existingRecord.programCampusId,
            academic_year: targetAcademicYear,
          },
        },
      });

      if (duplicate && duplicate.id !== id) {
        return NextResponse.json(
          { error: "Une capacité existe déjà pour ce programme-campus et cette année" },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.capacityRecord.update({
      where: { id },
      data,
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error(`PUT /api/admin/capacities/${id} error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardAuth();
  if (error) return error;

  const { id } = await params;

  try {
    const existing = await prisma.capacityRecord.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Capacité introuvable" }, { status: 404 });
    }

    await prisma.capacityRecord.delete({ where: { id } });

    return NextResponse.json({ message: "Capacité supprimée avec succès" });
  } catch (err) {
    console.error(`DELETE /api/admin/capacities/${id} error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
