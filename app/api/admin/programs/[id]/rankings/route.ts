import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardManager } from "@/lib/auth";
import { revalidateContent } from "@/lib/content-cache";
import { provenance, readSourceUrl } from "@/lib/provenance";
import { invalidBody } from "@/lib/account-admin";
import { readFormBody } from "@/lib/request-body";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await guardManager();
  if (error) return error;

  const { id: programId } = await params;

  try {
    const body = await readFormBody(request);
    if (!body) return invalidBody();
    const { ranking_name, rank, academic_year, source_url } = body;

    const cleanRankingName = ranking_name?.trim();
    if (!cleanRankingName) {
      return NextResponse.json(
        { error: "Le nom du classement est obligatoire" },
        { status: 400 }
      );
    }

    const rankNum = parseInt(rank);
    if (isNaN(rankNum) || rankNum < 1) {
      return NextResponse.json(
        { error: "Le rang doit être un nombre supérieur ou égal à 1" },
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

    // D27 : un lien source saisi est une adresse web, ou rien.
    const source = readSourceUrl(source_url);
    if (!source.ok) {
      return NextResponse.json({ error: source.error }, { status: 400 });
    }

    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) {
      return NextResponse.json({ error: "Programme introuvable" }, { status: 404 });
    }

    const existing = await prisma.rankingRecord.findUnique({
      where: {
        programId_academic_year_ranking_name: {
          programId,
          academic_year: yearNum,
          ranking_name: cleanRankingName,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Un classement avec ce nom existe déjà pour ce programme et cette année" },
        { status: 400 }
      );
    }

    const record = await prisma.rankingRecord.create({
      data: {
        programId,
        ranking_name: cleanRankingName,
        rank: rankNum,
        academic_year: yearNum,
        source_url: source.value,
        ...provenance(session.user.id, "MANUAL"),
      },
    });

    revalidateContent();
    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    console.error(`POST /api/admin/programs/${programId}/rankings error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
