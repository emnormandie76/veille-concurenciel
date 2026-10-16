/**
 * test/callback-url.test.ts — Où revenir après la connexion (lib/callback-url.ts)
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 1 : le proxy renvoie toute page vers la connexion
 * avec `callbackUrl` ; après la connexion, la personne revient à la page
 * demandée. Seul un chemin du site est suivi : une adresse d'un autre site
 * ferait de la page de connexion une redirection ouverte (hameçonnage).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { AFTER_LOGIN_DEFAULT, safeCallbackPath } from "../lib/callback-url";

test("un chemin du site est suivi tel quel, requête comprise", () => {
  for (const path of ["/", "/schools/abc", "/schools/abc/programs/def?onglet=tarifs", "/api-docs", "/admin/inbox?status=Pending_AI"]) {
    assert.equal(safeCallbackPath(path), path);
  }
});

test("sans callbackUrl : la destination par défaut", () => {
  assert.equal(AFTER_LOGIN_DEFAULT, "/admin/schools");
  for (const value of [null, undefined, ""]) {
    assert.equal(safeCallbackPath(value), AFTER_LOGIN_DEFAULT);
  }
});

test("une adresse d'un autre site n'est jamais suivie", () => {
  for (const value of [
    "https://exemple.org/",
    "http://localhost:3000/admin",
    "//exemple.org/chemin",
    "/\\exemple.org",
    "\\\\exemple.org",
    "javascript:alert(1)",
    "schools/abc",
    " /schools",
    "/%2F%2Fexemple.org",
  ]) {
    assert.equal(safeCallbackPath(value), AFTER_LOGIN_DEFAULT, value);
  }
});

test("la page de connexion elle-même n'est pas une destination", () => {
  for (const value of ["/admin/login", "/admin/login?callbackUrl=/", "/admin/login/"]) {
    assert.equal(safeCallbackPath(value), AFTER_LOGIN_DEFAULT, value);
  }
});

test("la première connexion non plus (étape 2) : une fois connecté, on n'y revient pas", () => {
  for (const value of ["/admin/first-login", "/admin/first-login?callbackUrl=/", "/admin/first-login/"]) {
    assert.equal(safeCallbackPath(value), AFTER_LOGIN_DEFAULT, value);
  }
});
