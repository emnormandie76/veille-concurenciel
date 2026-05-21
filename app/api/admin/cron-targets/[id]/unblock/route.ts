import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardAuth } from "@/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardAuth();
  if (error) return error;

  const { id } = await params;

  try {
    const updated = await prisma.cronTarget.update({
      where: { id },
      data: {
        failed_attempts_count: 0,
        is_blacklisted: false,
        last_failed_attempt: null,
      },
    });

    return NextResponse.json({ success: true, cronTarget: updated });
  } catch (err: any) {
    console.error("Erreur de déblocage du CronTarget:", err);
    return NextResponse.json(
      { error: "Impossible de débloquer cette cible cron" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return POST(request, { params });
}
