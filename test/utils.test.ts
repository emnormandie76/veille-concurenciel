/**
 * test/utils.test.ts — Sûreté des URL soumises (lib/utils.ts)
 *
 *     npm run test:ts
 *
 * La liste blanche des contributions reposait sur ces fonctions :
 * `urlBelongsToDomain` accepte le domaine de l'école
 * et ses sous-domaines, et doit rejeter les sosies. Plan backend-local,
 * étape 7 (P0).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isPrivateHost,
  isValidHttpsUrl,
  normalizeDomain,
  parsePagination,
  urlBelongsToDomain,
} from "../lib/utils";

test("isValidHttpsUrl : https seulement, et une URL lisible", () => {
  assert.equal(isValidHttpsUrl("https://emlv.fr/programmes"), true);
  assert.equal(isValidHttpsUrl("HTTPS://EMLV.FR/"), true);
  for (const url of [
    "http://emlv.fr/",
    "ftp://emlv.fr/fichier",
    "javascript:alert(1)",
    "data:text/html,<p>",
    "emlv.fr",
    "//emlv.fr/",
    "https//emlv.fr",
    "",
  ]) {
    assert.equal(isValidHttpsUrl(url), false, url);
  }
});

test("normalizeDomain : schéma, chemin, port, identifiants, www et casse retirés", () => {
  assert.equal(normalizeDomain("em-lyon.com"), "em-lyon.com");
  assert.equal(normalizeDomain("www.em-normandie.com"), "em-normandie.com");
  // Valeur réelle en base : official_domain porte un chemin.
  assert.equal(normalizeDomain("em-strasbourg.com/fr"), "em-strasbourg.com");
  assert.equal(normalizeDomain("  HTTPS://WWW.EMLV.FR:443/fr?x=1#a "), "emlv.fr");
  assert.equal(normalizeDomain("https://user:secret@emlv.fr/"), "emlv.fr");
  assert.equal(normalizeDomain("emlv.fr."), "emlv.fr");
  // Seul un « www. » de tête est retiré.
  assert.equal(normalizeDomain("admissions.www.emlv.fr"), "admissions.www.emlv.fr");
});

test("urlBelongsToDomain : le domaine et ses sous-domaines", () => {
  assert.equal(urlBelongsToDomain("https://emlv.fr/", "emlv.fr"), true);
  assert.equal(urlBelongsToDomain("https://www.emlv.fr/programmes", "emlv.fr"), true);
  assert.equal(urlBelongsToDomain("https://admissions.emlv.fr/", "www.emlv.fr"), true);
  assert.equal(urlBelongsToDomain("https://a.b.emlv.fr/", "emlv.fr"), true);
});

test("urlBelongsToDomain : port et majuscules n'y changent rien", () => {
  assert.equal(urlBelongsToDomain("https://emlv.fr:8443/", "emlv.fr"), true);
  assert.equal(urlBelongsToDomain("https://WWW.EMLV.FR/Programmes", "emlv.fr"), true);
  assert.equal(urlBelongsToDomain("https://www.emlv.fr/", "EMLV.FR"), true);
  assert.equal(urlBelongsToDomain("https://www.em-strasbourg.com/x", "em-strasbourg.com/fr"), true);
});

test("urlBelongsToDomain : les sosies sont rejetés", () => {
  for (const url of [
    "https://emlv.fr.evil.com/",
    "https://evil-emlv.fr/",
    "https://evilemlv.fr/",
    "https://emlv.free.fr/",
    "https://emlv.fr@evil.com/",
    "https://evil.com/emlv.fr",
    "https://evil.com/?site=emlv.fr",
    "https://evil.com#emlv.fr",
  ]) {
    assert.equal(urlBelongsToDomain(url, "emlv.fr"), false, url);
  }
});

test("urlBelongsToDomain : base vide ou URL illisible → faux", () => {
  assert.equal(urlBelongsToDomain("https://emlv.fr/", ""), false);
  assert.equal(urlBelongsToDomain("https://emlv.fr/", "   "), false);
  assert.equal(urlBelongsToDomain("pas une url", "emlv.fr"), false);
});

test("isPrivateHost : boucle locale, plages privées, lien-local, CGNAT, noms internes", () => {
  for (const host of [
    "localhost",
    "LOCALHOST",
    "api.localhost",
    "imprimante.local",
    "db.internal",
    "nas.home.arpa",
    "0.0.0.0",
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.10",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "::",
    "::1",
    "[::1]",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
  ]) {
    assert.equal(isPrivateHost(host), true, host);
  }
});

test("isPrivateHost : les adresses publiques passent, bornes des plages comprises", () => {
  for (const host of [
    "emlv.fr",
    "8.8.8.8",
    "172.15.255.255",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "192.169.0.1",
    "2001:db8::1",
    "local.emlv.fr",
  ]) {
    assert.equal(isPrivateHost(host), false, host);
  }
});

test("isPrivateHost : les formes d'IPv4 que l'URL normalise sont reconnues", () => {
  // Le parseur WHATWG ramène ces écritures à 127.0.0.1 avant le contrôle.
  for (const url of ["https://2130706433/", "https://0177.0.0.1/", "https://0x7f.1/", "https://127.1/"]) {
    assert.equal(isPrivateHost(new URL(url).hostname), true, url);
  }
});

test("isPrivateHost : une IPv4 encapsulée dans une IPv6 est jugée comme l'IPv4", () => {
  // Le parseur d'URL réécrit [::ffff:127.0.0.1] en [::ffff:7f00:1]. Ces formes
  // passaient pour publiques jusqu'au 14 octobre 2026 (constat de l'étape 7,
  // corrigé avec l'accord du propriétaire).
  for (const url of [
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:10.0.0.1]/",
    "https://[::ffff:169.254.169.254]/",
    "https://[0:0:0:0:0:ffff:192.168.1.1]/",
  ]) {
    assert.equal(isPrivateHost(new URL(url).hostname), true, url);
  }
  assert.equal(isPrivateHost("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateHost("::ffff:7f00:1"), true);
  assert.equal(isPrivateHost(new URL("https://[::ffff:8.8.8.8]/").hostname), false);
});

test("isPrivateHost : un point final ne déguise pas un nom interne", () => {
  for (const host of ["localhost.", "LOCALHOST.", "intranet.local.", "db.internal..", "127.0.0.1."]) {
    assert.equal(isPrivateHost(host), true, host);
  }
  assert.equal(isPrivateHost(new URL("https://localhost./").hostname), true);
  assert.equal(isPrivateHost("emlv.fr."), false);
});

test("parsePagination : bornes de page et de limite", () => {
  const read = (query: string) => parsePagination(new URLSearchParams(query));

  assert.deepEqual(read(""), { page: 1, limit: 20, skip: 0 });
  assert.deepEqual(read("page=3&limit=10"), { page: 3, limit: 10, skip: 20 });
  assert.deepEqual(read("page=0&limit=0"), { page: 1, limit: 1, skip: 0 });
  assert.deepEqual(read("page=-4&limit=5000"), { page: 1, limit: 100, skip: 0 });
});

test("parsePagination : une valeur vide ou non numérique reprend la valeur par défaut", () => {
  const read = (query: string, defaultLimit?: number) =>
    parsePagination(new URLSearchParams(query), defaultLimit);

  // Avant le 14 octobre 2026 : NaN, que Prisma refuse (500).
  assert.deepEqual(read("page=abc&limit=xyz"), { page: 1, limit: 20, skip: 0 });
  assert.deepEqual(read("page=&limit="), { page: 1, limit: 20, skip: 0 });
  assert.deepEqual(read("page=2&limit=abc", 50), { page: 2, limit: 50, skip: 50 });
  assert.deepEqual(read("", 50), { page: 1, limit: 50, skip: 0 });
  assert.deepEqual(read("limit=500", 50), { page: 1, limit: 100, skip: 0 });
  assert.deepEqual(read("page=2.9&limit=15"), { page: 2, limit: 15, skip: 15 });
});
