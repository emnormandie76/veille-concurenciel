/**
 * test/request-body.test.ts — Corps facultatif des routes d'écriture de l'inbox
 *
 *     npm run test:ts
 *
 * `readOptionalJsonObject` distingue « pas de corps » (le ticket tel quel) d'un
 * corps illisible (refus) : c'est la correction de F2 (plan backend-local,
 * étape 7). Les routes elles-mêmes : test/api/inbox-validate.test.ts et
 * test/api/inbox-attachments.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  adminCorrections,
  invalidNumbersMessage,
  readJsonObject,
  readOptionalJsonObject,
  readOptionalNumbers,
} from "../lib/request-body";

const request = (body?: string) =>
  new Request("http://localhost/x", { method: "PUT", body });

test("aucun corps, ou un corps blanc : pas de corrections", async () => {
  assert.deepEqual(await readOptionalJsonObject(request()), { ok: true, body: null });
  assert.deepEqual(await readOptionalJsonObject(request("")), { ok: true, body: null });
  assert.deepEqual(await readOptionalJsonObject(request(" \r\n\t")), { ok: true, body: null });
});

test("un objet JSON est rendu tel quel, {} compris", async () => {
  assert.deepEqual(await readOptionalJsonObject(request('{"total_fee": 39000}')), {
    ok: true,
    body: { total_fee: 39000 },
  });
  assert.deepEqual(await readOptionalJsonObject(request("{}")), { ok: true, body: {} });
});

test("un JSON mal formé est refusé, avec un message qui dit que rien n'a été écrit", async () => {
  const result = await readOptionalJsonObject(request('{"total_fee": 39000'));

  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /illisible.*rien n'a été écrit/);
});

test("une valeur JSON qui n'est pas un objet est refusée", async () => {
  for (const body of ["null", "[]", "[{}]", "42", "true", '"texte"']) {
    const result = await readOptionalJsonObject(request(body));
    assert.equal(result.ok, false, body);
  }
});

test("readJsonObject (routes des comptes) : un objet JSON, sinon null, corps absent compris", async () => {
  assert.deepEqual(await readJsonObject(request('{"email":"a@b"}')), { email: "a@b" });
  assert.deepEqual(await readJsonObject(request("{}")), {});
  for (const body of [undefined, "", "   ", "{pas du json", "null", "[]", "42", '"texte"']) {
    assert.equal(await readJsonObject(request(body)), null, String(body));
  }
});

test("adminCorrections : {} et l'absence valent « tel quel », un objet non vide prime", () => {
  assert.equal(adminCorrections(null), null);
  assert.equal(adminCorrections({}), null);
  assert.deepEqual(adminCorrections({ a: 1 }), { a: 1 });
});

test("readOptionalNumbers : absent, null ou vide → null ; entier en base 10 ; décimal", () => {
  const { values, invalid } = readOptionalNumbers(
    { a: "12", b: 0, c: "", d: null, f: "42.5", g: "0x1A" },
    { a: "int", b: "int", c: "int", d: "int", e: "int", f: "float", g: "int" }
  );

  assert.deepEqual(values, { a: 12, b: 0, c: null, d: null, e: null, f: 42.5, g: 0 });
  assert.deepEqual(invalid, []);
});

test("readOptionalNumbers : une valeur illisible est nommée, jamais rendue en NaN", () => {
  // Un NaN qui atteint Prisma est écrit en NULL : il effacerait la valeur.
  const { values, invalid } = readOptionalNumbers(
    { total_fee: "quarante mille", rank: true, pct: "un tiers", ok: "3" },
    { total_fee: "int", rank: "int", pct: "float", ok: "int" }
  );

  assert.deepEqual(invalid, ["total_fee", "rank", "pct"]);
  assert.ok(Object.values(values).every((v) => v === null || Number.isFinite(v)));
  assert.equal(values.ok, 3);
  assert.equal(invalidNumbersMessage(invalid), "Valeur non numérique pour : total_fee, rank, pct. Rien n'a été écrit.");
});
