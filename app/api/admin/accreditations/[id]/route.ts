import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardManager } from "@/lib/auth";
import { revalidateContent } from "@/lib/content-cache";
import { provenance, readSourceUrl } from "@/lib/provenance";
import { invalidBody } from "@/lib/account-admin";
import { readFormBody } from "@/lib/request-body";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await guardManager();
  if (error) return error;

  const { id } = await params;

  try {
    const body = await readFormBody(request);
    if (!body) return invalidBody();
    const { accreditation_name, accreditation_type, year_obtained, is_active, source_url } = body;

    const existingRecord = await prisma.accreditationRecord.findUnique({
      where: { id },
    });

    if (!existingRecord) {
      return NextResponse.json(
        { error: "Accréditation introuvable" },
        { status: 404 }
      );
    }

    const data: Record<string, any> = {};

    if (accreditation_name !== undefined) {
      const cleanName = accreditation_name.trim();
      if (!cleanName) {
        return NextResponse.json(
          { error: "Le nom de l'accréditation ne peut pas être vide" },
          { status: 400 }
        );
      }

      if (cleanName !== existingRecord.accreditation_name) {
        const duplicate = await prisma.accreditationRecord.findUnique({
          where: {
            schoolId_accreditation_name: {
              schoolId: existingRecord.schoolId,
              accreditation_name: cleanName,
            },
          },
        });
        if (duplicate) {
          return NextResponse.json(
            { error: "Une autre accréditation possède déjà ce nom pour cette école" },
            { status: 400 }
          );
        }
      }
      data.accreditation_name = cleanName;
    }

    if (accreditation_type !== undefined) {
      if (!["international", "state", "label"].includes(accreditation_type)) {
        return NextResponse.json(
          { error: "Le type doit être international, state ou label" },
          { status: 400 }
        );
      }
      data.accreditation_type = accreditation_type;
    }

    if (year_obtained !== undefined) {
      // La colonne accepte NULL depuis que l'année inconnue ne s'écrit plus 0 :
      // une valeur vide efface l'année au lieu d'écrire une date fausse.
      if (year_obtained === null || year_obtained === "") {
        data.year_obtained = null;
      } else {
        const yearNum = parseInt(year_obtained);
        const currentYear = new Date().getFullYear();
        if (isNaN(yearNum) || yearNum < 2000 || yearNum > currentYear + 2) {
          return NextResponse.json(
            { error: `L'année d'obtention doit être comprise entre 2000 et ${currentYear + 2}` },
            { status: 400 }
          );
        }
        data.year_obtained = yearNum;
      }
    }

    if (is_active !== undefined) {
      data.is_active = Boolean(is_active);
    }

    if (source_url !== undefined) {
      // Le lien source (D12), contrôlé comme toute saisie (D27).
      const source = readSourceUrl(source_url);
      if (!source.ok) {
        return NextResponse.json({ error: source.error }, { status: 400 });
      }
      data.source_url = source.value;
    }

    const updated = await prisma.accreditationRecord.update({
      where: { id },
      data: { ...data, ...provenance(session.user.id, "MANUAL") },
    });

    revalidateContent();
    return NextResponse.json(updated);
  } catch (err) {
    console.error(`PUT /api/admin/accreditations/${id} error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardManager();
  if (error) return error;

  const { id } = await params;

  try {
    const existing = await prisma.accreditationRecord.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Accréditation introuvable" },
        { status: 404 }
      );
    }

    await prisma.accreditationRecord.delete({ where: { id } });
    revalidateContent();

    return NextResponse.json({ message: "Accréditation supprimée avec succès" });
  } catch (err) {
    console.error(`DELETE /api/admin/accreditations/${id} error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
