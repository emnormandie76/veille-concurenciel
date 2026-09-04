/**
 * app/api/admin/inbox/[id]/attachments/route.ts
 * PUT /api/admin/inbox/[id]/attachments
 *
 * Écrit les lignes `ProgramCampusAttachment` d'un ticket, derrière la même
 * validation admin que le reste de la zone tampon. C'est le pendant, pour la
 * table fille, de ce que `validateProgramDiscovery` fait pour les arêtes.
 *
 * ## Pourquoi une route voisine, et pas la route de validation
 *
 * **1. La base interdit l'autre solution.** Le plus naturel serait une septième
 * catégorie `Campus_Attachment` branchée dans le `switch` de
 * `validate/route.ts`. La contrainte `ContributionInbox_ai_category_check`,
 * posée par `20260902120000_inbox_relations_and_enum_guards`, énumère six
 * valeurs — en ajouter une est une migration. Ce ticket reste donc un
 * `Program_Discovery`, reconnu à sa charge : `discovered_campuses` va à la
 * route de validation, `campus_attachments` vient ici.
 *
 * **2. Deux disciplines d'écriture opposées ne cohabitent pas.**
 * `validateProgramDiscovery` CRÉE des couples `(programId, campusId)` par
 * `upsert` — c'est son travail, et c'est le seul chemin qui doit le faire. Ce
 * module n'en crée aucun : il résout par `findUnique` et refuse. Mettre les
 * deux dans la même fonction, c'est attendre la modification qui alignera l'un
 * sur l'autre « par symétrie ».
 *
 * **3. Tant que la migration n'est pas appliquée, cette route est inerte.**
 * `ProgramCampusAttachment` existe dans le client Prisma et pas en base : tout
 * appel qui la vise échoue. Placé dans `validateProgramDiscovery`, cet échec
 * ferait échouer la transaction ENTIÈRE et donc les upserts de Campus, Program
 * et ProgramCampus qui, eux, fonctionnent. Une table absente casserait le seul
 * chemin d'écriture qui marche. Ici, rien ne se produit tant que personne
 * n'appelle.
 *
 * Le précédent est dans le dépôt : `create-programs/route.ts` est déjà une
 * route sœur qui agit sur le même ticket, avec le même `guardAuth` et la même
 * `prisma.$transaction`.
 *
 * ## Ce que la route garantit
 *
 * Aucune ligne n'est écrite sur une arête absente ; aucune arête n'est créée ;
 * aucune ligne n'est supprimée. Tout ce qui n'est pas écrit est nommé dans
 * `conflicts`, et tout ce qui reste en base sans être réaffirmé est nommé dans
 * `stale`. Les règles elles-mêmes sont dans `lib/campus-attachment.ts`.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardAuth } from "@/lib/auth";
import { STATUS_REJECTED, STATUS_VALIDATED } from "@/lib/contribution";
import {
  applyAttachmentPlan,
  foldAttachmentClaims,
  planAttachmentWrites,
  readExistingAttachments,
  resolveAttachmentEdges,
  type AttachmentTx,
} from "@/lib/campus-attachment";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardAuth();
  if (error) return error;

  const { id } = await params;

  try {
    const ticket = await prisma.contributionInbox.findUnique({ where: { id } });

    if (!ticket) {
      return NextResponse.json({ error: "Ticket introuvable" }, { status: 404 });
    }
    if (ticket.status === STATUS_VALIDATED) {
      return NextResponse.json({ error: "Ticket déjà validé" }, { status: 400 });
    }
    if (ticket.status === STATUS_REJECTED) {
      return NextResponse.json(
        { error: "Impossible de valider un ticket rejeté" },
        { status: 400 }
      );
    }

    // Même convention que la route de validation : le corps de la requête, s'il
    // en porte un, prime sur `ai_extracted_json`. C'est ce qui rend l'arbitrage
    // de l'admin effectif — il peut retirer une ligne avant d'écrire.
    let bodyData: Record<string, unknown> = {};
    try {
      bodyData = await request.json();
    } catch {
      // Pas de corps JSON : on écrit ce que le ticket porte.
    }
    const rawJson =
      bodyData && Object.keys(bodyData).length > 0
        ? bodyData
        : (ticket.ai_extracted_json as Record<string, unknown> | null);

    if (!rawJson) {
      return NextResponse.json(
        { error: "Aucune donnée JSON à valider dans ce ticket" },
        { status: 400 }
      );
    }
    if (!Array.isArray((rawJson as Record<string, unknown>).campus_attachments)) {
      return NextResponse.json(
        {
          error:
            "Ce ticket ne porte pas de bloc campus_attachments. Un ticket Program_Discovery ordinaire se valide par PUT /api/admin/inbox/[id]/validate.",
        },
        { status: 400 }
      );
    }

    // Les trois règles déjà tranchées, hors base : lecture, absorption ANY,
    // fusion des affirmations identiques.
    const folded = foldAttachmentClaims(rawJson);

    const result = await prisma.$transaction(
      async (tx) => {
        const db: AttachmentTx = tx;

        // LA règle : résolution par findUnique, refus si l'arête manque.
        const { resolved, conflicts: edgeConflicts } = await resolveAttachmentEdges(
          db,
          folded.claims
        );

        const existing = await readExistingAttachments(db, resolved);
        const plan = planAttachmentWrites(resolved, existing);
        const counts = await applyAttachmentPlan(db, plan);

        await tx.contributionInbox.update({
          where: { id: ticket.id },
          data: { status: STATUS_VALIDATED },
        });

        return {
          counts,
          plan,
          conflicts: [...folded.conflicts, ...edgeConflicts, ...plan.conflicts],
        };
      },
      { timeout: 60000 }
    );

    return NextResponse.json({
      message: `${result.counts.created} ligne(s) créée(s), ${result.counts.updated} mise(s) à jour, ${result.counts.unchanged} inchangée(s)`,
      written: result.counts,
      created: result.plan.create,
      updated: result.plan.update,
      unchanged: result.plan.unchanged,
      // Conservées, jamais supprimées : voir l'en-tête de lib/campus-attachment.ts.
      stale: result.plan.stale,
      conflicts: result.conflicts,
    });
  } catch (err) {
    console.error(`PUT /api/admin/inbox/${id}/attachments error:`, err);
    return NextResponse.json(
      { error: "Erreur lors de la transaction. Rollback effectué. Aucune donnée insérée." },
      { status: 500 }
    );
  }
}
