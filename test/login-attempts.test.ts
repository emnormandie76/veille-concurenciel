/**
 * test/login-attempts.test.ts — Le plafond de la connexion ne compte que les échecs (lib/login-attempts.ts)
 *
 *     npm run test:ts
 *
 * Décision D117 (le propriétaire, le 23 octobre 2026) : le plafond de
 * 5 tentatives par IP et par quart d'heure, posé par le proxy, comptait aussi
 * les connexions réussies ; l'équipe sortant par une seule IP, la sixième
 * connexion de l'école en un quart d'heure était refusée. Désormais, seuls
 * les échecs comptent, sur deux compteurs : 5 par compte (l'adresse saisie)
 * et 20 par IP, toutes adresses confondues ; le blocage dure 15 minutes
 * depuis le premier échec ; une réussite efface le compteur de son compte.
 * La connexion (lib/sign-in.ts, test/sign-in.test.ts) et la première
 * connexion (test/api/first-login.test.ts) partagent ces compteurs.
 *
 * Sans Upstash : le magasin mémoire de lib/rate-limit.ts, vidé entre deux
 * tests ; aucun appel réseau.
 */

import { beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  LOGIN_BLOCK_MS,
  LOGIN_BLOCKED,
  LOGIN_BLOCKED_MESSAGE,
  LOGIN_FAILURES_PER_ACCOUNT,
  LOGIN_FAILURES_PER_IP,
  clearLoginFailures,
  ipFromHeaders,
  loginBlocked,
  recordLoginFailure,
} from "../lib/login-attempts";
import { resetMemoryStore } from "../lib/rate-limit";

const read = (file: string) => readFileSync(file, "utf8").replace(/\r/g, "");
/** Le code seul, sans les commentaires. */
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$|\{\/\*[\s\S]*?\*\/\}/gm, "");

beforeEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  resetMemoryStore();
  mock.restoreAll();
  mock.timers.reset();
  // Le repli mémoire se signale une fois : ce n'est pas l'objet de ces tests.
  mock.method(console, "warn", () => {});
  mock.method(globalThis, "fetch", async () => {
    throw new Error("Appel réseau interdit dans ce test");
  });
});

/** Note `n` échecs pour `login` depuis `ip`. */
async function fail(login: string, ip: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await recordLoginFailure(login, ip);
}

test("D117 : 5 échecs par compte, 20 par IP, un blocage de 15 minutes", () => {
  assert.equal(LOGIN_FAILURES_PER_ACCOUNT, 5);
  assert.equal(LOGIN_FAILURES_PER_IP, 20);
  assert.equal(LOGIN_BLOCK_MS, 15 * 60 * 1000);
  assert.equal(LOGIN_BLOCKED, "TooManyAttempts");
  assert.equal(LOGIN_BLOCKED_MESSAGE, "Trop de tentatives de connexion. Réessayez dans quelques minutes.");
});

test("5 échecs sur une adresse la bloquent, depuis n'importe quelle IP ; une autre adresse passe", async () => {
  const jean = "jean.dupont@em-normandie.fr";
  await fail(jean, "203.0.113.1", 4);
  assert.equal(await loginBlocked(jean, "203.0.113.1"), false, "4 échecs : pas encore");
  await fail(jean, "203.0.113.2", 1);
  assert.equal(await loginBlocked(jean, "203.0.113.1"), true);
  assert.equal(await loginBlocked(jean, "198.51.100.9"), true, "changer d'IP ne débloque pas le compte");
  assert.equal(await loginBlocked("camille.martin@em-normandie.fr", "203.0.113.1"), false, "un collègue sur le même réseau passe");
});

test("l'adresse compte telle que la connexion la lit : la casse et les espaces ne font pas un autre compteur", async () => {
  await fail("Jean.Dupont@em-normandie.fr", "203.0.113.3", 3);
  await fail("  jean.dupont@EM-NORMANDIE.FR ", "203.0.113.3", 2);
  assert.equal(await loginBlocked("jean.dupont@em-normandie.fr", "192.0.2.1"), true);
});

test("20 échecs d'une IP, toutes adresses confondues, bloquent l'IP ; une autre IP passe", async () => {
  const ip = "203.0.113.4";
  for (let i = 0; i < 19; i++) await recordLoginFailure(`personne${i}@em-normandie.fr`, ip);
  assert.equal(await loginBlocked("nouveau@em-normandie.fr", ip), false, "19 échecs : pas encore");
  await recordLoginFailure("personne19@em-normandie.fr", ip);
  assert.equal(await loginBlocked("nouveau@em-normandie.fr", ip), true);
  assert.equal(await loginBlocked("nouveau@em-normandie.fr", "203.0.113.5"), false);
});

test("une réussite efface le compteur de son compte, pas celui de l'IP", async () => {
  const jean = "jean.dupont@em-normandie.fr";
  const ip = "203.0.113.6";
  await fail(jean, ip, 4);
  await clearLoginFailures(" Jean.Dupont@em-normandie.fr ");
  await fail(jean, ip, 4);
  assert.equal(await loginBlocked(jean, ip), false, "le compteur du compte est reparti de zéro");
  for (let i = 0; i < 12; i++) await recordLoginFailure(`autre${i}@em-normandie.fr`, ip);
  assert.equal(await loginBlocked("camille.martin@em-normandie.fr", ip), true, "les 8 échecs de Jean restent dans le compteur de l'IP");
});

test("le blocage tombe 15 minutes après le premier échec", async () => {
  mock.timers.enable({ apis: ["Date"], now: 5_000_000 });
  const jean = "jean.dupont@em-normandie.fr";
  await fail(jean, "203.0.113.7", 5);
  assert.equal(await loginBlocked(jean, "203.0.113.7"), true);
  mock.timers.tick(LOGIN_BLOCK_MS - 1);
  assert.equal(await loginBlocked(jean, "203.0.113.7"), true);
  mock.timers.tick(2);
  assert.equal(await loginBlocked(jean, "203.0.113.7"), false);
});

test("ipFromHeaders : l'IP de la plateforme, depuis les en-têtes que NextAuth passe en objet", () => {
  assert.equal(ipFromHeaders({ "x-vercel-forwarded-for": "203.0.113.8, 10.0.0.1", "x-forwarded-for": "192.0.2.99" }), "203.0.113.8");
  assert.equal(ipFromHeaders({ "x-real-ip": "198.51.100.2" }), "198.51.100.2");
  assert.equal(ipFromHeaders({ "x-real-ip": ["198.51.100.3"] }), "unknown", "une valeur qui n'est pas du texte est ignorée");
  assert.equal(ipFromHeaders(undefined), "unknown");
});

test("la page de connexion dit le blocage, et non « mot de passe incorrect », sans embarquer les compteurs", () => {
  const page = code("app/(admin-auth)/admin/login/page.tsx");
  assert.match(page, /import \{ FIRST_LOGIN_PATH, LOGIN_BLOCKED, LOGIN_BLOCKED_MESSAGE \} from "@\/lib\/roles";/);
  assert.doesNotMatch(page, /login-attempts|rate-limit/, "un composant client n'importe pas le magasin des compteurs");
  assert.match(page, /result\.error === LOGIN_BLOCKED \? LOGIN_BLOCKED_MESSAGE : "Adresse e-mail ou mot de passe incorrect\."/);
  assert.match(page, /urlError === LOGIN_BLOCKED/);
});
