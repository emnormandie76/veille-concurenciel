import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardAuth } from "@/lib/auth";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardAuth();
  if (error) return error;

  const { id: programId } = await params;

  try {
    const body = await request.json();
    const {
      academic_year,
      currency,
      year_1_fee,
      year_2_fee,
      year_3_fee,
      year_4_fee,
      year_5_fee,
      total_fee,
      intl_year_1_fee,
      intl_total_fee,
      intl_currency,
      additional_fees_notes,
      source_url,
    } = body;

    const yearNum = parseInt(academic_year);
    if (isNaN(yearNum) || yearNum < 2000) {
      return NextResponse.json(
        { error: "L'année académique est invalide" },
        { status: 400 }
      );
    }

    const parseOptInt = (val: any) => (val !== undefined && val !== null && val !== "" ? parseInt(val) : null);

    const hasAnyFee =
      parseOptInt(year_1_fee) !== null ||
      parseOptInt(year_2_fee) !== null ||
      parseOptInt(year_3_fee) !== null ||
      parseOptInt(year_4_fee) !== null ||
      parseOptInt(year_5_fee) !== null ||
      parseOptInt(total_fee) !== null ||
      parseOptInt(intl_year_1_fee) !== null ||
      parseOptInt(intl_total_fee) !== null;

    if (!hasAnyFee) {
      return NextResponse.json(
        { error: "Au moins un tarif doit être renseigné" },
        { status: 400 }
      );
    }

    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) {
      return NextResponse.json({ error: "Programme introuvable" }, { status: 404 });
    }

    const data = {
      currency: currency?.trim() || "EUR",
      year_1_fee: parseOptInt(year_1_fee),
      year_2_fee: parseOptInt(year_2_fee),
      year_3_fee: parseOptInt(year_3_fee),
      year_4_fee: parseOptInt(year_4_fee),
      year_5_fee: parseOptInt(year_5_fee),
      total_fee: parseOptInt(total_fee),
      intl_year_1_fee: parseOptInt(intl_year_1_fee),
      intl_total_fee: parseOptInt(intl_total_fee),
      intl_currency: intl_currency?.trim() || null,
      additional_fees_notes: additional_fees_notes?.trim() || null,
      source_url: source_url?.trim() || null,
    };

    const record = await prisma.pricingRecord.upsert({
      where: {
        programId_academic_year: {
          programId,
          academic_year: yearNum,
        },
      },
      update: data,
      create: {
        programId,
        academic_year: yearNum,
        ...data,
      },
    });

    return NextResponse.json(record);
  } catch (err) {
    console.error(`PUT /api/admin/programs/${programId}/pricing error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
