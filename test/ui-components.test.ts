/**
 * test/ui-components.test.ts — Les composants de la charte (étape 4 du plan gestion-contenu)
 *
 *     npm run test:ts
 *
 * Ce que l'accessibilité de la charte promet (docs/architecture/charte-graphique.md
 * §6 et §8), vérifié sur le HTML rendu par React côté serveur
 * (`renderToStaticMarkup`, sans navigateur) : libellés reliés, erreurs
 * annoncées, onglets au modèle ARIA, dialogue nommé, bouton qui n'envoie pas
 * un formulaire par mégarde. Les comportements qui demandent un navigateur
 * (focus gardé par `showModal()`) relèvent du contrôle visuel.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminPage } from "../components/layout/AdminPage";
import { AuthShell } from "../components/layout/AuthShell";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Button, buttonClasses } from "../components/ui/Button";
import { Card, CardHeader } from "../components/ui/Card";
import { cx } from "../components/ui/cx";
import { Dialog, DialogFooter } from "../components/ui/Dialog";
import { Field, Input, Select, type ControlProps } from "../components/ui/Field";
import { TBody, THead, Table, Td, Th, Tr } from "../components/ui/Table";
import { TabPanel, Tabs } from "../components/ui/Tabs";
import { nextTabIndex, panelId, tabId } from "../components/ui/tabs-keys";

const html = (element: ReactElement) => renderToStaticMarkup(element);
const input = (control: ControlProps) => h(Input, { ...control, type: "email" });

// ─── Champ ──────────────────────────────────────────────────────────────────

test("Field : le libellé désigne le contrôle, et rien d'autre n'est relié sans aide ni erreur", () => {
  const out = html(h(Field, { id: "users-email", label: "Adresse e-mail de travail", children: input }));
  assert.match(out, /<label[^>]*for="users-email"[^>]*>Adresse e-mail de travail<\/label>/);
  assert.match(out, /<input[^>]*id="users-email"/);
  assert.doesNotMatch(out, /aria-describedby|aria-invalid/);
});

test("Field : l'aide puis l'erreur sont reliées au contrôle, qui se dit invalide", () => {
  const out = html(
    h(Field, {
      id: "users-email",
      label: "Adresse e-mail de travail",
      hint: "Seules les adresses @em-normandie.fr sont acceptées.",
      error: "Adresse refusée.",
      children: input,
    }),
  );
  assert.match(out, /<input[^>]*aria-describedby="users-email-hint users-email-error"/);
  assert.match(out, /<input[^>]*aria-invalid="true"/);
  assert.match(out, /<p id="users-email-hint"[^>]*>Seules les adresses @em-normandie\.fr sont acceptées\.<\/p>/);
  assert.match(out, /<p id="users-email-error"[^>]*>Adresse refusée\.<\/p>/);
});

test("Field : une aide seule, sans erreur, n'invalide pas le champ", () => {
  const out = html(h(Field, { id: "login", label: "Adresse e-mail", hint: "Ancien identifiant accepté.", children: input }));
  assert.match(out, /aria-describedby="login-hint"/);
  assert.doesNotMatch(out, /aria-invalid/);
});

test("Select : un <select> natif, avec ses options, la flèche cachée aux lecteurs d'écran", () => {
  const out = html(h(Select, { id: "users-role", defaultValue: "USER" }, h("option", { value: "USER" }, "Utilisateur")));
  assert.match(out, /<select[^>]*id="users-role"/);
  assert.match(out, /<option value="USER"[^>]*>Utilisateur<\/option>/);
  assert.match(out, /<svg aria-hidden="true"/);
});

// ─── Bouton ─────────────────────────────────────────────────────────────────

test("Button : n'envoie pas un formulaire, sauf type=\"submit\" demandé", () => {
  assert.match(html(h(Button, null, "Annuler")), /^<button type="button"/);
  assert.match(html(h(Button, { type: "submit", variant: "primary" }, "Se connecter")), /^<button type="submit"/);
  assert.match(html(h(Button, { disabled: true }, "En cours…")), /disabled=""/);
});

test("Button : chaque variante a ses couleurs, la classe de l'appelant vient en dernier", () => {
  assert.match(buttonClasses({ variant: "primary" }), /\bbg-accent\b.*\btext-accent-ink\b/);
  assert.match(buttonClasses({ variant: "danger" }), /\bbg-danger\b.*\btext-danger-ink\b/);
  assert.match(buttonClasses({ variant: "danger-soft" }), /\bbg-danger-soft\b/);
  assert.match(buttonClasses(), /\bbg-surface\b/, "secondaire par défaut");
  assert.match(buttonClasses(), /\bborder-line-strong\b/, "secondaire par défaut");
  assert.match(buttonClasses({ size: "sm" }), /\bh-7\b/);
  assert.ok(buttonClasses({ className: "ml-2" }).endsWith(" ml-2"));
  assert.match(buttonClasses(), /focus-visible:outline-focus/);
});

test("cx : ignore les valeurs fausses", () => {
  assert.equal(cx("a", false, null, undefined, "", "b"), "a b");
});

// ─── Message, badge, carte ──────────────────────────────────────────────────

test("Alert : une erreur est annoncée tout de suite, une réussite ou une information attend", () => {
  assert.match(html(h(Alert, { tone: "danger", children: "Adresse e-mail ou mot de passe incorrect." })), /^<div role="alert"/);
  assert.match(html(h(Alert, { tone: "success", children: "Rôle mis à jour." })), /^<div role="status"/);
  assert.match(html(h(Alert, { children: "Information." })), /^<div role="status"/);
  assert.match(html(h(Alert, { tone: "danger", children: "x" })), /<svg aria-hidden="true"/);
});

test("Badge : le ton choisit les couleurs, le texte dit l'état", () => {
  const out = html(h(Badge, { tone: "success", children: "Actif" }));
  assert.match(out, /bg-success-soft/);
  assert.match(out, />Actif<\/span>$/);
  assert.match(html(h(Badge, { children: "Utilisateur" })), /bg-surface-2/, "neutre par défaut");
});

test("Badge : un texte long passe à la ligne s'il le demande (étape 9, le concours d'un programme)", () => {
  // Une classe entière : `h-6` ne doit pas se lire dans `min-h-6`.
  const has = (out: string, name: string) => new RegExp(`class="(?:[^"]* )?${name}(?: [^"]*)?"`).test(out);
  const short = html(h(Badge, { children: "Bac+5" }));
  assert.ok(has(short, "h-6") && has(short, "whitespace-nowrap") && has(short, "rounded-full"));
  const long = html(h(Badge, { wrap: true, children: "Admission par le concours SESAME ou une procédure propre aux candidats internationaux" }));
  for (const name of ["whitespace-nowrap", "h-6", "rounded-full"]) {
    assert.equal(has(long, name), false, `${name} : ni hauteur fixe, ni texte sur une ligne, ni pilule étirée`);
  }
  assert.match(long, /\bmin-h-6\b/);
  assert.match(long, /\brounded-control\b/);
});

test("Card et CardHeader : un titre h2, relié par son identifiant", () => {
  const out = html(h(Card, { "aria-labelledby": "t" }, h(CardHeader, { title: "Mot de passe", titleId: "t" })));
  assert.match(out, /^<section[^>]*aria-labelledby="t"/);
  assert.match(out, /<h2 id="t"[^>]*>Mot de passe<\/h2>/);
});

// ─── Tableau ────────────────────────────────────────────────────────────────

test("Table : nommé pour les lecteurs d'écran, en-têtes de colonne, nombres alignés", () => {
  const out = html(
    h(Table, {
      caption: "Les comptes",
      children: [
        h(THead, { key: "h" }, h(Tr, null, h(Th, null, "Compte"), h(Th, { align: "right" }, "Actions"))),
        h(TBody, { key: "b" }, h(Tr, null, h(Td, { numeric: true }, "13 750 €"), h(Td, { numeric: true, align: "left" }, "16/10/2026"))),
      ],
    }),
  );
  assert.match(out, /<caption class="sr-only">Les comptes<\/caption>/);
  assert.match(out, /<th scope="col" class="[^"]*text-left[^"]*">Compte<\/th>/);
  assert.match(out, /<th scope="col" class="[^"]*text-right[^"]*">Actions<\/th>/);
  assert.match(out, /<td class="[^"]*font-mono tabular-nums text-right[^"]*">13 750 €<\/td>/);
  assert.match(out, /<td class="[^"]*font-mono tabular-nums text-left[^"]*">16\/10\/2026<\/td>/);
  assert.match(out, /^<div class="overflow-x-auto/, "le tableau défile dans son cadre, pas la page");
  assert.doesNotMatch(out, /<table[^>]* id=/, "pas d'identifiant sans demande");
});

test("Table : l'identifiant demandé va au <table>, pas à son cadre (étape 9 : id=\"pricing-table\" gardé)", () => {
  const out = html(h(Table, { id: "pricing-table", children: h(TBody, null, h(Tr, null, h(Td, null, "2026"))) }));
  assert.match(out, /<table id="pricing-table"/);
  assert.match(out, /^<div class="overflow-x-auto[^"]*">/);
});

// ─── Onglets ────────────────────────────────────────────────────────────────

test("nextTabIndex : flèches en boucle, Début, Fin, autres touches ignorées", () => {
  assert.equal(nextTabIndex(0, "ArrowRight", 3), 1);
  assert.equal(nextTabIndex(2, "ArrowRight", 3), 0);
  assert.equal(nextTabIndex(0, "ArrowLeft", 3), 2);
  assert.equal(nextTabIndex(1, "Home", 3), 0);
  assert.equal(nextTabIndex(0, "End", 3), 2);
  assert.equal(nextTabIndex(1, "Enter", 3), null);
  assert.equal(nextTabIndex(0, "ArrowRight", 0), null);
});

test("Tabs et TabPanel : un seul onglet dans l'ordre de tabulation, chacun commande son panneau", () => {
  const out = html(
    h(
      "div",
      null,
      h(Tabs, {
        label: "Sections de la fiche",
        idPrefix: "fiche",
        value: "programs",
        onValueChange: () => {},
        items: [
          { value: "programs", label: "Programmes", count: 15 },
          { value: "stats", label: "Statistiques" },
        ],
      }),
      h(TabPanel, { idPrefix: "fiche", value: "programs", selected: true, children: "liste" }),
      h(TabPanel, { idPrefix: "fiche", value: "stats", selected: false, children: "chiffres" }),
    ),
  );
  assert.match(out, /<div role="tablist" aria-label="Sections de la fiche"/);
  const tabs = [...out.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
  assert.equal(tabs.length, 2);
  assert.match(tabs[0], new RegExp(`id="${tabId("fiche", "programs")}"`));
  assert.match(tabs[0], new RegExp(`aria-controls="${panelId("fiche", "programs")}"`));
  assert.match(tabs[0], /aria-selected="true"/);
  assert.match(tabs[0], /tabindex="0"/);
  assert.match(tabs[1], /aria-selected="false"/);
  assert.match(tabs[1], /tabindex="-1"/);
  assert.match(out, />15<\/span>/, "le compteur s'affiche");
  assert.match(out, new RegExp(`<div role="tabpanel" id="${panelId("fiche", "programs")}" aria-labelledby="${tabId("fiche", "programs")}" tabindex="0"`));
  assert.match(out, new RegExp(`<div role="tabpanel" id="${panelId("fiche", "stats")}"[^>]*hidden=""`));
});

test("TabPanel : un panneau caché ne prend pas la mise en page de l'appelant, qui défairait `hidden`", () => {
  // Sans preflight (piège 10), `hidden` ne tient que par la feuille du
  // navigateur : un utilitaire `flex` l'emporte et montre le panneau (relevé à
  // l'étape 9, sur la fiche école).
  const shown = html(h(TabPanel, { idPrefix: "fiche", value: "stats", selected: true, className: "flex flex-col gap-3", children: "x" }));
  assert.match(shown, /class="pt-5 flex flex-col gap-3"/);
  const hidden = html(h(TabPanel, { idPrefix: "fiche", value: "stats", selected: false, className: "flex flex-col gap-3", children: "x" }));
  assert.match(hidden, /hidden=""/);
  assert.doesNotMatch(hidden, /\bflex\b/);
});

// ─── Dialogue ───────────────────────────────────────────────────────────────

test("Dialog : un <dialog> nommé par son titre, un bouton « Fermer » qui n'envoie rien", () => {
  const out = html(
    h(Dialog, {
      title: "Désactiver ce compte ?",
      titleId: "users-dialog-title",
      onClose: () => {},
      children: h(DialogFooter, { children: h(Button, null, "Annuler") }),
    }),
  );
  assert.match(out, /^<dialog aria-labelledby="users-dialog-title"/);
  assert.doesNotMatch(out, /<dialog[^>]* open/, "fermé tant que showModal() ne l'a pas ouvert");
  assert.match(out, /<h2 id="users-dialog-title"[^>]*>Désactiver ce compte \?<\/h2>/);
  assert.match(out, /<button type="button" aria-label="Fermer"/);
});

// ─── Gabarits ───────────────────────────────────────────────────────────────

test("AuthShell et AdminPage : la racine porte la classe charte, et un seul h1", () => {
  const auth = html(h(AuthShell, { title: "Première connexion", subtitle: "Votre adresse…", footer: "Déjà un mot de passe ?", children: "formulaire" }));
  assert.match(auth, /^<main class="charte /);
  assert.equal(auth.match(/<h1/g)?.length, 1);
  const admin = html(h(AdminPage, { title: "Comptes", description: "Ajoutez…", actions: h(Button, null, "Ajouter"), children: "tableau" }));
  assert.match(admin, /^<div class="charte /);
  assert.equal(admin.match(/<h1/g)?.length, 1);
});

test("AdminPage : sans lien de retour ni badge, l'en-tête de l'étape 4 ; avec, le lien au-dessus et le badge hors du titre (étape 9)", () => {
  // Sans les deux emplacements : l'en-tête est le premier enfant, le titre le
  // premier élément de sa colonne, comme pour « Comptes » et « Signalements ».
  const plain = html(h(AdminPage, { title: "Comptes", children: "x" }));
  assert.match(plain, /^<div class="charte [^"]*"><header [^>]*><div [^>]*><h1 [^>]*>Comptes<\/h1>/);
  assert.doesNotMatch(plain, /<a /);

  const full = html(
    h(AdminPage, {
      title: "Em Normandie",
      back: { href: "/admin/schools", label: "← Retour à la liste des écoles" },
      badge: h(Badge, { tone: "success", children: "ACTIVE" }),
      children: "x",
    }),
  );
  assert.match(full, /^<div class="charte [^"]*"><div [^>]*><a [^>]*href="\/admin\/schools"[^>]*>← Retour à la liste des écoles<\/a><header /, "le lien avant l'en-tête");
  assert.match(full, /<h1 [^>]*>Em Normandie<\/h1><span [^>]*>ACTIVE<\/span>/, "le badge à côté du titre, pas dedans");
  assert.equal(full.match(/<h1/g)?.length, 1);
});
