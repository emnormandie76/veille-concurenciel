/**
 * test/password.test.ts — Politique de mot de passe (lib/password.ts)
 *
 *     npm run test:ts
 *
 * 12 caractères au moins, 72 **octets** au plus : au-delà, bcrypt tronque sans
 * le dire, et deux mots de passe qui partagent leurs 72 premiers octets
 * deviennent interchangeables (architecture/gestion-contenu.md §2). Plan backend-local,
 * étape 7 (P0).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, validatePassword } from "../lib/password";

test("les bornes de la politique", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 12);
  assert.equal(MAX_PASSWORD_BYTES, 72);
});

test("11 caractères refusés, 12 acceptés", () => {
  assert.match(validatePassword("a".repeat(11)) ?? "", /au moins 12/);
  assert.equal(validatePassword("a".repeat(12)), null);
});

test("absent, vide ou d'un autre type : requis", () => {
  for (const value of [undefined, null, "", 123456789012, ["a".repeat(12)], {}]) {
    assert.equal(validatePassword(value), "Mot de passe requis.", String(value));
  }
});

test("72 octets acceptés, 73 refusés (ASCII)", () => {
  assert.equal(validatePassword("a".repeat(72)), null);
  assert.match(validatePassword("a".repeat(73)) ?? "", /72 octets/);
});

test("la limite se compte en octets, pas en caractères : multi-octets", () => {
  // « é » vaut 2 octets en UTF-8 : 36 font 72 octets, 37 en font 74.
  assert.equal(validatePassword("é".repeat(36)), null);
  assert.match(validatePassword("é".repeat(37)) ?? "", /72 octets/);

  // Un emoji vaut 4 octets : 18 font 72 octets, 19 en font 76, pour
  // seulement 38 unités de longueur JavaScript.
  assert.equal(validatePassword("🔑".repeat(18)), null);
  assert.match(validatePassword("🔑".repeat(19)) ?? "", /72 octets/);

  // 70 caractères qui dépasseraient en silence : bcrypt ne verrait que les
  // 72 premiers octets.
  const truncatedByBcrypt = "é".repeat(35) + "a".repeat(35);
  assert.equal(truncatedByBcrypt.length, 70);
  assert.match(validatePassword(truncatedByBcrypt) ?? "", /72 octets/);
});
