import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ALLOWED_PURGE_STATUSES = ["Validated", "Rejected"];

export async function DELETE(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { statuses } = body;

        if (!statuses || !Array.isArray(statuses) || statuses.length === 0) {
            return NextResponse.json(
                { error: "Le champ 'statuses' est requis (tableau non vide)" },
                { status: 400 }
            );
        }

        // Vérifier que tous les statuts sont autorisés
        const invalidStatuses = statuses.filter(
            (s: string) => !ALLOWED_PURGE_STATUSES.includes(s)
        );
        if (invalidStatuses.length > 0) {
            return NextResponse.json(
                {
                    error: `Statuts non autorisés pour la purge : ${invalidStatuses.join(", ")}. Seuls Validated et Rejected sont supprimables.`,
                },
                { status: 400 }
            );
        }

        const result = await prisma.contributionInbox.deleteMany({
            where: { status: { in: statuses } },
        });

        return NextResponse.json({ deleted: result.count });
    } catch (error) {
        console.error("DELETE /api/admin/inbox/purge error:", error);
        return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
    }
}
