/**
 * test/helpers/prisma-schema.ts — Les requêtes du faux Prisma, relues contre le vrai schéma
 *
 *     assert.deepEqual(schemaErrors(db.calls), []);
 *
 * Le faux Prisma accepte n'importe quel argument, et `tsc` ne voit pas un champ
 * disparu quand la route type son filtre `any`. Jusqu'au 14 octobre 2026,
 * `/api/v1/rankings` et `/api/v1/schools/[id]/pricing` filtraient ainsi par
 * `program.campus`, relation supprimée avec la refonte de `Program`, et
 * répondaient toujours 500.
 *
 * `schemaErrors` relit chaque appel enregistré contre le modèle de données du
 * client généré (`Prisma.dmmf` : ni base ni réseau). Tout nom de champ de
 * `where`, `select`, `include`, `orderBy`, `data`, `create` et `update` doit
 * exister sur le modèle visé, relations comprises, à toute profondeur.
 *
 * Limite : le modèle de données d'exécution de Prisma 7 ne dit pas si une
 * relation est une liste. Les opérateurs de relation (`some`, `every`, `none`,
 * `is`, `isNot`) sont donc acceptés sur toutes, et seuls les noms sont
 * contrôlés, pas la forme des filtres scalaires.
 *
 * Le client doit être généré (`npx prisma generate`, fait en CI).
 */

import { Prisma } from "@prisma/client";

import type { FakePrismaCall } from "./fake-prisma";

type Field = { name: string; kind: string; type: string };
type Fields = Map<string, Field>;

const MODELS = new Map<string, Fields>(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    new Map((model.fields as readonly Field[]).map((field) => [field.name, field])),
  ])
);

const LOGICAL = new Set(["AND", "OR", "NOT"]);
const RELATION_FILTERS = new Set(["some", "every", "none", "is", "isNot"]);
// Arguments d'une relation lue qui ne nomment pas de champ.
const READ_ARGS = new Set(["take", "skip", "cursor", "distinct"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Vrai si `key` enchaîne des champs du modèle par `_` (clé composée : `schoolId_name`). */
function isCompoundKey(fields: Fields, key: string): boolean {
  for (const name of fields.keys()) {
    if (!key.startsWith(`${name}_`)) continue;
    const rest = key.slice(name.length + 1);
    if (fields.has(rest) || isCompoundKey(fields, rest)) return true;
  }
  return false;
}

class Checker {
  readonly errors: string[] = [];

  private fields(model: string, path: string): Fields | null {
    const fields = MODELS.get(model);
    if (!fields) this.errors.push(`${path} : modèle inconnu « ${model} »`);
    return fields ?? null;
  }

  private unknown(model: string, path: string, key: string) {
    this.errors.push(`${path}.${key} : ${model} n'a pas de champ « ${key} »`);
  }

  where(model: string, where: unknown, path: string) {
    const fields = this.fields(model, path);
    if (!fields || !isObject(where)) return;
    for (const [key, value] of Object.entries(where)) {
      if (LOGICAL.has(key)) {
        for (const sub of Array.isArray(value) ? value : [value]) this.where(model, sub, `${path}.${key}`);
        continue;
      }
      const field = fields.get(key);
      if (!field) {
        if (!isCompoundKey(fields, key)) this.unknown(model, path, key);
        continue;
      }
      if (field.kind !== "object" || !isObject(value)) continue;
      for (const [op, sub] of Object.entries(value)) {
        if (RELATION_FILTERS.has(op)) this.where(field.type, sub, `${path}.${key}.${op}`);
        else this.where(field.type, { [op]: sub }, `${path}.${key}`);
      }
    }
  }

  select(model: string, select: unknown, path: string) {
    const fields = this.fields(model, path);
    if (!fields || !isObject(select)) return;
    for (const [key, value] of Object.entries(select)) {
      if (key === "_count") {
        // `_count: { select: { campuses: true } }` : des relations du modèle.
        const counted = isObject(value) && isObject(value.select) ? value.select : {};
        for (const name of Object.keys(counted)) {
          if (fields.get(name)?.kind !== "object") this.unknown(model, `${path}._count`, name);
        }
        continue;
      }
      const field = fields.get(key);
      if (!field) {
        this.unknown(model, path, key);
        continue;
      }
      if (field.kind === "object" && isObject(value)) this.relationRead(field.type, value, `${path}.${key}`);
    }
  }

  private relationRead(model: string, args: Record<string, unknown>, path: string) {
    for (const [key, value] of Object.entries(args)) {
      if (key === "select" || key === "include") this.select(model, value, `${path}.${key}`);
      else if (key === "where") this.where(model, value, `${path}.where`);
      else if (key === "orderBy") this.orderBy(model, value, `${path}.orderBy`);
      else if (!READ_ARGS.has(key)) this.errors.push(`${path}.${key} : argument de lecture inconnu`);
    }
  }

  orderBy(model: string, orderBy: unknown, path: string) {
    if (Array.isArray(orderBy)) {
      orderBy.forEach((item, i) => this.orderBy(model, item, `${path}[${i}]`));
      return;
    }
    const fields = this.fields(model, path);
    if (!fields || !isObject(orderBy)) return;
    for (const [key, value] of Object.entries(orderBy)) {
      if (key === "_count") continue;
      const field = fields.get(key);
      if (!field) this.unknown(model, path, key);
      else if (field.kind === "object" && isObject(value)) this.orderBy(field.type, value, `${path}.${key}`);
    }
  }

  data(model: string, data: unknown, path: string) {
    if (Array.isArray(data)) {
      data.forEach((item, i) => this.data(model, item, `${path}[${i}]`));
      return;
    }
    const fields = this.fields(model, path);
    if (!fields || !isObject(data)) return;
    for (const key of Object.keys(data)) if (!fields.has(key)) this.unknown(model, path, key);
  }
}

/** Les écarts au schéma des appels enregistrés par le faux Prisma ; vide si tout existe. */
export function schemaErrors(calls: readonly FakePrismaCall[]): string[] {
  const checker = new Checker();
  for (const call of calls) {
    if (call.model.startsWith("$")) continue;
    const model = call.model[0].toUpperCase() + call.model.slice(1);
    const path = `${call.model}.${call.method}`;
    if (!MODELS.has(model)) {
      checker.errors.push(`${path} : modèle inconnu « ${model} »`);
      continue;
    }
    const args = call.args[0];
    if (!isObject(args)) continue;
    if ("where" in args) checker.where(model, args.where, `${path}.where`);
    if ("select" in args) checker.select(model, args.select, `${path}.select`);
    if ("include" in args) checker.select(model, args.include, `${path}.include`);
    if ("orderBy" in args) checker.orderBy(model, args.orderBy, `${path}.orderBy`);
    for (const key of ["data", "create", "update"] as const) {
      if (key in args) checker.data(model, args[key], `${path}.${key}`);
    }
  }
  return checker.errors;
}
