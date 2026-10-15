/**
 * test/prisma-schema.test.ts — Le contrôle des requêtes contre le schéma Prisma
 *
 *     npm run test:ts
 *
 * `schemaErrors` (test/helpers/prisma-schema.ts) sert de garde à tous les tests
 * de routes : il doit refuser un champ inconnu à toute profondeur et accepter
 * ce que Prisma accepte (clés composées, opérateurs de relation, `_count`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { FakePrismaCall } from "./helpers/fake-prisma";
import { schemaErrors } from "./helpers/prisma-schema";

const q = (model: string, method: string, args: unknown): FakePrismaCall[] => [{ model, method, args: [args] }];

test("le défaut du 14 octobre 2026 : program.campus n'existe plus", () => {
  const errors = schemaErrors(
    q("rankingRecord", "findMany", {
      where: { program: { campus: { school: { status: "ACTIVE" } } } },
      select: { id: true, program: { select: { campus: { select: { id: true } } } } },
    })
  );
  assert.deepEqual(errors, [
    "rankingRecord.findMany.where.program.campus : Program n'a pas de champ « campus »",
    "rankingRecord.findMany.select.program.select.campus : Program n'a pas de champ « campus »",
  ]);
});

test("une requête conforme passe : relations, opérateurs, clés composées, _count", () => {
  const calls = [
    ...q("rankingRecord", "findMany", {
      where: {
        program: { school: { status: "ACTIVE" } },
        OR: [{ ranking_name: { contains: "x", mode: "insensitive" } }, { NOT: { rank: null } }],
      },
      select: {
        program: {
          select: { school: { select: { id: true } }, campuses: { select: { campus: { select: { name: true } } } } },
        },
      },
      orderBy: [{ academic_year: "desc" }, { rank: "asc" }],
      skip: 0,
      take: 50,
    }),
    ...q("program", "findMany", { where: { campuses: { some: { campusId: "c" } } } }),
    ...q("schoolStatsRecord", "findUnique", {
      where: { schoolId_academic_year: { schoolId: "s", academic_year: 2026 } },
    }),
    ...q("programCampus", "findMany", {
      select: { capacityRecords: { where: { academic_year: 2026 }, orderBy: { academic_year: "desc" }, take: 3 } },
      orderBy: { campus: { name: "asc" } },
    }),
    ...q("school", "findMany", { include: { _count: { select: { campuses: true } } } }),
    ...q("program", "upsert", {
      where: { schoolId_name: { schoolId: "s", name: "MBA" } },
      create: { schoolId: "s", name: "MBA" },
      update: {},
    }),
    { model: "$transaction", method: "callback", args: [] },
  ];
  assert.deepEqual(schemaErrors(calls), []);
});

test("champ inconnu dans orderBy, data, une sélection imbriquée ou une clé composée", () => {
  assert.deepEqual(schemaErrors(q("campus", "findMany", { orderBy: { program: { name: "asc" } } })), [
    "campus.findMany.orderBy.program : Campus n'a pas de champ « program »",
  ]);
  assert.deepEqual(schemaErrors(q("campus", "create", { data: { schoolId: "s", ville: "Caen" } })), [
    "campus.create.data.ville : Campus n'a pas de champ « ville »",
  ]);
  assert.deepEqual(
    schemaErrors(q("program", "findUnique", { where: { id: "p" }, select: { campuses: { orderBy: { rang: "asc" } } } })),
    ["program.findUnique.select.campuses.orderBy.rang : ProgramCampus n'a pas de champ « rang »"]
  );
  assert.deepEqual(schemaErrors(q("program", "findUnique", { where: { schoolId_nom: {} } })), [
    "program.findUnique.where.schoolId_nom : Program n'a pas de champ « schoolId_nom »",
  ]);
  assert.deepEqual(schemaErrors(q("school", "findUnique", { include: { _count: { select: { stats: true } } } })), [
    "school.findUnique.include._count.stats : School n'a pas de champ « stats »",
  ]);
  assert.deepEqual(schemaErrors(q("ecole", "findMany", {})), ["ecole.findMany : modèle inconnu « Ecole »"]);
});
