/**
 * scripts/dump-program-identity.ts — L'état réel d'une école, en JSON
 *
 * LECTURE SEULE. Un `findMany` imbriqué, aucun `create`, `update`, `upsert` ni
 * `delete`. Il lit `School`, `Campus`, `Program` et `ProgramCampus`, et —
 * depuis que `20260904120000_program_campus_attachment` est appliquée (15
 * septembre 2026) — `Program.campus_policy_note` et les lignes
 * `ProgramCampusAttachment`. C'est l'instantané que
 * `backend/pipeline/campus_attachment_collector.snapshot_from_dump()` lit pour
 * rejouer la Phase 1 sur cache : la liste des campus, les aretes, et ce qui est
 * déjà écrit.
 *
 * Pourquoi un script Node et pas du Python, alors que tout le pipeline lit la
 * base en psycopg2 : depuis ce poste, le port 5432 de Neon est injoignable en
 * TCP direct — `psycopg2.connect()` expire sur les trois adresses. Le client
 * Prisma, lui, passe par `@neondatabase/serverless` en WebSocket sur 443
 * (voir `lib/prisma.ts`), et répond. La lecture est donc faite ici, et
 * `backend/scripts/resolve_program_identity.py` consomme le JSON produit.
 *
 *     npx tsx scripts/dump-program-identity.ts tmp/db.json
 *
 * Sans argument, écrit sur la sortie standard.
 */

import * as fs from "fs";
import { prisma } from "../lib/prisma";

async function main() {
  const schools = await prisma.school.findMany({
    select: {
      id: true,
      name: true,
      official_domain: true,
      campuses: {
        select: { id: true, name: true, city: true },
        orderBy: { name: "asc" },
      },
      programs: {
        select: {
          id: true,
          name: true,
          campus_policy_note: true,
          campuses: {
            select: {
              id: true,
              programId: true,
              campusId: true,
              attachments: {
                select: {
                  id: true,
                  programCampusId: true,
                  study_year: true,
                  regime: true,
                  languages: true,
                  note: true,
                  source_url: true,
                },
                orderBy: [{ study_year: "asc" }, { regime: "asc" }],
              },
            },
          },
        },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  // Les arêtes et les lignes-années remontent à plat : c'est la forme
  // qu'attend `resolve_attachment_rows()`, et elle rend le compte lisible.
  const payload = schools.map((school) => ({
    id: school.id,
    name: school.name,
    official_domain: school.official_domain,
    campuses: school.campuses,
    programs: school.programs.map(({ id, name, campus_policy_note }) => ({ id, name, campus_policy_note })),
    edges: school.programs.flatMap((p) =>
      p.campuses.map((e) => ({ id: e.id, programId: e.programId, campusId: e.campusId }))
    ),
    attachments: school.programs.flatMap((p) => p.campuses.flatMap((e) => e.attachments)),
  }));

  const json = JSON.stringify(payload, null, 1);
  const out = process.argv[2];
  if (out) {
    fs.writeFileSync(out, json, "utf-8");
    for (const s of payload) {
      const notes = s.programs.filter((p) => p.campus_policy_note !== null).length;
      console.log(
        `${s.name} : ${s.campuses.length} campus, ${s.programs.length} programmes, ${s.edges.length} aretes, ` +
          `${s.attachments.length} lignes-annees, ${notes} note(s)`
      );
    }
    console.log(`ecrit : ${out}`);
  } else {
    console.log(json);
  }
}

main()
  .catch((e) => {
    console.error("ECHEC:", e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
