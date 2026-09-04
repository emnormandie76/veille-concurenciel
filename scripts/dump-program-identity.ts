/**
 * scripts/dump-program-identity.ts — Les arêtes réelles d'une école, en JSON
 *
 * LECTURE SEULE. Trois `findMany`, aucun `create`, `update`, `upsert` ni
 * `delete`. Aucune migration n'est appliquée ni requise : le script ne lit que
 * `School`, `Campus`, `Program` et `ProgramCampus`, qui existent en base
 * depuis `20260901120000_program_campus_refactor`. Il ne touche donc pas aux
 * colonnes de `20260904120000_program_campus_attachment`, écrite et non
 * appliquée.
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
          campuses: {
            select: { id: true, programId: true, campusId: true },
          },
        },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  // Les arêtes remontent à plat : c'est la forme qu'attend
  // `resolve_attachment_rows()`, et elle rend le compte lisible.
  const payload = schools.map((school) => ({
    id: school.id,
    name: school.name,
    official_domain: school.official_domain,
    campuses: school.campuses,
    programs: school.programs.map(({ id, name }) => ({ id, name })),
    edges: school.programs.flatMap((p) =>
      p.campuses.map((e) => ({ id: e.id, programId: e.programId, campusId: e.campusId }))
    ),
  }));

  const json = JSON.stringify(payload, null, 1);
  const out = process.argv[2];
  if (out) {
    fs.writeFileSync(out, json, "utf-8");
    for (const s of payload) {
      console.log(
        `${s.name} : ${s.campuses.length} campus, ${s.programs.length} programmes, ${s.edges.length} aretes`
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
