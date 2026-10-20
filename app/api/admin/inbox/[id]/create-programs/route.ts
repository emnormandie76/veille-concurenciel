import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardAdmin } from "@/lib/auth";
import { revalidateContent } from "@/lib/content-cache";
import { provenance } from "@/lib/provenance";

/**
 * POST /api/admin/inbox/[id]/create-programs
 * 
 * Crée en BDD tous les programmes non matchés d'un ticket multi-programme,
 * puis met à jour le JSON du ticket pour les déplacer dans `programs` (matchés).
 * 
 * Body attendu : { programNames: string[] }
 *
 * Provenance (plan gestion-contenu, étape 5, D11) : un programme créé a pour
 * auteur l'admin, origine `AI` ; un programme déjà là n'est pas modifié
 * (`update: {}`), il garde donc son auteur.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await guardAdmin();
  if (error) return error;

  const { id } = await params;

  try {
    const ticket = await prisma.contributionInbox.findUnique({ where: { id } });

    if (!ticket) {
      return NextResponse.json({ error: "Ticket introuvable" }, { status: 404 });
    }

    if (!ticket.schoolId) {
      return NextResponse.json(
        { error: "Ce ticket n'est rattaché à aucune école" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const programNames: string[] = body.programNames;

    if (!Array.isArray(programNames) || programNames.length === 0) {
      return NextResponse.json(
        { error: "Aucun nom de programme fourni" },
        { status: 400 }
      );
    }

    const stamp = provenance(session.user.id, "AI");

    // Créer les programmes dans une transaction
    const createdPrograms = await prisma.$transaction(async (tx) => {
      const results: { id: string; name: string }[] = [];

      for (const name of programNames) {
        const trimmedName = name.trim();
        if (!trimmedName) continue;

        // Upsert pour éviter les doublons (contrainte @@unique([schoolId, name]))
        const program = await tx.program.upsert({
          where: {
            schoolId_name: {
              schoolId: ticket.schoolId!,
              name: trimmedName,
            },
          },
          create: {
            schoolId: ticket.schoolId!,
            name: trimmedName,
            ...stamp,
          },
          update: {}, // pas de modification si déjà existant
        });

        results.push({ id: program.id, name: program.name });
      }

      // Mettre à jour le JSON du ticket :
      // Déplacer les programmes créés de unmatched_programs vers programs
      const currentJson = (ticket.ai_extracted_json as Record<string, unknown>) ?? {};
      const currentPrograms = (currentJson.programs as Array<Record<string, unknown>>) ?? [];
      const currentUnmatched = (currentJson.unmatched_programs as Array<Record<string, unknown>>) ?? [];

      const createdNamesSet = new Set(results.map((r) => r.name.toLowerCase()));
      const createdNamesMap = new Map(results.map((r) => [r.name.toLowerCase(), r]));

      // Programmes qui restent non matchés (pas dans la liste de création)
      const remainingUnmatched = currentUnmatched.filter(
        (u) => !createdNamesSet.has(((u.extracted_program_name as string) ?? "").toLowerCase())
      );

      // Nouveaux programmes matchés à ajouter
      const newlyMatched = currentUnmatched
        .filter((u) =>
          createdNamesSet.has(((u.extracted_program_name as string) ?? "").toLowerCase())
        )
        .map((u) => {
          const extractedName = (u.extracted_program_name as string) ?? "";
          const created = createdNamesMap.get(extractedName.toLowerCase());
          return {
            extracted_program_name: extractedName,
            matched_program_id: created?.id ?? null,
            matched_program_name: created?.name ?? extractedName,
            match_confidence: "exact" as const,
            data: (u.data as Record<string, unknown>) ?? {},
          };
        });

      const updatedJson = {
        ...currentJson,
        programs: [...currentPrograms, ...newlyMatched],
        unmatched_programs: remainingUnmatched,
      };

      // Sauvegarder le ticket mis à jour
      await tx.contributionInbox.update({
        where: { id: ticket.id },
        data: {
          ai_extracted_json: updatedJson as any,
          program_name_mismatch: remainingUnmatched.length > 0,
        },
      });

      return { createdPrograms: results, updatedJson };
    });

    revalidateContent();
    return NextResponse.json({
      message: `${createdPrograms.createdPrograms.length} programme(s) créé(s) et rattaché(s)`,
      count: createdPrograms.createdPrograms.length,
      programs: createdPrograms.createdPrograms,
      updatedJson: createdPrograms.updatedJson,
    });
  } catch (error) {
    console.error(`POST /api/admin/inbox/${id}/create-programs error:`, error);
    return NextResponse.json({ error: "Erreur serveur interne" }, { status: 500 });
  }
}
