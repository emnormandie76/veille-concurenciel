/**
 * test/cron-screen.test.ts — /admin/cron dans la charte, le style seulement
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 9, lot 5 (D54). L'écran appartient à la partie
 * IA gelée (règle 10, plan §6) : seul son style change. Ce test garde :
 *
 * - **ce qui ne bouge pas** : les cinq requêtes (adresse, méthode, en-tête,
 *   corps, cache), le corps d'une recherche ciblée, les rafraîchissements,
 *   l'identifiant du bloc des contributions, les contrôles de l'ADMIN ;
 * - **les décisions du propriétaire du 21 octobre** : D46 posée (D81 « Réservé
 *   aux ADMIN » retiré, D82 « Job #<id> » retiré, D83 les contributions
 *   gardées), la confirmation d'une passe réelle dans le dialogue de la
 *   charte (D84), les bandeaux du backend (D85), les barres natives (D86),
 *   un ton par état (D87), l'en-tête des quotas en bouton natif (D88), le
 *   choix de la phase en `aria-pressed` (D89), le détail d'un job sous sa
 *   ligne (D90), l'école tronquée des passes dues gardée (D91) ;
 * - **les règles déjà tranchées** : émojis retirés (D56), ✓, ✕ et ⚠ aussi
 *   (D78), libellés visibles et reliés (D58, D65), contenu de l'IA en texte.
 *
 * Le composant principal lit ses données par `fetch` : on lit sa source. Les
 * trois panneaux ne dépendent que de leurs props : on les rend côté serveur.
 * Aucun émoji ni `style` en ligne : test/charte.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import JobHistory from "../app/admin/cron/JobHistory";
import QuotaTavilyPanel from "../app/admin/cron/QuotaTavilyPanel";
import RotationPanel from "../app/admin/cron/RotationPanel";
import {
  CROWDSOURCING_TEXT_TONES,
  JOB_STATUS_TONES,
  ROTATION_MODE_TONES,
  USAGE_TEXT_TONES,
  usageTone,
} from "../app/admin/cron/cron-tones";
import type { PipelineJobRow, PipelineJobsResponse } from "../lib/pipeline-history";
import type { RotationStatus } from "../lib/rotation-status";

const DIR = "app/admin/cron";
const MAIN = `${DIR}/CronMonitoringClient.tsx`;
const ROTATION = `${DIR}/RotationPanel.tsx`;
const QUOTAS = `${DIR}/QuotaTavilyPanel.tsx`;
const HISTORY = `${DIR}/JobHistory.tsx`;
const FILES = [MAIN, ROTATION, QUOTAS, HISTORY, `${DIR}/page.tsx`];

const read = (file: string) => readFileSync(file, "utf8").replace(/\r/g, "");
/** Le code seul, sans les commentaires (un commentaire peut nommer ce que le code n'a plus). */
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$|\{\/\*[\s\S]*?\*\/\}/gm, "");
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

/** La classe du `<span>` dont le texte est exactement `text` (un badge). */
function spanClass(out: string, text: string): string {
  const match = out.match(new RegExp(`<span class="([^"]*)">${text}</span>`));
  assert.ok(match, `badge « ${text} » introuvable`);
  return match[1];
}

/** Le ton du message `Alert` qui contient `text` dans la source. */
function alertToneOf(source: string, text: string): string {
  const at = source.indexOf(text);
  assert.ok(at >= 0, `« ${text} » absent`);
  const before = source.slice(0, at);
  const open = before.lastIndexOf("<Alert tone=");
  assert.ok(open >= 0 && before.indexOf("</Alert>", open) < 0, `« ${text} » hors d'un Alert`);
  return before.slice(open).match(/<Alert tone="(\w+)"/)?.[1] ?? "";
}

// ─── Ce qui ne bouge pas (règle 10) ─────────────────────────────────────────

/** Chaque appel à `fetch` : méthode, adresse telle qu'écrite, en-tête, cache, corps. */
function fetchCalls(source: string): string[] {
  const calls: string[] = [];
  for (const match of source.matchAll(/fetch\(\s*(`[^`]*`|"[^"]*")/g)) {
    const tail = source.slice(match.index! + match[0].length, match.index! + match[0].length + 400);
    // Les options vont jusqu'à la fin de l'appel, `});` (un corps finit par `}),`).
    const options = tail.startsWith(",") ? tail.slice(0, tail.indexOf("});")) : "";
    const method = options.match(/method:\s*"(\w+)"/)?.[1] ?? "GET";
    const type = options.match(/"Content-Type":\s*"([^"]+)"/)?.[1] ?? "";
    const cache = options.match(/cache:\s*"([^"]+)"/)?.[1] ?? "";
    const body = options.match(/body:\s*(JSON\.stringify\(.*\))\s*,?\s*$/m)?.[1] ?? "";
    calls.push([method, match[1], type, cache && `cache:${cache}`, body].filter(Boolean).join(" "));
  }
  return calls;
}

test("règle 10 : les cinq requêtes de /admin/cron ne changent pas (adresse, méthode, en-tête, cache, corps)", () => {
  assert.deepEqual(
    FILES.flatMap((file) => fetchCalls(code(file))).sort(),
    [
      'GET "/api/admin/pipeline-jobs" cache:no-store',
      'GET "/api/admin/pipeline-status" cache:no-store',
      'GET "/api/admin/schools-with-programs"',
      'POST "/api/admin/run-due-passes" application/json JSON.stringify({ max_passes: maxPasses, dry_run: dryRun })',
      'POST "/api/admin/trigger-research" application/json JSON.stringify(body)',
    ].sort(),
  );
});

test("règle 10 : le corps d'une recherche ciblée, les rafraîchissements et l'identifiant du bloc des contributions restent", () => {
  const main = code(MAIN).replace(/\s+/g, " ");
  assert.match(
    main,
    /buildLaunchBody\(\{ schoolId: selectedSchoolId, phase: selectedPhase, programId: selectedProgramId, categories: selectedCategories, collectCampusAttachments, \}\)/,
  );
  assert.match(main, /const STATUS_POLL_MS = 5000;/);
  assert.match(main, /const HISTORY_POLL_MS = 10000;/);
  assert.match(main, /if \(backendRef\.current\?\.kind !== "local_only"\) fetchPipelineStatus\(\);/);
  assert.match(main, /data-testid="crowdsourcing-status"/);
});

test("D81 : « Réservé aux ADMIN » part (branche morte) ; la prop isAdmin et ses contrôles restent, page.tsx aussi", () => {
  const main = code(MAIN);
  assert.doesNotMatch(main, /Réservé aux ADMIN/);
  assert.match(main, /if \(!isAdmin \|\| !backendReady\) return false;/);
  assert.match(main, /canRun=\{isAdmin\}/);
  const page = code(`${DIR}/page.tsx`);
  assert.match(page, /await requirePage\("admin"\)/);
  assert.match(page, /<CronMonitoringClient isAdmin=\{session\.user\.role === "ADMIN"\} \/>/);
});

test("D82 : « Job #<id> » part du message de lancement et des cartes ; le reste du message ne change pas", () => {
  for (const file of FILES) assert.doesNotMatch(code(file), /Job #/, file);
  const main = code(MAIN);
  assert.ok(main.includes("text: `${data.message} · ${describeCampusCollection(data.collect_campus_attachments)}`"));
  assert.ok(main.includes("text: `${data.message}`"));
  assert.match(main, /type: confirmed \? "success" : "error"/);
});

test("D83 : le bloc « Contributions du public » et la ligne des contributions en attente restent, textes inchangés", () => {
  const main = code(MAIN);
  assert.match(main, /Contributions du public/);
  assert.match(main, /describeCrowdsourcing\(pipelineStatus\?\.scheduler\?\.crowdsourcing\)/);
  assert.match(main, /CROWDSOURCING_TEXT_TONES\[crowdsourcing\.tone\]/);
  const history = code(HISTORY);
  assert.match(history, /describePendingAi\(history\.pending_ai\)/);
  assert.match(history, /\{pending && <Alert tone="info">\{pending\}<\/Alert>\}/);
});

// ─── D84 : la confirmation d'une passe réelle ───────────────────────────────

test("D84 : une passe réelle se confirme dans le dialogue de la charte, texte figé à l'ouverture, focus sur « Annuler »", () => {
  const panel = code(ROTATION);
  assert.doesNotMatch(panel, /window\.confirm|\bconfirm\(/);
  assert.match(panel, /import \{ Dialog, DialogFooter \} from "@\/components\/ui\/Dialog"/);
  // Le texte est pris au clic, puis gardé tel quel (l'écran se rafraîchit toutes les 5 s).
  assert.match(panel, /setConfirming\(confirmText\(status, maxPasses\)\)/);
  const dialog = panel.match(/<Dialog\b[\s\S]*?<\/Dialog>/)?.[0];
  assert.ok(dialog, "le dialogue de confirmation");
  assert.match(dialog, /titleId="rotation-confirm-title"/);
  assert.match(dialog, /<Button data-autofocus onClick=\{closeConfirm\}>\s*Annuler\s*<\/Button>/);
  // La demande ne part que du bouton du dialogue, après sa fermeture.
  assert.match(dialog, /setConfirming\(null\);\s*runDuePasses\(false\);/);
  assert.equal(panel.match(/runDuePasses\(false\)/g)?.length, 1, "un seul départ réel : celui du dialogue");
  assert.match(panel, /onClick=\{\(\) => runDuePasses\(true\)\}/);
  // Le texte de la confirmation, inchangé.
  for (const line of [
    "Elles paient Research (crédits Tavily) et Gemini.",
    "Crédits du mois inconnus : pas d'aperçu.",
    "Aperçu : aucune des passes affichées ne tient sous le plafond.",
    "Le backend recale d'abord les crédits sur Tavily (/usage, jusqu'à 20 s), puis replanifie.",
  ]) {
    assert.ok(panel.includes(line), line);
  }
});

// ─── D85 : les bandeaux du backend ──────────────────────────────────────────

test("D85 : les bandeaux du backend dans Alert : « non lancé » et le poste local en info, les erreurs en danger", () => {
  const main = code(MAIN);
  assert.equal(alertToneOf(main, "Pilotage depuis le poste local."), "info");
  assert.equal(alertToneOf(main, "Backend local non lancé."), "info");
  assert.equal(alertToneOf(main, "Backend injoignable."), "danger");
  assert.equal(alertToneOf(main, "Le backend a démarré avec des erreurs."), "danger");
  assert.match(main, /<code className="[^"]*font-mono[^"]*">\{LOCAL_BACKEND_COMMAND\}<\/code>/);
  // L'avertissement d'une école occupée : un petit texte, sans symbole.
  assert.match(main, /<p className="[^"]*text-warning[^"]*">\s*Une tâche est déjà en cours pour cette école/);
  assert.match(main, /<Alert tone=\{launchMessage\.type === "success" \? "success" : "danger"\}>\{launchMessage\.text\}<\/Alert>/);
});

// ─── D86, D87 : barres et tons ──────────────────────────────────────────────

test("D87 : un ton par état ; D86 : le ton d'une barre d'usage, comme avant", () => {
  assert.deepEqual(JOB_STATUS_TONES, { pending: "neutral", ok: "success", error: "danger" });
  assert.deepEqual(ROTATION_MODE_TONES, { on_demand: "neutral", ceiling_zero: "warning" });
  assert.deepEqual(CROWDSOURCING_TEXT_TONES, {
    muted: "text-ink-2",
    ok: "text-success",
    warning: "text-warning",
    error: "text-danger",
  });
  assert.deepEqual(USAGE_TEXT_TONES, { success: "text-success", warning: "text-warning", danger: "text-danger" });
  // Les seuils d'avant : épuisé (ou ≥ 100 %) danger, ≥ 75 % warning, sinon success.
  assert.equal(usageTone(0, 1000), "success");
  assert.equal(usageTone(749, 1000), "success");
  assert.equal(usageTone(750, 1000), "warning");
  assert.equal(usageTone(999, 1000), "warning");
  assert.equal(usageTone(1000, 1000), "danger");
  assert.equal(usageTone(1200, 1000), "danger");
  assert.equal(usageTone(0, 0), "danger");
});

test("D86, D87 : les tâches en cours, une barre native et des badges neutres, sans pastille ni « Job # »", () => {
  const main = code(MAIN);
  assert.match(main, /import \{ ProgressBar \} from "@\/components\/ui\/ProgressBar"/);
  assert.match(main, /<ProgressBar[^>]*value=\{progress\.done\}[^>]*max=\{progress\.total\}/);
  assert.match(main, /<Badge tone="neutral">\{job\.status === "running" \? "En cours" : "En file"\}<\/Badge>/);
  assert.match(main, /<Badge tone="neutral">En cours<\/Badge>/);
  assert.doesNotMatch(main, /status-dot|dot-running|dot-queued|dot-green|dot-red/);
  // D91 : l'école tronquée des passes dues, gardée.
  assert.ok(main.includes("— École {job.school_id.substring(0, 8)}..."));
});

// ─── Les panneaux, rendus ───────────────────────────────────────────────────

function row(overrides: Partial<PipelineJobRow>): PipelineJobRow {
  return {
    id: "job",
    school_id: "s1",
    school_name: "EMLV",
    phase: "Phase 1 — Cartographie",
    source: "manual",
    status: "completed",
    progress: null,
    error: null,
    started_at: "2026-09-29T13:27:58.991Z",
    updated_at: "2026-09-29T13:33:46.869Z",
    finished_at: "2026-09-29T13:33:46.869Z",
    triggered_by: null,
    ...overrides,
  };
}

test("D90 : l'historique, sept colonnes et le détail sous la ligne, « Détail : » en tête, chaque job dans son TBody", () => {
  const history: PipelineJobsResponse = {
    pending_ai: 0,
    jobs: [
      row({ id: "a", status: "failed", error: `Extraction Gemini indisponible : ${"x".repeat(400)}` }),
      row({ id: "b", status: "running", finished_at: null, progress: { current_action: "Recherche des tarifs" }, triggered_by: "Goat" }),
      row({ id: "c" }),
    ],
  };
  const out = html(h(JobHistory, { history, error: null, now: Date.parse("2026-09-29T14:00:00Z") }));
  const headers = [...out.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(headers, ["Début", "École", "Phase", "Origine", "Lancé par", "Statut", "Durée"]);
  assert.equal(out.match(/<tbody/g)?.length, 3, "un TBody par job");
  // Le détail : sous la ligne, sur toute la largeur ; rien quand il n'y a rien à dire.
  const details = [...out.matchAll(/<td[^>]*colspan="7"[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
  assert.equal(details.length, 2);
  assert.match(details[0], /Détail :/);
  assert.match(details[0], /<span class="[^"]*text-danger[^"]*" title="Extraction Gemini indisponible : x{400}">/);
  assert.match(details[0], /x{10}…<\/span>/);
  assert.match(details[1], /Recherche des tarifs/);
  assert.doesNotMatch(out, />—</, "plus de tiret pour un détail vide");
  // D44 : « non suivi » et sa bulle ; le nom quand il est connu.
  assert.match(out, /<span class="text-ink-2" title="Lancé avant le suivi des lancements[^"]*">non suivi<\/span>/);
  assert.match(out, />Goat</);
  // D87 : un ton par état.
  assert.match(spanClass(out, "échec"), /bg-danger-soft/);
  assert.match(spanClass(out, "en cours"), /bg-surface-2/);
  assert.match(spanClass(out, "terminé"), /bg-success-soft/);
  // Le contenu de l'IA reste du texte.
  assert.doesNotMatch(read(HISTORY), /dangerouslySetInnerHTML/);
});

test("D83, D85 : la ligne des contributions en attente en message « info », l'erreur de l'historique en « danger », sans symbole", () => {
  const pending = html(h(JobHistory, { history: { jobs: [], pending_ai: 2 }, error: null, now: 0 }));
  assert.match(pending, /role="status"[\s\S]*2 contributions attendent le traitement par le backend local\./);
  assert.match(pending, /Aucun job enregistré\./);
  const failed = html(h(JobHistory, { history: null, error: "Historique illisible", now: 0 }));
  assert.match(failed, /role="alert"[\s\S]*>Historique illisible</);
  assert.doesNotMatch(failed, /⚠/);
});

const STATUS: RotationStatus = {
  interval_days: 180,
  monthly_ceiling: 1000,
  month_credits_used: 800,
  due_count: 2,
  next: [
    { school_name: "Em Lyon", phase: "2", reason: "interval", last_pass_at: "2026-04-01T00:00:00Z", estimated_credits: 150 },
    { school_name: "EMLV", phase: "1", reason: "never", last_pass_at: null, estimated_credits: 300 },
  ],
  last_run: { status: "failed", detail: "Quota Tavily épuisé", finished_at: "2026-10-20T10:00:00Z" },
  usage_sync: null,
};

test("D86, D87 : les passes dues, rendues : barre native des crédits nommée, badges d'un ton par état, sans symbole", () => {
  const out = html(h(RotationPanel, { rotation: STATUS, canRun: true }));
  assert.match(out, /<h3 id="rotation-title"[^>]*>Passes dues<\/h3>/);
  assert.match(spanClass(out, "sur demande"), /bg-surface-2/);
  assert.match(spanClass(out, "hors plafond"), /bg-warning-soft/);
  const bars = out.match(/<progress[^>]*>/g) ?? [];
  assert.equal(bars.length, 1);
  assert.match(bars[0], /value="800"/);
  assert.match(bars[0], /max="1000"/);
  assert.match(bars[0], /aria-labelledby="rotation-credits-title"/);
  assert.match(bars[0], /progress-value\]:bg-warning/);
  assert.match(out, /id="rotation-credits-title"[^>]*>Crédits du mois \(estimés\)</);
  // La dernière exécution en échec, sans ❌ ; la synchro manquante en avertissement.
  assert.match(out, /<p class="[^"]*text-danger[^"]*">Quota Tavily épuisé/);
  assert.match(out, /<p class="[^"]*text-warning[^"]*">Crédits du mois non recalés sur Tavily/);
  // Le nombre de passes : « Au plus » nomme la liste ; Simuler et Lancer, sans émoji.
  assert.match(out, /<label[^>]*for="rotation-max-passes"[^>]*>Au plus<\/label>/);
  assert.match(out, /<select[^>]*id="rotation-max-passes"/);
  assert.match(out, /<button type="button"[^>]*>Simuler<\/button>/);
  assert.match(out, /<button type="button"[^>]*>Lancer 1 passe due<\/button>/);
  assert.doesNotMatch(out, /<dialog/, "aucune confirmation avant le clic");
  assert.doesNotMatch(out, /[✓✕⚠✔✖✗❌✅⏳🧪🚀🔄]/u);
});

test("D87 : plafond à 0 en avertissement, sans barre ; un état illisible en danger, sans ⚠", () => {
  const zero = html(h(RotationPanel, { rotation: { ...STATUS, monthly_ceiling: 0 }, canRun: false }));
  assert.match(spanClass(zero, "plafond à 0"), /bg-warning-soft/);
  assert.doesNotMatch(zero, /<progress|hors plafond|Simuler/);
  const broken = html(h(RotationPanel, { rotation: { error: "lecture impossible" } }));
  assert.match(broken, /<p class="[^"]*text-danger[^"]*">État des passes dues illisible : lecture impossible<\/p>/);
});

test("D88 : l'en-tête des quotas Tavily est un bouton natif qui commande un corps caché par hidden, sans animation", () => {
  const out = html(
    h(QuotaTavilyPanel, {
      keys: [
        { id: "ef56", used: 100, total: 1000 },
        { id: "ab12", used: 1000, total: 1000 },
        { id: "cd34", used: 800, total: 1000 },
      ],
    }),
  );
  const button = out.match(/<button[^>]*>/)?.[0] ?? "";
  assert.match(button, /type="button"/);
  assert.match(button, /aria-expanded="false"/);
  const controls = button.match(/aria-controls="([^"]+)"/)?.[1];
  assert.ok(controls, "aria-controls");
  // Le corps : caché par hidden, sans utilitaire d'affichage qui le déferait.
  const escaped = controls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = out.match(new RegExp(`<div id="${escaped}"[^>]*>`))?.[0] ?? "";
  assert.match(body, /hidden=""/);
  assert.doesNotMatch(body, /class="[^"]*\b(flex|grid|inline-flex|block)\b/);
  assert.doesNotMatch(out, /role="button"|transition-\[max-height\]|transition-transform|duration-/);
  // Les textes, sans 🔑 ; le badge des clés épuisées en danger.
  assert.match(out, /Quotas Tavily — 3 clés actives/);
  assert.match(spanClass(out, "1 épuisée"), /bg-danger-soft/);
  assert.match(out, /<strong[^>]*>1100<\/strong> \/ 3000 restants/);
  // Les clés : épuisées d'abord, puis par usage ; barre native et texte au ton de l'usage.
  const keys = [...out.matchAll(/<span class="[^"]*font-mono[^"]*">(\w+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["ab12", "cd34", "ef56"]);
  const bars = [...out.matchAll(/<progress[^>]*>/g)].map((m) => m[0]);
  assert.equal(bars.length, 3);
  assert.match(bars[0], /aria-label="ab12"/);
  assert.match(bars[0], /progress-value\]:bg-danger/);
  assert.match(bars[1], /progress-value\]:bg-warning/);
  assert.match(bars[2], /progress-value\]:bg-success/);
  assert.match(out, /<span class="[^"]*text-danger[^"]*">0 \/ 1000 restants<\/span>/);
  assert.doesNotMatch(out, /🔑/u);
});

// ─── D89 et les champs du lancement ─────────────────────────────────────────

test("D89 : le choix de la phase dit lequel est choisi (aria-pressed), textes inchangés", () => {
  const main = code(MAIN);
  assert.match(main, /aria-pressed=\{selectedPhase === "1"\}[\s\S]*?Phase 1 — Cartographie/);
  assert.match(main, /aria-pressed=\{selectedPhase === "2"\}[\s\S]*?Phase 2 — Enrichissement/);
});

test("D58, D65 : l'école, le programme et les catégories ont un libellé visible et relié ; la case de la collecte, son aide", () => {
  const main = code(MAIN);
  assert.match(main, /<Field id="research-school" label="École">/);
  assert.match(main, /<Field\s+id="research-program"\s+label=\{[\s\S]*?Programme[\s\S]*?\(optionnel — laisser vide pour toute l&apos;école\)/);
  assert.match(main, /<fieldset[^>]*>\s*<legend[^>]*>\s*Catégories à rechercher/);
  assert.match(main, /aria-describedby="research-collect-hint"/);
  assert.match(main, /<p id="research-collect-hint"/);
  assert.doesNotMatch(main, /<label className="form-label"/);
  // D56 : ni 📍 devant le campus, ni émoji devant les catégories.
  assert.match(main, /<optgroup key=\{campus\.id\} label=\{campus\.name\}>/);
  assert.match(
    main,
    /Pricing: "Tarifs",\s*Ranking: "Classements",\s*Capacity: "Places",\s*SchoolStats: "Statistiques école",\s*Accreditation: "Accréditations",/,
  );
});

// ─── D56, D78 : ni émoji ni symbole ; l'ancien style parti ──────────────────

test("D56, D78 : aucun ✓, ✕, ⚠, ⏱ dans l'écran, et les textes restent sans leur symbole", () => {
  for (const file of FILES) assert.doesNotMatch(code(file), /[✓✕⚠✔✖✗❌✅⏱]/u, file);
  const main = code(MAIN);
  for (const text of [
    'title="Pipeline de recherche"',
    "Rafraîchir",
    "Pilotage depuis le poste local.",
    "Backend local non lancé.",
    "Backend injoignable.",
    "Le backend a démarré avec des erreurs.",
    "Tâches manuelles en cours (",
    "Passes dues en cours (",
    "Aucune tâche manuelle en cours d&apos;exécution.",
    "Aucune passe due en cours d&apos;exécution.",
    "État du Pipeline IA",
    "Quotas Tavily restants",
    "Lancer une Recherche Manuelle",
    '"Lancement en cours..."',
    '"Lancer la cartographie"',
    '"Lancer la recherche"',
    "{formatElapsed(elapsed)}",
  ]) {
    assert.ok(main.includes(text), text);
  }
});

test("charte : plus de styled-jsx, de style en ligne ni de lien dans l'écran ; le contenu de l'IA reste du texte", () => {
  for (const file of FILES) {
    const source = read(file);
    assert.doesNotMatch(source, /<style\b/, file);
    assert.doesNotMatch(source, /style=\{\{/, file);
    assert.doesNotMatch(source, /dangerouslySetInnerHTML|<a\b/, file);
  }
  assert.match(code(MAIN), /import \{ AdminPage \} from "@\/components\/layout\/AdminPage"/);
});
