import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardAuth } from "@/lib/auth";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; recordId: string }> }
) {
  const { error } = await guardAuth();
  if (error) return error;

  const { id: schoolId, recordId } = await params;

  try {
    const record = await prisma.schoolStatsRecord.findUnique({
      where: { id: recordId },
    });

    if (!record) {
      return NextResponse.json({ error: "Enregistrement de statistiques introuvable" }, { status: 404 });
    }

    if (record.schoolId !== schoolId) {
      return NextResponse.json({ error: "Action non autorisée" }, { status: 403 });
    }

    await prisma.schoolStatsRecord.delete({
      where: { id: recordId },
    });

    return NextResponse.json({ message: "Statistiques supprimées avec succès" });
  } catch (err) {
    console.error(`DELETE /api/admin/schools/${schoolId}/stats/${recordId} error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
