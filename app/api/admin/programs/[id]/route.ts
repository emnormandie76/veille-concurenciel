import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardAuth, guardAdmin } from "@/lib/auth";

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
      name,
      admission_exam,
      is_alternance_possible,
      is_expatriation_mandatory,
      min_expatriation_months,
      max_internship_months,
      campusIds,
    } = body;

    const existingProgram = await prisma.program.findUnique({
      where: { id },
    });

    if (!existingProgram) {
      return NextResponse.json({ error: "Programme introuvable" }, { status: 404 });
    }

    if (name !== undefined) {
      const cleanName = name.trim();
      if (!cleanName) {
        return NextResponse.json({ error: "Le nom ne peut pas être vide" }, { status: 400 });
      }
      if (cleanName !== existingProgram.name) {
        const duplicate = await prisma.program.findUnique({
          where: {
            schoolId_name: {
              schoolId: existingProgram.schoolId,
              name: cleanName,
            },
          },
        });
        if (duplicate) {
          return NextResponse.json(
            { error: "Un autre programme porte déjà ce nom dans cette école" },
            { status: 400 }
          );
        }
      }
    }

    if (Array.isArray(campusIds) && campusIds.length === 0) {
      return NextResponse.json(
        { error: "Au moins un campus doit être sélectionné" },
        { status: 400 }
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const dataToUpdate: Record<string, any> = {};
      if (name !== undefined) dataToUpdate.name = name.trim();
      if (admission_exam !== undefined) dataToUpdate.admission_exam = admission_exam?.trim() || null;
      if (is_alternance_possible !== undefined) dataToUpdate.is_alternance_possible = Boolean(is_alternance_possible);
      if (is_expatriation_mandatory !== undefined) dataToUpdate.is_expatriation_mandatory = Boolean(is_expatriation_mandatory);
      if (min_expatriation_months !== undefined) dataToUpdate.min_expatriation_months = min_expatriation_months ? parseInt(min_expatriation_months) : null;
      if (max_internship_months !== undefined) dataToUpdate.max_internship_months = max_internship_months ? parseInt(max_internship_months) : null;

      const program = await tx.program.update({
        where: { id },
        data: dataToUpdate,
      });

      if (Array.isArray(campusIds)) {
        const currentPCs = await tx.programCampus.findMany({
          where: { programId: id },
          select: { campusId: true, id: true },
        });

        const currentCampusIds = currentPCs.map((pc) => pc.campusId);
        const toDelete = currentCampusIds.filter((cid) => !campusIds.includes(cid));
        const toCreate = campusIds.filter((cid: string) => !currentCampusIds.includes(cid));

        if (toDelete.length > 0) {
          await tx.programCampus.deleteMany({
            where: {
              programId: id,
              campusId: { in: toDelete },
            },
          });
        }

        if (toCreate.length > 0) {
          await Promise.all(
            toCreate.map((campusId: string) =>
              tx.programCampus.create({
                data: {
                  programId: id,
                  campusId,
                },
              })
            )
          );
        }
      }

      return program;
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error(`PUT /api/admin/programs/${id} error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardAdmin();
  if (error) return error;

  const { id } = await params;

  try {
    const existing = await prisma.program.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Programme introuvable" }, { status: 404 });
    }

    await prisma.program.delete({ where: { id } });

    return NextResponse.json({ message: "Programme supprimé avec succès" });
  } catch (err) {
    console.error(`DELETE /api/admin/programs/${id} error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
