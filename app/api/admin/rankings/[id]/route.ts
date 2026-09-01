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
    const { ranking_name, rank, academic_year, source_url } = body;

    const existingRecord = await prisma.rankingRecord.findUnique({
      where: { id },
    });

    if (!existingRecord) {
      return NextResponse.json({ error: "Classement introuvable" }, { status: 404 });
    }

    const data: Record<string, any> = {};

    if (ranking_name !== undefined) {
      const cleanName = ranking_name.trim();
      if (!cleanName) {
        return NextResponse.json(
          { error: "Le nom du classement ne peut pas être vide" },
          { status: 400 }
        );
      }
      data.ranking_name = cleanName;
    }

    if (rank !== undefined) {
      const rankNum = parseInt(rank);
      if (isNaN(rankNum) || rankNum < 1) {
        return NextResponse.json(
          { error: "Le rang doit être ≥ 1" },
          { status: 400 }
        );
      }
      data.rank = rankNum;
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

    const targetRankingName = data.ranking_name || existingRecord.ranking_name;
    const targetAcademicYear = data.academic_year || existingRecord.academic_year;

    if (
      targetRankingName !== existingRecord.ranking_name ||
      targetAcademicYear !== existingRecord.academic_year
    ) {
      const duplicate = await prisma.rankingRecord.findUnique({
        where: {
          programId_academic_year_ranking_name: {
            programId: existingRecord.programId,
            academic_year: targetAcademicYear,
            ranking_name: targetRankingName,
          },
        },
      });

      if (duplicate && duplicate.id !== id) {
        return NextResponse.json(
          { error: "Un classement avec ce nom existe déjà pour ce programme et cette année" },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.rankingRecord.update({
      where: { id },
      data,
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error(`PUT /api/admin/rankings/${id} error:`, err);
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
    const existing = await prisma.rankingRecord.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Classement introuvable" }, { status: 404 });
    }

    await prisma.rankingRecord.delete({ where: { id } });

    return NextResponse.json({ message: "Classement supprimé avec succès" });
  } catch (err) {
    console.error(`DELETE /api/admin/rankings/${id} error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
