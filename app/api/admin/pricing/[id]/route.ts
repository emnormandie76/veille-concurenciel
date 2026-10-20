import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardManager } from "@/lib/auth";
import { revalidateContent } from "@/lib/content-cache";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardManager();
  if (error) return error;

  const { id } = await params;

  try {
    const existing = await prisma.pricingRecord.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Tarif introuvable" }, { status: 404 });
    }

    await prisma.pricingRecord.delete({ where: { id } });
    revalidateContent();

    return NextResponse.json({ message: "Tarif supprimé avec succès" });
  } catch (err) {
    console.error(`DELETE /api/admin/pricing/${id} error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
