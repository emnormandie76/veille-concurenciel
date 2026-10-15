/**
 * test/api-docs.test.ts — La page /api-docs dit ce que l'API répond
 *
 *     npm run test:ts
 *
 * Jusqu'au 15 octobre 2026, `app/api-docs/endpoints.ts` décrivait une API
 * imaginaire : champs inventés (`students_count`, `degree`, `school_id`…),
 * tarifs groupés par programme, `/rankings` avec `ranking_name` et `year`
 * obligatoires, URL d'exemple en `localhost:3000` et sans `?ids=` pour la
 * comparaison. La page est publique une fois le site en ligne. Décision du
 * propriétaire du 15 octobre 2026 : l'aligner sur les réponses réelles.
 *
 * Ce que le test confronte, route par route :
 * - **les routes** : chaque route de `app/api/v1` a sa fiche, et une seule ;
 * - **les paramètres** : ceux de la fiche sont ceux que la route lit
 *   (`searchParams.get`, plus `page` et `limit` sous `parsePagination`) ;
 *   un paramètre « obligatoire » l'est vraiment (sans lui : 400), les autres
 *   ne le sont pas (sans eux : 200) ;
 * - **la réponse** : l'exemple a la forme de la réponse réelle, clés et
 *   listes comprises. Le faux Prisma renvoie exactement ce que la route
 *   sélectionne (`select`), en liste quand `prisma/schema.prisma` déclare la
 *   relation en liste ; la route fait ensuite son propre travail (pagination,
 *   champ retiré, ordre de la comparaison) ;
 * - **l'URL d'exemple** : l'adresse du site, le bon identifiant d'exemple
 *   selon le segment (`/schools/…`, `/campuses/…`, `/programs/…`), et tous les
 *   paramètres de la fiche.
 */

import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { Prisma } from "@prisma/client";

import { installFakePrisma, type FakeModels } from "./helpers/fake-prisma";
import { schemaErrors } from "./helpers/prisma-schema";
import { V1_ROUTES } from "../scripts/lib/smoke-checks";
import { buildSampleUrl, endpoints, EXAMPLE_IDS, type Endpoint } from "../app/api-docs/endpoints";

const db = installFakePrisma();

// L'identifiant que le faux Prisma met dans chaque champ `id`, et que les
// appels du test passent en chemin et en paramètre.
const ID = "00000000-0000-4000-8000-000000000000";

type Ctx = { params: Promise<{ id: string }> };
type Handler = (request: Request, ctx: Ctx) => Promise<Response>;

const routes = endpoints.filter((ep) => ep.path !== "");
const handlers = new Map<string, Handler>();

before(async () => {
  for (const ep of routes) {
    const route = (await import(`../app${ep.path}/route`)) as { GET: Handler };
    handlers.set(ep.path, route.GET);
  }
});

// ── Le faux Prisma « écho » ─────────────────────────────────────────────

const FIELD_TYPES = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    new Map((model.fields as readonly { name: string; type: string }[]).map((f) => [f.name, f.type])),
  ])
);

/** Relations déclarées en liste (`Type[]`), lues dans le schéma. */
const LIST_FIELDS = (() => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const lists = new Map<string, Set<string>>();
  for (const [, model, body] of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    lists.set(model, new Set([...body.matchAll(/^\s*(\w+)\s+\w+\[\]/gm)].map((m) => m[1])));
  }
  return lists;
})();

type Select = Record<string, unknown>;

/** Un enregistrement qui porte exactement les champs sélectionnés. */
function echo(model: string, select: Select): Record<string, unknown> {
  const types = FIELD_TYPES.get(model);
  assert.ok(types, `modèle inconnu : ${model}`);
  const row: Record<string, unknown> = {};
  for (const [field, spec] of Object.entries(select)) {
    if (spec === true) {
      row[field] = field === "id" ? ID : field === "status" ? "ACTIVE" : "valeur";
      continue;
    }
    const nested = (spec as { select?: Select }).select;
    assert.ok(nested, `${model}.${field} : relation lue sans select`);
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

// ── Outils ──────────────────────────────────────────────────────────────

const queryParams = (ep: Endpoint) => ep.params.filter((p) => p.in === "query");
const sorted = (values: Iterable<string>) => [...values].sort();

async function call(ep: Endpoint, query: Record<string, string>): Promise<Response> {
  db.use(ECHO);
  const url = new URL(`http://localhost${ep.path.replace("[id]", ID)}`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const response = await handlers.get(ep.path)!(new Request(url), { params: Promise.resolve({ id: ID }) });
  assert.deepEqual(schemaErrors(db.calls), [], ep.path);
  return response;
}

/** La forme d'une valeur : clés triées, listes vues par leur premier élément. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return [value.length ? shape(value[0]) : "liste vide"];
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(sorted(Object.keys(object)).map((key) => [key, shape(object[key])]));
  }
  return "valeur";
}

// ── Tests ───────────────────────────────────────────────────────────────

test("api-docs : une fiche par route de app/api/v1, et rien d'autre", () => {
  assert.deepEqual(sorted(routes.map((ep) => ep.path)), sorted(V1_ROUTES));
  assert.equal(new Set(endpoints.map((ep) => ep.id)).size, endpoints.length, "identifiants de fiche en double");
});

test("api-docs : les paramètres de la fiche sont ceux que la route lit", () => {
  for (const ep of routes) {
    const source = readFileSync(`app${ep.path}/route.ts`, "utf8");
    const read = new Set([...source.matchAll(/searchParams\.get\("([^"]+)"\)/g)].map((m) => m[1]));
    if (source.includes("parsePagination(")) {
      read.add("page");
      read.add("limit");
    }
    assert.deepEqual(sorted(queryParams(ep).map((p) => p.name)), sorted(read), ep.path);

    const path = ep.params.filter((p) => p.in === "path");
    if (ep.path.includes("[id]")) {
      assert.equal(path.length, 1, ep.path);
      assert.equal(path[0].name, "id", ep.path);
      assert.equal(path[0].required, true, ep.path);
    } else {
      assert.equal(path.length, 0, ep.path);
    }
  }
});

test("api-docs : « obligatoire » veut dire 400 sans lui ; les autres paramètres sont facultatifs", async () => {
  for (const ep of routes) {
    const required = queryParams(ep).filter((p) => p.required);
    const minimal = Object.fromEntries(required.map((p) => [p.name, ID]));
    assert.equal((await call(ep, minimal)).status, 200, `${ep.path} avec ses seuls paramètres obligatoires`);
    for (const param of required) {
      const { [param.name]: _omitted, ...without } = minimal;
      assert.equal((await call(ep, without)).status, 400, `${ep.path} sans ${param.name}`);
    }
  }
});

test("api-docs : l'exemple de réponse a la forme de la réponse réelle", async () => {
  for (const ep of routes) {
    const required = Object.fromEntries(queryParams(ep).filter((p) => p.required).map((p) => [p.name, ID]));
    const response = await call(ep, required);
    assert.equal(response.status, 200, ep.path);
    assert.deepEqual(shape(ep.mockResponse), shape(await response.json()), ep.path);
  }
});

test("api-docs : l'URL d'exemple vise le site, le bon identifiant et tous les paramètres", () => {
  const origin = "https://exemple.fr";
  const idBySegment: Record<string, string> = {
    schools: EXAMPLE_IDS.school,
    campuses: EXAMPLE_IDS.campus,
    programs: EXAMPLE_IDS.program,
  };
  for (const ep of endpoints) {
    const sample = buildSampleUrl(ep, origin);
    if (ep.path === "") {
      assert.equal(sample, origin);
      continue;
    }
    const url = new URL(sample);
    assert.equal(url.origin, origin, ep.path);
    const expectedPath = ep.path.replace(/\/(\w+)\/\[id\]/, (_match, segment: string) => {
      assert.ok(idBySegment[segment], `${ep.path} : segment ${segment} sans identifiant d'exemple`);
      return `/${segment}/${idBySegment[segment]}`;
    });
    assert.equal(url.pathname, expectedPath, ep.path);
    assert.deepEqual(sorted(url.searchParams.keys()), sorted(queryParams(ep).map((p) => p.name)), ep.path);
    for (const param of queryParams(ep)) {
      assert.ok(param.example, `${ep.path} : ${param.name} sans valeur d'exemple`);
    }
  }
});

test("api-docs : la fiche d'une ressource montre la ressource de son URL d'exemple", () => {
  const detail: Record<string, string> = {
    "/api/v1/schools/[id]": EXAMPLE_IDS.school,
    "/api/v1/campuses/[id]": EXAMPLE_IDS.campus,
    "/api/v1/programs/[id]": EXAMPLE_IDS.program,
  };
  for (const [path, id] of Object.entries(detail)) {
    const ep = endpoints.find((e) => e.path === path)!;
    assert.equal((ep.mockResponse as { id: string }).id, id, path);
  }
});
