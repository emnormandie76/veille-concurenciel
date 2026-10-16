/**
 * test/accounts.test.ts — Les comptes de la liste blanche (lib/accounts.ts)
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 2 :
 * - D5 : seul le domaine `@em-normandie.fr` est accepté, par une constante du
 *   code ; l'élargir est une décision du propriétaire, et ce test change avec
 *   elle ;
 * - les adresses sont rangées en minuscules, sans espaces : l'unicité en base
 *   ne vaut que sur une forme unique ;
 * - D6 : le nom affiché, prérempli depuis `prenom.nom@…`, borné ;
 * - les trois états d'un compte (G5, D4, D21), liste de référence de la
 *   contrainte CHECK `User_status_check` (test/accounts-migration.test.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACCOUNT_STATUSES,
  MAX_DISPLAY_NAME_LENGTH,
  STATUS_LABELS,
  WORK_EMAIL_DOMAIN,
  displayNameOf,
  isAccountStatus,
  nameFromEmail,
  normalizeEmail,
  validateDisplayName,
  validateWorkEmail,
} from "../lib/accounts";

// ── D5 : le domaine ───────────────────────────────────────────────────

test("D5 : le domaine imposé est em-normandie.fr", () => {
  assert.equal(WORK_EMAIL_DOMAIN, "em-normandie.fr");
});

test("une adresse du domaine est acceptée, rangée en minuscules et sans espaces", () => {
  assert.deepEqual(validateWorkEmail("jean.dupont@em-normandie.fr"), {
    email: "jean.dupont@em-normandie.fr",
    error: null,
  });
  assert.deepEqual(validateWorkEmail("  Jean-Pierre.DUPONT@EM-Normandie.FR "), {
    email: "jean-pierre.dupont@em-normandie.fr",
    error: null,
  });
  assert.equal(validateWorkEmail("j.dupont+veille@em-normandie.fr").error, null);
});

test("D5 : toute adresse hors du domaine est refusée, sous-domaines et sosies compris", () => {
  for (const email of [
    "jean.dupont@gmail.com",
    "jean.dupont@etu.em-normandie.fr",
    "jean.dupont@em-normandie.fr.example.com",
    "jean.dupont@em-normandie.com",
    "jean.dupont@xem-normandie.fr",
  ]) {
    const { email: accepted, error } = validateWorkEmail(email);
    assert.equal(accepted, null, email);
    assert.match(error ?? "", /@em-normandie\.fr/, email);
  }
});

test("une adresse mal formée est refusée", () => {
  for (const email of [
    "",
    "   ",
    "jean.dupont",
    "@em-normandie.fr",
    "jean dupont@em-normandie.fr",
    "jean..dupont@em-normandie.fr",
    ".jean@em-normandie.fr",
    "jean.@em-normandie.fr",
    "jean@dupont@em-normandie.fr",
    "jéan@em-normandie.fr",
    `${"a".repeat(65)}@em-normandie.fr`,
  ]) {
    assert.equal(validateWorkEmail(email).email, null, JSON.stringify(email));
  }
  for (const value of [undefined, null, 42, {}, ["jean@em-normandie.fr"]]) {
    assert.equal(validateWorkEmail(value).email, null, String(value));
  }
});

test("normalizeEmail : minuscules et espaces retirés, rien d'autre", () => {
  assert.equal(normalizeEmail("  Jean.Dupont@EM-normandie.fr\t"), "jean.dupont@em-normandie.fr");
});

// ── D6 : le nom affiché ───────────────────────────────────────────────

test("D6 : le nom se déduit de prenom.nom@…", () => {
  const cases: [string, string][] = [
    ["jean.dupont@em-normandie.fr", "Jean Dupont"],
    ["jean-pierre.de-la-tour@em-normandie.fr", "Jean-Pierre De-La-Tour"],
    ["marie_curie@em-normandie.fr", "Marie Curie"],
    ["jdupont@em-normandie.fr", "Jdupont"],
    ["j.dupont+veille@em-normandie.fr", "J Dupont"],
  ];
  for (const [email, name] of cases) assert.equal(nameFromEmail(email), name, email);
});

test("D6 : un nom affiché est nettoyé et borné", () => {
  assert.deepEqual(validateDisplayName("  Jean   Dupont "), { name: "Jean Dupont", error: null });
  assert.equal(validateDisplayName("Al").error, null);

  for (const value of [undefined, null, 3, "", "   ", "J", "a".repeat(MAX_DISPLAY_NAME_LENGTH + 1), "Jean\u0000Dupont", "Jean\nDupont"]) {
    assert.equal(validateDisplayName(value).name, null, JSON.stringify(value));
  }
  assert.equal(validateDisplayName("a".repeat(MAX_DISPLAY_NAME_LENGTH)).error, null);
});

test("le nom montré d'un compte : son nom affiché, sinon l'ancien identifiant, sinon l'adresse", () => {
  assert.equal(displayNameOf({ display_name: "Jean Dupont", username: "jdupont", email: "j@em-normandie.fr" }), "Jean Dupont");
  assert.equal(displayNameOf({ display_name: null, username: "jdupont", email: null }), "jdupont");
  assert.equal(displayNameOf({ display_name: null, username: null, email: "j@em-normandie.fr" }), "j@em-normandie.fr");
});

// ── Les états ─────────────────────────────────────────────────────────

test("trois états : invité, actif, désactivé", () => {
  assert.deepEqual([...ACCOUNT_STATUSES], ["INVITED", "ACTIVE", "DISABLED"]);
  assert.deepEqual(STATUS_LABELS, { INVITED: "Invité", ACTIVE: "Actif", DISABLED: "Désactivé" });
  for (const status of ACCOUNT_STATUSES) assert.equal(isAccountStatus(status), true);
  for (const value of ["active", "PENDING", "", null, undefined]) assert.equal(isAccountStatus(value), false);
});
