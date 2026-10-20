/**
 * test/api/v1-provenance.test.ts — L'API v1 dit d'où vient chaque donnée, et de quand elle date
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 5. Chaque ressource (école, campus, programme,
 * chiffres clés, accréditation, tarif, classement, capacité), et chaque
 * enregistrement imbriqué (les places, tarifs et classements d'un
 * programme), porte `updated_at`, la date de sa dernière modification ; les
 * chiffres clés, les accréditations et les programmes portent enfin
 * `source_url` (D12). Les simples renvois (l'école d'un programme, le campus
 * d'une capacité) n'en portent pas.
 *
 * D25, revue par le propriétaire le 20 octobre : une donnée lue par l'API est
 * tenue pour vérifiée. Ni le nom de l'auteur ni l'origine (saisie, IA,
 * signalement) n'en sortent ; ils servent au site et au gestionnaire. La
 * route ne lit même pas l'auteur : ni relation `updatedBy`, ni
 * `updated_by_id`, ni `updated_via` dans la requête.
 *
 * Le faux Prisma « écho » rend exactement ce que la route sélectionne, comme
 * dans test/api-docs.test.ts.
 */

import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { Prisma } from "@prisma/client";

import { installFakePrisma, type FakeModels, type FakePrismaCall } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";
import { endpoints } from "../../app/api-docs/endpoints";

const db = installFakePrisma();
const ID = "00000000-0000-4000-8000-000000000000";

type Select = Record<string, unknown>;
type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

const FIELD_TYPES = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    new Map((model.fields as readonly { name: string; type: string }[]).map((f) => [f.name, f.type])),
  ])
);

const LIST_FIELDS = (() => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const lists = new Map<string, Set<string>>();
  for (const [, model, body] of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    lists.set(model, new Set([...body.matchAll(/^\s*(\w+)\s+\w+\[\]/gm)].map((m) => m[1])));
  }
  return lists;
})();

function echo(model: string, select: Select): Record<string, unknown> {
  const types = FIELD_TYPES.get(model)!;
  const row: Record<string, unknown> = {};
  for (const [field, spec] of Object.entries(select)) {
    if (spec === true) {
      row[field] = field === "id" ? ID : field === "status" ? "ACTIVE" : field === "updated_at" ? new Date(0) : "valeur";
      continue;
    }
    const nested = (spec as { select: Select }).select;
    const related = echo(types.get(field)!, nested);
    row[field] = LIST_FIELDS.get(model)?.has(field) ? [related] : related;
  }
  return row;
}

const modelName = (client: string) => client[0].toUpperCase() + client.slice(1);
const ECHO = new Proxy(
  {},
  {
    get: (_target, client: string) => ({
      findMany: (args: { select: Select }) => [echo(modelName(client), args.select)],
      findUnique: (args: { select: Select }) => echo(modelName(client), args.select),
      findFirst: (args: { select: Select }) => echo(modelName(client), args.select),
      count: () => 1,
    }),
  }
) as FakeModels;

const routes = endpoints.filter((ep) => ep.path !== "");
const handlers = new Map<string, Handler>();

before(async () => {
  for (const ep of routes) {
    const route = (await import(`../../app${ep.path}/route`)) as { GET: Handler };
    handlers.set(ep.path, route.GET);
  }
});

async function call(path: string): Promise<{ json: unknown; calls: FakePrismaCall[] }> {
  db.use(ECHO);
  const ep = routes.find((e) => e.path === path)!;
  const url = new URL(`http://localhost${path.replace("[id]", ID)}`);
  for (const p of ep.params.filter((x) => x.in === "query" && x.required)) url.searchParams.set(p.name, ID);
  const res = await handlers.get(path)!(new Request(url), { params: Promise.resolve({ id: ID }) });
  assert.equal(res.status, 200, path);
  assert.deepEqual(schemaErrors(db.calls), [], path);
  return { json: await res.json(), calls: [...db.calls] };
}

/** Le chemin vers chaque objet qui doit porter sa date, et s'il porte un lien source. */
const EXPECTED: Record<string, Array<{ at: string; source: boolean }>> = {
  "/api/v1/schools": [{ at: "data[0]", source: false }],
  "/api/v1/schools/[id]": [{ at: "", source: false }],
  "/api/v1/schools/[id]/stats": [{ at: "", source: true }],
  "/api/v1/schools/[id]/accreditations": [{ at: "[0]", source: true }],
  "/api/v1/schools/[id]/campuses": [{ at: "[0]", source: false }],
  "/api/v1/campuses/[id]": [{ at: "", source: false }],
  "/api/v1/schools/[id]/programs": [{ at: "[0]", source: true }],
  "/api/v1/programs/[id]": [
    { at: "", source: true },
    { at: "campuses[0].capacityRecords[0]", source: true },
  ],
  "/api/v1/programs": [{ at: "data[0]", source: true }],
  "/api/v1/programs/[id]/pricing": [{ at: "[0]", source: true }],
  "/api/v1/schools/[id]/pricing": [{ at: "[0]", source: true }],
  "/api/v1/programs/[id]/rankings": [{ at: "[0]", source: true }],
  "/api/v1/rankings": [{ at: "data[0]", source: true }],
  // Des couples programme × campus (simples renvois), qui portent les places.
  "/api/v1/programs/[id]/capacity": [{ at: "[0].capacityRecords[0]", source: true }],
  "/api/v1/compare/programs": [
    { at: "[0]", source: true },
    { at: "[0].campuses[0].capacityRecords[0]", source: true },
    { at: "[0].pricingRecords[0]", source: true },
    { at: "[0].rankingRecords[0]", source: true },
  ],
};

function at(value: unknown, path: string): Record<string, unknown> {
  let current = value as Record<string, unknown>;
  for (const step of path.match(/[^.[\]]+|\[\d+\]/g) ?? []) {
    current = (step.startsWith("[") ? (current as unknown as unknown[])[Number(step.slice(1, -1))] : current[step]) as Record<string, unknown>;
    assert.ok(current, `chemin ${path} absent`);
  }
  return current;
}

/** Chaque objet de la réponse, à toute profondeur. */
function* objects(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) for (const item of value) yield* objects(item);
  else if (value !== null && typeof value === "object") {
    yield value as Record<string, unknown>;
    for (const child of Object.values(value)) yield* objects(child);
  }
}

test("chaque route de l'API v1 a son attendu", () => {
  assert.deepEqual(Object.keys(EXPECTED).sort(), routes.map((ep) => ep.path).sort());
});

for (const ep of routes) {
  test(`${ep.path} : la date et le lien source de chaque donnée`, async () => {
    const { json } = await call(ep.path);
    for (const { at: path, source } of EXPECTED[ep.path]) {
      const row = at(json, path);
      assert.ok("updated_at" in row, `${ep.path} ${path || "racine"} : updated_at`);
      assert.equal("source_url" in row, source, `${ep.path} ${path || "racine"} : source_url`);
    }
  });

  test(`${ep.path} : ni l'auteur ni l'origine (D25, revue le 20 octobre)`, async () => {
    const { json, calls } = await call(ep.path);
    for (const object of objects(json)) {
      for (const key of ["updated_by", "updated_via", "updated_by_id", "updatedBy", "display_name", "email", "username", "password_hash"]) {
        assert.equal(key in object, false, `${ep.path} : ${key} dans la réponse`);
      }
    }
    // La route ne lit même pas l'auteur ni l'origine.
    const text = JSON.stringify(calls.map((c) => c.args));
    assert.doesNotMatch(text, /"updatedBy"|"updated_by_id"|"updated_via"/, `${ep.path} : auteur ou origine lus`);
  });
}
