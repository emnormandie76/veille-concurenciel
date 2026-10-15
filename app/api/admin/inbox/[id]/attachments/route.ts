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
 * **3. Une écriture neuve ne doit pas pouvoir faire tomber une ancienne.**
 * Placée dans `validateProgramDiscovery`, une erreur sur la table fille ferait
 * échouer la transaction ENTIÈRE, donc les upserts de Campus, Program et
 * ProgramCampus. C'est ce qui s'est mesuré tant que la migration n'était pas
 * appliquée (`P2021`) ; elle l'est depuis le 15 septembre 2026, la séparation
 * reste.
 *
 * Le précédent est dans le dépôt : `create-programs/route.ts` est déjà une
 * route sœur qui agit sur le même ticket, avec le même `guardAuth` et la même
 * `prisma.$transaction`. Et `validate/route.ts` refuse désormais un ticket qui
 * porte `campus_attachments`, en nommant cette route.
 *
 * ## Ce que la route garantit
 *
 * Aucune ligne n'est écrite sur une arête absente ; aucune arête n'est créée ;
 * aucune ligne n'est supprimée. Tout ce qui n'est pas écrit est nommé dans
 * `conflicts`, et tout ce qui reste en base sans être réaffirmé est nommé dans
 * `stale`. Les règles elles-mêmes sont dans `lib/campus-attachment.ts`.
 *
 * Le ticket n'est clos que si une ligne ou une note a été résolue (écrite, ou
 * déjà en base à l'identique). Sinon : 422 avec les conflits, ticket ouvert,
 * comme la validation multi-programme. Un corps illisible est refusé (400),
 * jamais remplacé par le bloc du ticket (F2).
 *
 * Le même ticket peut porter `campus_policy_notes` : la note de politique de
 * campus d'un programme EXISTANT de l'école du ticket. Le type `PolicyNoteTx`
 * n'ouvre que `program.findUnique` et `program.update` sur cette seule
 * colonne, sans jamais l'effacer. Aucun `Program` ni `Campus` n'est créé par
 * cette route.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardAuth } from "@/lib/auth";
import { STATUS_REJECTED, STATUS_VALIDATED } from "@/lib/contribution";
import { adminCorrections, readOptionalJsonObject } from "@/lib/request-body";
import {
  applyAttachmentPlan,
  applyPolicyNotePlan,
  foldAttachmentClaims,
  foldPolicyNoteClaims,
  planAttachmentWrites,
  planPolicyNoteWrites,
  readExistingAttachments,
  resolveAttachmentEdges,
  resolvePolicyNotePrograms,
  type AttachmentTx,
  type PolicyNoteTx,
} from "@/lib/campus-attachment";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardAuth();
  if (error) return error;

  const { id } = await params;

  // Lu avant la base : un corps illisible est refusé, jamais remplacé en
  // silence par le bloc du ticket (F2, lib/request-body.ts).
  const body = await readOptionalJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }

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
    // de l'admin effectif — il peut retirer une ligne avant d'écrire. Sans
    // corps, ou avec `{}`, on écrit ce que le ticket porte.
    const rawJson =
      adminCorrections(body.body) ??
      (ticket.ai_extracted_json as Record<string, unknown> | null);

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
    // fusion des affirmations identiques. Et, pour les notes, lecture et fusion.
    const folded = foldAttachmentClaims(rawJson);
    const foldedNotes = foldPolicyNoteClaims(rawJson);

    const result = await prisma.$transaction(
      async (tx) => {
        const db: AttachmentTx = tx;
        const noteDb: PolicyNoteTx = tx;

        // LA règle : résolution par findUnique, refus si l'arête manque.
        const { resolved, conflicts: edgeConflicts } = await resolveAttachmentEdges(
          db,
          folded.claims
        );

        const existing = await readExistingAttachments(db, resolved);
        const plan = planAttachmentWrites(resolved, existing);
        const counts = await applyAttachmentPlan(db, plan);

        const { resolved: notes, conflicts: programConflicts } = await resolvePolicyNotePrograms(
          noteDb,
          foldedNotes.claims,
          ticket.schoolId
        );
        const notePlan = planPolicyNoteWrites(notes);
        const noteCounts = await applyPolicyNotePlan(noteDb, notePlan);

        // Ne clore le ticket QUE si une ligne ou une note a été résolue
        // (écrite, ou déjà en base à l'identique). Sinon il reste ouvert :
        // une fois l'arête créée par la validation Program_Discovery, l'admin
        // doit pouvoir le rejouer. Même règle que `validateMultiProgram`.
        const resolvedCount =
          counts.created + counts.updated + counts.unchanged +
          noteCounts.created + noteCounts.updated + noteCounts.unchanged;
        if (resolvedCount > 0) {
          await tx.contributionInbox.update({
            where: { id: ticket.id },
            data: { status: STATUS_VALIDATED },
          });
        }

        return {
          closed: resolvedCount > 0,
          counts,
          plan,
          noteCounts,
          notePlan,
          conflicts: [
            ...folded.conflicts,
            ...edgeConflicts,
            ...plan.conflicts,
            ...foldedNotes.conflicts,
            ...programConflicts,
          ],
        };
      },
      { timeout: 60000 }
    );

    if (!result.closed) {
      // L'écran n'affiche que `error` : le décompte des conflits y figure.
      const byType = new Map<string, number>();
      for (const c of result.conflicts) byType.set(c.type, (byType.get(c.type) ?? 0) + 1);
      const summary = [...byType].map(([type, n]) => `${n} ${type}`).join(", ");
      return NextResponse.json(
        {
          error:
            "Aucune ligne ni note n'a pu être résolue : rien n'a été écrit, le ticket reste ouvert pour correction." +
            (summary ? ` Conflits : ${summary}.` : ""),
          conflicts: result.conflicts,
          stale: result.plan.stale,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      message:
        `${result.counts.created} ligne(s) créée(s), ${result.counts.updated} mise(s) à jour, ` +
        `${result.counts.unchanged} inchangée(s) ; ${result.noteCounts.created + result.noteCounts.updated} note(s) écrite(s)`,
      written: result.counts,
      created: result.plan.create,
      updated: result.plan.update,
      unchanged: result.plan.unchanged,
      // Conservées, jamais supprimées : voir l'en-tête de lib/campus-attachment.ts.
      stale: result.plan.stale,
      policy_notes: {
        written: result.noteCounts,
        created: result.notePlan.create,
        updated: result.notePlan.update,
        unchanged: result.notePlan.unchanged,
      },
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
