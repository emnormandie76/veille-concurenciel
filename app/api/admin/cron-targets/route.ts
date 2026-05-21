import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardAuth } from "@/lib/auth";

export async function GET() {
  const { error } = await guardAuth();
  if (error) return error;

  try {
    const cronTargets = await prisma.cronTarget.findMany({
      include: {
        school: {
          select: {
            name: true,
          },
        },
        program: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [
        {
          is_blacklisted: "desc",
        },
        {
          failed_attempts_count: "desc",
        },
      ],
    });

    return NextResponse.json(cronTargets);
  } catch (err: any) {
    console.error("Erreur de récupération des CronTargets:", err);
    return NextResponse.json(
      { error: "Erreur de base de données" },
      { status: 500 }
    );
  }
}
