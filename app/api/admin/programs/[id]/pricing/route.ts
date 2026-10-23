import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardManager } from "@/lib/auth";
import { revalidateContent } from "@/lib/content-cache";
import { provenance, readSourceUrl } from "@/lib/provenance";
import { invalidNumbersMessage, readFormBody, readOptionalNumbers } from "@/lib/request-body";
import { invalidBody } from "@/lib/account-admin";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await guardManager();
  if (error) return error;

  const { id: programId } = await params;

  try {
    const body = await readFormBody(request);
    if (!body) return invalidBody();
    const {
      academic_year,
      currency,
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

    // Un tarif illisible est refusé : NaN partirait vers Prisma, qui l'écrit
    // en NULL et efface le tarif existant (décision 13, plan backend-local).
    const fees = readOptionalNumbers(body, {
      year_1_fee: "int",
      year_2_fee: "int",
      year_3_fee: "int",
      year_4_fee: "int",
      year_5_fee: "int",
      total_fee: "int",
      intl_year_1_fee: "int",
      intl_total_fee: "int",
    });
    if (fees.invalid.length > 0) {
      return NextResponse.json(
        { error: invalidNumbersMessage(fees.invalid) },
        { status: 400 }
      );
    }

    const hasAnyFee = Object.values(fees.values).some((fee) => fee !== null);

    if (!hasAnyFee) {
      return NextResponse.json(
        { error: "Au moins un tarif doit être renseigné" },
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

    const data = {
      currency: currency?.trim() || "EUR",
      ...fees.values,
      intl_currency: intl_currency?.trim() || null,
      additional_fees_notes: additional_fees_notes?.trim() || null,
      source_url: source.value,
      ...provenance(session.user.id, "MANUAL"),
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

    revalidateContent();
    return NextResponse.json(record);
  } catch (err) {
    console.error(`PUT /api/admin/programs/${programId}/pricing error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
