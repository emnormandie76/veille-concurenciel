import { guardAdmin } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TERMINAL_CONTRIBUTION_STATUSES } from "@/lib/contribution";
import { invalidBody } from "@/lib/account-admin";
import { readFormBody } from "@/lib/request-body";

// Seuls les statuts terminaux sont purgeables. La liste vit désormais dans
// lib/contribution.ts, avec les autres énumérations de la zone tampon.
const ALLOWED_PURGE_STATUSES: readonly string[] = TERMINAL_CONTRIBUTION_STATUSES;

export async function DELETE(request: Request) {
    const { error } = await guardAdmin();
    if (error) return error;

    try {
        const body = await readFormBody(request);
        if (!body) return invalidBody();
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
