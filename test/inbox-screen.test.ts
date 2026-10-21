/**
 * test/inbox-screen.test.ts — L'inbox dans la charte, le style seulement
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 9, lot 4 (D54). L'inbox appartient à la partie
 * IA gelée (règle 10, plan §6) : seul son style change. Ce test garde :
 *
 * - **ce qui ne bouge pas** : les requêtes (adresse, méthode, corps) et les
 *   identifiants des éléments ;
 * - **les décisions du propriétaire du 21 octobre** : le panneau de détail en
 *   dialogue collé à droite, fermé aussi par un clic à côté (D76) ; un ton
 *   de badge par état (D77) ; ni ✓, ni ✕, ni ⚠ en tête des textes, les
 *   boutons « ✕ » seuls devenus des boutons d'icône nommés (D78) ; des liens
 *   cliquables en http(s) seulement (D79, `sourceHref`) ; le bandeau des
 *   contributions en attente au ton « info » (D80) ;
 * - **les règles déjà tranchées** : libellés visibles (D58, D65), l'erreur
 *   de la purge dans sa fenêtre (D67).
 *
 * L'écran est un composant client qui lit ses données par `fetch` : on lit
 * sa source. Aucun émoji ni `style` en ligne : test/charte.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FLAG_TONES,
  TICKET_STATUS_TONES,
  matchConfidence,
  ticketStatusTone,
} from "../app/admin/inbox/ticket-tones";

const PAGE = "app/admin/inbox/page.tsx";
const read = (file: string) => readFileSync(file, "utf8").replace(/\r/g, "");
/** Le code seul, sans les commentaires (un commentaire peut nommer ce que le code n'a plus). */
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$|\{\/\*[\s\S]*?\*\/\}/gm, "");

/** Le corps d'une fonction fléchée `const name = async (…) => { … };` de la page, à deux espaces de retrait. */
function arrowBody(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `${name} absente de la page`);
  const end = source.indexOf("\n  };", start);
  assert.ok(end > start, `fin de ${name} introuvable`);
  return source.slice(start, end);
}

// ─── Ce qui ne bouge pas (règle 10) ─────────────────────────────────────────

/** Chaque appel à `fetch` : l'adresse telle qu'écrite, la méthode, le corps. */
function fetchCalls(source: string): string[] {
  const calls: string[] = [];
  for (const match of source.matchAll(/fetch\(\s*(`[^`]*`|"[^"]*")/g)) {
    const tail = source.slice(match.index! + match[0].length, match.index! + match[0].length + 400);
    // Les options vont jusqu'à la fin de l'appel, `});` (un corps finit par `}),`).
    const options = tail.startsWith(",") ? tail.slice(0, tail.indexOf("});")) : "";
    const method = options.match(/method:\s*"(\w+)"/)?.[1] ?? "GET";
    const body = options.match(/body:\s*(JSON\.stringify\(.*\))\s*,?\s*$/m)?.[1] ?? "";
    calls.push([method, match[1], body].join(" ").trim());
  }
  return calls.sort();
}

test("règle 10 : les requêtes de l'inbox ne changent pas (adresse, méthode, corps)", () => {
  assert.deepEqual(
    fetchCalls(code(PAGE)),
    [
      "DELETE \"/api/admin/inbox/purge\" JSON.stringify({ statuses: purgeStatuses })",
      "GET `/api/admin/inbox/${selectedTicket.id}`",
      "GET `/api/admin/inbox?${params}`",
      "GET `/api/admin/inbox?status=${STATUS_PENDING_AI}&limit=1`",
      "GET `/api/admin/inbox?status=${status}&limit=1`",
      "POST `/api/admin/inbox/${ticket.id}/create-programs` JSON.stringify({ programNames })",
      "PUT `/api/admin/inbox/${selectedTicket.id}/reject`",
      "PUT `/api/admin/inbox/${selectedTicket.id}/validate` JSON.stringify(body)",
      "PUT `/api/admin/inbox/${ticket.id}/attachments` JSON.stringify({ campus_attachments: rows, campus_policy_notes: notes })",
    ].sort(),
  );
});

test("règle 10 : les identifiants des éléments de l'inbox restent", () => {
  const page = code(PAGE);
  for (const id of [
    'id="btn-open-purge"',
    'id="filter-status"',
    'id="filter-category"',
    'id="btn-reject-ticket"',
    'id="purge-status-filter"',
    'id="btn-confirm-purge"',
    'id="btn-add-campus"',
    "id={`campus-name-${ci}`}",
    "id={`campus-city-${ci}`}",
    "id={`prog-name-${ci}-${pi}`}",
    "id={`prog-exam-${ci}-${pi}`}",
    'id="btn-validate-discovery"',
    'id="btn-write-campus-attachments"',
    "id={`field-${key}`}",
    'id="btn-validate-generic"',
    'id="btn-validate-accreditations"',
  ]) {
    assert.ok(page.includes(id), id);
  }
});

// ─── D76 : le panneau de détail ─────────────────────────────────────────────

test("D76 : le détail d'un ticket est un dialogue collé à droite, que ferme aussi un clic à côté ; plus de calque maison", () => {
  const page = code(PAGE);
  assert.match(page, /import \{ Dialog, DialogFooter \} from "@\/components\/ui\/Dialog"/);
  const panel = page.match(/<Dialog\b[^>]*placement="side"[^>]*>/)?.[0];
  assert.ok(panel, "le panneau passe par la variante side");
  assert.match(panel, /\bcloseOnBackdrop\b/);
  assert.match(panel, /onClose=\{closePanel\}/);
  // La fenêtre de purge se ferme aussi à côté, comme avant, mais pas pendant la purge.
  const purge = page.match(/<Dialog\b[^>]*titleId="inbox-purge-title"[^>]*>/)?.[0];
  assert.ok(purge, "la fenêtre de purge est un dialogue de la charte");
  assert.match(purge, /\bcloseOnBackdrop\b/);
  assert.match(arrowBody(page, "closePurge"), /if \(!purgeLoading\)/);
  // Le calque, le panneau et le bloc <style> global de l'ancien écran sont partis.
  assert.doesNotMatch(page, /panel-overlay|purge-modal|<style/);
});

// ─── D77 : un ton par état ──────────────────────────────────────────────────

test("D77 : le statut d'un ticket, ses alertes et la correspondance d'un programme, un ton par état", () => {
  assert.deepEqual(TICKET_STATUS_TONES, {
    Pending_AI: "neutral",
    Pending_Admin: "warning",
    Validated: "success",
    Rejected: "neutral",
    Failed: "danger",
  });
  assert.equal(ticketStatusTone("Pending_Admin"), "warning");
  assert.equal(ticketStatusTone("Inconnu"), "neutral");
  assert.deepEqual(FLAG_TONES, { year_assumed: "warning", data_conflict_warning: "danger", program_name_mismatch: "warning" });
  // Les textes d'avant, sans leur symbole (D78).
  assert.deepEqual(matchConfidence("exact"), { tone: "success", label: "Match exact" });
  assert.deepEqual(matchConfidence("fuzzy"), { tone: "warning", label: "Match approximatif" });
  assert.deepEqual(matchConfidence("none"), { tone: "danger", label: "Non matché" });
  assert.deepEqual(matchConfidence("autre"), matchConfidence("none"));

  const page = code(PAGE);
  assert.match(page, /<Badge tone=\{ticketStatusTone\(t\.status\)\}>/);
  assert.match(page, /<Badge tone=\{ticketStatusTone\(selectedTicket\.status\)\}>/);
  for (const flag of Object.keys(FLAG_TONES)) assert.match(page, new RegExp(`tone=\\{FLAG_TONES\\.${flag}\\}`), flag);
});

// ─── D78 : ni ✓, ni ✕, ni ⚠ ─────────────────────────────────────────────────

test("D78 : aucun ✓, ✕ ni ⚠ dans les textes ; les boutons « ✕ » seuls sont des boutons d'icône nommés", () => {
  const page = code(PAGE);
  assert.doesNotMatch(page, /[✓✕⚠✔✖✗❌✅]/u);
  for (const name of ["Supprimer ce programme", "Retirer cette ligne avant l'écriture"]) {
    assert.match(page, new RegExp(`size="icon"[^>]*aria-label="${name}"|aria-label="${name}"[^>]*size="icon"`), name);
  }
  // Les textes, sans leur symbole.
  for (const text of [
    "Réinitialiser",
    "Valider — Créer Campus & Programmes",
    "Valider et publier — ${ticket.ai_category}",
    "Valider et Publier ces accréditations",
    "Valider — ${programs.length} programme(s) ${ticket.ai_category}",
    "Écrire ${rows.length} ligne(s)-année(s) et ${notes.length} note(s)",
    '"Ticket validé"',
    "Rejeter ce ticket",
  ]) {
    assert.ok(page.includes(text), text);
  }
});

// ─── D79 : des liens http(s) seulement ──────────────────────────────────────

test("D79 : chaque lien de l'inbox passe par sourceHref, en nouvel onglet ; une autre adresse reste du texte", () => {
  const page = code(PAGE);
  assert.match(page, /import \{ sourceHref \} from "@\/lib\/provenance"/);
  assert.match(page, /const href = sourceHref\(url\);/);
  // Un seul élément <a>, celui du composant qui contrôle l'adresse.
  const hrefs = [...page.matchAll(/href=\{([^}]+)\}/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ["href"]);
  assert.equal(page.match(/<a\b/g)?.length, 1);
  assert.match(page, /<a href=\{href\} target="_blank" rel="noopener noreferrer"/);
  // Les quatre endroits : « Sources », la fiche d'un rattachement, la source
  // d'une voie d'admission, celle d'une accréditation.
  for (const url of ["url={url}", "url={row.source_url}", "url={item.source_url}"]) assert.ok(page.includes(url), url);
  assert.equal(page.match(/<WebLink\b/g)?.length, 4);
});

// ─── D80 : le bandeau des contributions en attente ──────────────────────────

test("D80 : le bandeau des contributions en attente est un message au ton « info », texte inchangé", () => {
  const page = code(PAGE);
  const banner = page.match(/<Alert tone="info"[\s\S]*?<\/Alert>/)?.[0];
  assert.ok(banner, "le bandeau passe par Alert");
  assert.match(banner, /describePendingAi\(pendingAi\)/);
  assert.match(banner, /Passage en <code[^>]*>Pending_Admin<\/code> au prochain/);
  assert.match(banner, /lancement du backend, sur le poste de l&apos;admin\./);
  assert.match(banner, />\s*Voir\s*</);
});

// ─── Règles déjà tranchées ──────────────────────────────────────────────────

test("D58, D65 : les deux filtres et les deux champs d'un programme découvert ont un libellé visible, relié", () => {
  const page = code(PAGE);
  assert.match(page, /<Field id="filter-status" label="Statut"/);
  assert.match(page, /<Field id="filter-category" label="Catégorie"/);
  // Tirés du texte indicatif, qui reste.
  assert.match(page, /<Field id=\{`prog-name-\$\{ci\}-\$\{pi\}`\} label="Nom exact du programme"/);
  assert.match(page, /<Field id=\{`prog-exam-\$\{ci\}-\$\{pi\}`\} label="Concours d'admission \(optionnel\)"/);
  assert.match(page, /placeholder="Nom exact du programme"/);
  assert.match(page, /placeholder="Concours d'admission \(optionnel\)"/);
  // Les libellés qui existaient sont reliés à leur champ : plus de <label> nu.
  assert.doesNotMatch(page, /<label className="form-label"/);
});

test("D67 : l'échec d'une purge s'affiche dans sa fenêtre, plus sur la page derrière", () => {
  const page = code(PAGE);
  const purge = arrowBody(page, "handlePurge");
  assert.match(purge, /setPurgeError\(/);
  assert.doesNotMatch(purge, /\bsetError\(/);
  assert.match(page, /\{purgeError && <Alert tone="danger">\{purgeError\}<\/Alert>\}/);
});
