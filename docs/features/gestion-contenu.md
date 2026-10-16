# Chantier — Le gestionnaire de contenu en ligne

> **Statut :** plan rédigé le 16 octobre 2026, à partir du plan d'évolution de
> l'équipe (réunion du 16 octobre) et des réponses du propriétaire le même
> jour. Étape 0 (recentrage : branche, documentation) faite le 16 octobre ;
> le propriétaire demande le commit, le push et le prompt de l'étape 1 :
> étape 0 tenue pour validée. Étape 1 (trois rôles, gardes, connexion
> obligatoire) faite le 16 octobre, décisions D1, D2, D18 et D19 prises,
> migration appliquée sur la branche Neon `dev` ; le propriétaire demande le
> commit, le push et le prompt de l'étape 2 : étape 1 tenue pour validée.
> **Prochaine : étape 2.**
> **Branche de travail :** `gestion`, créée le 16 octobre 2026 depuis
> `localpython` (`423631e`) à la demande du propriétaire.
> **Source :** le doc « Plan d'évolution – School Data Pipeline » du
> propriétaire (<https://claude.ai/code/artifact/67c2927d-46b9-40cd-b9aa-94792f55642d>),
> et le doc « Données stockées sur les écoles »
> (<https://claude.ai/code/artifact/c898ac5d-5263-419c-af99-7932267be8b6>).
> **Lire avant de coder :** ce document en entier, puis
> [`architecture/gestion-contenu.md`](../architecture/gestion-contenu.md)
> (l'état du code du gestionnaire de contenu), et `AGENTS.md` à la racine
> (Next.js 16 : lire `node_modules/next/dist/docs/` avant de toucher au front).

---

## 0. Mode d'emploi pour un agent

- Les étapes se font **dans l'ordre** du §5.
- **Une étape par session, puis arrêt.** À la fin d'une étape :
  1. faire le compte rendu au propriétaire : ce qui est fait, les tests, les
     écarts au plan, ce qui attend sa décision ;
  2. compléter le [journal](#9-journal-de-progression) ;
  3. **attendre sa validation explicite.** Ne jamais enchaîner sur l'étape
     suivante, même si elle paraît simple.

  Pour savoir où reprendre, lire le journal (§9) et les cases cochées.
- **Les décisions marquées « à trancher » (§2.2) se posent au propriétaire au
  début de leur étape**, avec deux options et une recommandation, avant
  d'écrire du code. La réponse va au journal, et le §2.2 est mis à jour.
- Une case ne se coche `[x]` que lorsque le code est écrit **et** que ses tests
  passent (`npm test`, `npm run test:ts`, `npm run typecheck`, `npm run lint`).
- **Tests d'abord** pour toute garde d'accès et toute règle de rôle : écrire le
  test qui montre l'accès indu, le voir échouer, puis corriger.
- **Un test qui échoue ne se désactive pas et ne s'affaiblit pas.** Quand le
  propriétaire change une règle, l'attendu d'un test change avec elle : le
  journal nomme la décision et le test touché. Un test supprimé parce que la
  fonction disparaît (ex. `/contribute`) est listé au journal.
- **Documentation au fil de l'eau** : chaque étape liste les docs à mettre à
  jour, à la fin de l'étape, pour décrire ce que le code fait réellement. En
  premier lieu [`architecture/gestion-contenu.md`](../architecture/gestion-contenu.md).
- Ne commiter et ne pousser que si le propriétaire le demande. Un commit par
  étape, message en français au format du dépôt (`feat(auth): …`).

**Interdits, sans exception** (repris de `CLAUDE.md`) :

- Lire, afficher, journaliser ou commiter un fichier `.env*` (seul
  `.env.example` est lisible) ; afficher une URL de connexion ou un mot de passe.
- `prisma db push`, `prisma migrate dev`, `prisma migrate reset`,
  `prisma db seed` sur la base partagée.
- Modifier un `migration.sql` déjà appliqué, même un commentaire.
- Tout appel payant (Tavily, Gemini, Gemma) ; lancer le backend
  (`uvicorn`, `npm run backend`, `npm run local`) sans l'accord du propriétaire.
- Poser `DB_DRIVER` sur Vercel ; écrire une variable Vercel.

**Migrations.** Ce plan en demande plusieurs (étapes 1, 2, 5, 6, 7, 8). Chacune :

1. s'écrit **à la main** dans un nouveau dossier `prisma/migrations/<horodatage>_<nom>/`,
   avec le `schema.prisma` mis à jour dans le même commit (voir
   [`bdd.md`](../architecture/bdd.md) §4 : `prisma migrate diff` a déjà produit
   une migration destructrice) ;
2. est **additive** autant que possible ; toute colonne ajoutée à une table que
   le backend Python écrit (`PipelineJob`, `ContributionInbox`) accepte le vide
   ou a une valeur par défaut ;
3. se joue d'abord à blanc (`npm run db:migrate:dry`), puis sur la branche Neon
   `dev` (`npm run db:migrate`), **avec l'accord du propriétaire à chaque fois** ;
4. part en production au moment de la fusion dans `main` (étape 3, puis à chaque
   version), avant elle : la CI bloque une PR vers `main` tant que
   `prisma migrate status` voit une migration en attente.

**La partie IA est gelée** (§6). On ne modifie ni `backend/`, ni les écrans et
routes IA, sauf ce qu'une étape du plan demande explicitement (masquer,
historique des lancements, messages). Les tests Python restent dans la CI et
doivent rester verts : ils protègent le backend gelé, qui partage la base.

---

## 1. Pourquoi

Réunion de l'équipe du 16 octobre 2026. La suite servira surtout de
**gestionnaire de contenu**, beaucoup moins d'outil de recherche IA :

- la recherche IA n'est pas pérennisable (elle tourne sur le poste de l'admin,
  coûte des crédits, demande une recette lourde) : on la garde telle qu'elle
  est, sans plus y investir, réservée à l'admin ;
- le back-office de gestion de contenu doit être **utilisable en ligne**, sur
  Vercel, par des collègues : il ne dépend déjà plus du backend Python (seules
  trois routes IA l'appellent) ;
- les données des écoles **ne sont plus 100 % publiques** : connexion
  obligatoire, sur une liste blanche d'e-mails ;
- l'idée de contribution du public est abandonnée, remplacée par un
  **formulaire de signalement** sans IA ;
- la charte graphique est refaite entièrement, back-office compris.

---

## 2. Décisions

### 2.1. Prises le 16 octobre 2026

| # | Décision | Par qui |
|---|---|---|
| G1 | **IA gelée.** Code conservé tel quel ; ni développement ni recette ; réservée à l'admin. La recette de bout en bout de `backend-local.md` est abandonnée (étape 9 de ce plan non cochée). Les tests Python restent dans la CI comme filet | propriétaire |
| G2 | **Branche `gestion`**, depuis `localpython` (`423631e`). `localpython` est gardée en l'état | propriétaire |
| G3 | **Production Vercel = `main`**, rattrapée sur `gestion` à chaque version validée (PR, CI verte). Les préversions se font sur `gestion` (réglage : [mémo Vercel](../memory/memory-deploiement-vercel.md) §8.2) | propriétaire |
| G4 | **Trois rôles.** `USER` : toute personne qui se connecte ; consulte et signale. `GESTIONNAIRE` : les anciens `MODERATOR` ; ajoute, modifie et supprime le contenu. `ADMIN` : gère la liste blanche et les rôles des utilisateurs et gestionnaires ; seul à utiliser l'IA | propriétaire |
| G5 | **Liste blanche, sans envoi d'e-mail, par confiance.** L'admin ajoute les e-mails de travail des collègues (tous en `@em-normandie.fr`). Tant que la personne ne s'est pas connectée, l'admin peut la retirer. À sa première connexion, elle saisit son e-mail et choisit son mot de passe : elle devient `USER` | propriétaire |
| G6 | **API v1 et `/api-docs` derrière la connexion.** Des clés d'API pourront s'ajouter plus tard si un usage externe apparaît | propriétaire |
| G7 | **Refonte graphique en deux temps.** La charte et les composants de base tôt (étape 4), toutes les nouveautés construites avec, puis une reprise finale des écrans restants (étape 9). **Tailwind CSS v4.** Maquettes proposées après l'authentification ; le propriétaire choisit | propriétaire |
| G8 | **Contribution abandonnée**, remplacée par un formulaire de signalement sans IA | équipe |
| G9 | **La production n'ouvre qu'avec la connexion obligatoire** (étape 3, après les étapes 1 et 2) : sinon les données restent publiques dans l'intervalle | recommandation de l'agent, ordre accepté |

**Retenus par défaut le 16 octobre** (annoncés au propriétaire « sauf avis
contraire », non contestés) :

- un admin peut nommer un autre admin ; **le dernier admin ne peut ni se
  rétrograder ni se supprimer** ;
- les **tickets IA de l'inbox** ne sont visibles et validables que par les
  admins ; les gestionnaires y voient les signalements (étape 6) ;
- les comptes `MODERATOR` existants deviennent `GESTIONNAIRE` par migration de
  données ;
- toute colonne ajoutée à une table écrite par le backend gelé accepte le vide
  ou a une valeur par défaut.

**Risque résiduel accepté (G5).** Sans preuve de possession de l'adresse, une
personne qui connaît l'e-mail d'un collègue inscrit sur la liste mais pas
encore connecté peut se connecter avant lui et choisir le mot de passe. Parade
disponible si besoin, sans envoi d'e-mail : un **code d'invitation** affiché à
l'admin quand il ajoute l'e-mail, à transmettre de vive voix ou par Teams, exigé
à la première connexion. Non retenue le 16 octobre.

### 2.2. À trancher au début de leur étape

Chaque ligne donne la recommandation de l'agent ; le propriétaire tranche.

| # | Étape | Question | Recommandation |
|---|---|---|---|
| D1 | 1 | Le rôle est figé dans le jeton JWT pour 8 h : un changement de rôle ne prend effet qu'à la reconnexion | **Tranché le 16 octobre (recommandation retenue)** : les gardes et le layout admin **relisent le rôle en base** à chaque requête (un compte supprimé n'y passe plus) ; le proxy ne vérifie que l'existence d'une session. Reste accepté : un compte supprimé garde la lecture du site et de l'API jusqu'à l'expiration de son jeton (8 h au plus) |
| D2 | 1 | Sort de `/contribute` et `/api/contribute` (contribution abandonnée) | **Tranché le 16 octobre (recommandation retenue)** : **retirer** la page, la route et les liens dès l'étape 1 (l'historique Git les garde) ; `lib/contribution.ts` reste, l'inbox l'utilise |
| D18 | 1 | L'écran actuel des comptes crée tout compte en `MODERATOR`, que la nouvelle contrainte refuse | **Tranché le 16 octobre (recommandation retenue)** : il crée des `GESTIONNAIRE`, écrit explicitement dans la route (pas le défaut `USER` de la base), jusqu'à ce que l'étape 2 le remplace ; aucun compte `USER` ne se crée avant l'étape 2 |
| D19 | 1 | Créer une école, supprimer une école, un campus ou un programme étaient réservés à `ADMIN` ; G4 confie au gestionnaire « ajoute, modifie et supprime le contenu » | **Tranché le 16 octobre (recommandation retenue)** : ces quatre écritures passent en `guardManager`, comme toutes les écritures de contenu ; la suppression d'une école garde sa confirmation par saisie du nom |
| D3 | 2 | Les comptes existants n'ont qu'un identifiant, pas d'e-mail | L'admin renseigne l'e-mail des comptes existants depuis le nouvel écran ; pendant la transition la connexion accepte l'e-mail ou l'ancien identifiant ; l'identifiant cesse de servir à la connexion à la fin de l'étape |
| D4 | 2 | Mot de passe oublié, sans envoi d'e-mail | L'admin **remet le compte en « première connexion »** (mot de passe effacé) ; la personne en choisit un nouveau, sur le même modèle de confiance que G5 |
| D5 | 2 | Domaine `@em-normandie.fr` : imposé par le code ou liste libre | **Imposé** par une constante du code, testée ; l'élargir est une décision du propriétaire |
| D6 | 2 | Le nom affiché (étape 5 : « modifié par ») : les comptes n'ont qu'un e-mail | Demander **prénom et nom à la première connexion**, préremplis depuis `prenom.nom@…`, modifiables |
| D7 | 3 | L'offre Hobby est réservée à un usage personnel non commercial ; le mémo Vercel (§6) note « usage non commercial, accepté par le propriétaire », mais l'outil devient un outil d'équipe | À revoir par le propriétaire avant d'y faire entrer l'équipe |
| D8 | 4 | Bibliothèque de composants : shadcn/ui (Radix + Tailwind, copiés dans le dépôt) ou composants maison | À décider avec les maquettes ; shadcn/ui si la maquette choisie s'y prête (formulaires, dialogues, tableaux accessibles déjà faits) |
| D9 | 4 | Thème clair, sombre ou les deux (le site actuel est sombre seulement) | À décider avec les maquettes |
| D10 | 5 | Traçabilité : colonnes « dernière modification » ou historique complet des modifications | **Colonnes** `updated_by_id` et `updated_at` sur chaque table de données ; un historique complet plus tard, si l'équipe le demande |
| D11 | 5 | Données validées depuis un ticket IA : qui est l'auteur affiché | Le **validateur** (un admin), avec une mention de l'origine (saisie, recherche IA, signalement) |
| D12 | 5 | Où ajouter un lien source | Chiffres clés et accréditations (absents aujourd'hui), puis fiche programme ; les tarifs, places, classements et rattachements en ont déjà un |
| D13 | 6 | Stockage des signalements | **Nouvelle table**, pas `ContributionInbox` : le traitement IA gelé lit les tickets `Pending_AI` de l'inbox, et un mélange finirait en appel payant |
| D14 | 7 | Qui écrit « lancé par » sur `PipelineJob` | **Next.js**, après la réponse du backend (qui rend l'id du job) : aucune modification du backend gelé |
| D15 | 8 | Les événements des écoles (JPO, salons…) : à confirmer par l'équipe (« point d'interrogation à lever »), puis le modèle | Une table `SchoolEvent` : type, titre, dates, campus facultatif, lien source |
| D16 | 8 | L'année d'entrée d'un programme et le diplôme requis | Une **table fille** (`ProgramEntry` : année d'entrée, diplôme requis, voie) : un programme a souvent plusieurs entrées (post-bac en 1re année, Bac+2 en 3e année) |
| D17 | 9 | Effort de raisonnement réduit pour la reprise graphique, mécanique (`CLAUDE.md` impose extra high partout) | Décision du propriétaire |

---

## 3. État des lieux au 16 octobre 2026

Détail : [`architecture/gestion-contenu.md`](../architecture/gestion-contenu.md).

- **Le gestionnaire de contenu existe déjà dans Next.js** :
  `/admin/schools`, `/admin/schools/[id]/manage` (7 onglets : infos, campus et
  programmes, tarifs, places, classements, chiffres clés, accréditations),
  `/admin/schools/[id]/campuses`, et les routes `app/api/admin/*` qui écrivent
  par Prisma. Seules trois routes appellent le backend Python, toutes IA :
  `trigger-research`, `run-due-passes`, `pipeline-status`.
- **Authentification** : NextAuth v4, identifiant et mot de passe (bcrypt),
  session JWT de 8 h. Deux rôles, `ADMIN` et `MODERATOR` (chaîne libre en base,
  bornée par une contrainte `CHECK`). Pas d'e-mail sur `User`.
- **Accès** : le proxy (`proxy.ts`) n'exige une session que sur `/admin/*`.
  Les pages publiques, `/api/schools/*`, `/api/v1/*` et `/api-docs` sont
  ouvertes (l'API v1 est seulement plafonnée en débit).
- **Gardes** : 38 méthodes du back-office sont en `guardAuth` (toute session),
  dont toutes les écritures de contenu et la validation de l'inbox ;
  10 en `guardAdmin`.
- **Traçabilité** : aucune table ne sait qui a modifié quoi. Lien source
  présent sur les tarifs, places, classements et rattachements ; absent des
  chiffres clés, des accréditations, des fiches école, campus et programme.
- **Style** : pas de Tailwind ; `app/globals.css` (1 833 lignes, thème sombre,
  21 variables), environ 1 000 `className` sur 28 fichiers.
- **Tests au départ** (relevé du 15 octobre, `423631e`, inchangé depuis) :
  722 tests Python (+25 sous-tests), 542 TypeScript, `typecheck` propre, `lint`
  0 erreur et 109 avertissements.

---

## 4. Pièges connus

1. **`guardAuth` veut dire « toute session ».** Le jour où un compte `USER`
   existe, il peut écrire partout. Les gardes changent **avant** la première
   création d'un compte `USER`, dans l'étape 1, tests d'abord. Aucun compte
   `USER` ne se crée avant que l'étape 1 soit verte.
2. **Le layout `/admin` laisse entrer toute session**, et le proxy aussi
   (`authorized: ({ token }) => !!token`). Un `USER` ne doit pas voir
   `/admin` : le contrôle de rôle se fait côté serveur, pas seulement en
   masquant des liens.
3. **Le rôle vit dans le jeton** pendant 8 h (D1).
4. **Pages publiques en cache ISR d'une heure** (`revalidate = 3600`) : une
   modification n'apparaît qu'au plus une heure plus tard. Le proxy passe avant
   le cache, donc le mur de connexion tient ; mais l'affichage « modifié par »
   (étape 5) sera en retard d'autant, sauf revalidation à l'écriture.
5. **Le backend gelé partage la base.** Il écrit `PipelineJob` et
   `ContributionInbox`, et lit les tables de données (diff de la Phase 2).
   Renommer ou supprimer une colonne qu'il lit le casse sans bruit : ses tests
   le diront, à condition de les lancer (`npm test`).
6. **Lancer le backend paie** dès qu'un ticket `Pending_AI` existe (règle 7 de
   `CLAUDE.md`). Rien dans ce plan ne doit créer de ticket `Pending_AI` (D13).
7. **La contrainte `CHECK` sur `User.role`** (migration
   `20260902120000_inbox_relations_and_enum_guards`) refuse tout rôle hors
   `ADMIN` et `MODERATOR` : la remplacer par une nouvelle migration, sans
   toucher l'ancienne.
8. **Le banc de tests relit chaque requête du faux Prisma contre le vrai
   schéma** (`test/helpers/prisma-schema.ts`) : une colonne ajoutée au code sans
   l'être au schéma fait échouer les tests. C'est voulu.
9. **`/api-docs` et les titres de page sont verrouillés par des tests**
   (`test/api-docs.test.ts`, `test/page-titles.test.ts`) : toute route v1
   modifiée met `/api-docs` à jour dans le même commit.
10. **Tailwind et son « preflight ».** La remise à zéro des styles de base de
    Tailwind casserait les écrans actuels. Pendant la transition, importer
    Tailwind **sans preflight** ; l'activer à l'étape 9, quand l'ancien
    `globals.css` disparaît. La CSP (`style-src 'self' 'unsafe-inline'`) ne
    bloque pas : Tailwind produit un fichier CSS statique au build.
11. **CI.** `prisma migrate status` bloque sur `main` et sur les PR vers `main`,
    pas sur `gestion`. Le déclencheur `pull_request` vise `[main, devresearch]` :
    `devresearch` est une branche ancienne.

---

## 5. Étapes

### Étape 0 — Recentrer le dépôt sur la gestion de contenu ✅ (16 octobre)

- [x] Branche `gestion` créée depuis `localpython` (`423631e`).
- [x] Ce plan.
- [x] [`architecture/gestion-contenu.md`](../architecture/gestion-contenu.md) :
  l'état réel du code du gestionnaire de contenu.
- [x] [`docs/README.md`](../README.md) : l'index de la documentation, en deux
  parties (gestion de contenu, IA gelée).
- [x] `CLAUDE.md` réécrit autour de ce plan ; l'historique du chantier IA
  renvoie au journal de `backend-local.md`.
- [x] `backend-local.md` marqué gelé ; en-têtes du cahier des charges, de
  `architecture.md`, du README et du mémo Vercel.
- [x] Validation du propriétaire (16 octobre : commit, push et prompt de
  l'étape 1 demandés).

Aucun code modifié : pas de suite de tests à rejouer.

### Étape 1 — Trois rôles, des gardes qui disent vrai, la connexion obligatoire ✅ (16 octobre)

**Tranchées :** D1, D2, et deux questions nées du code, D18 et D19 (§2.2).

- [x] Tests d'abord : pour chaque route du back-office, un test par rôle
  (`USER`, `GESTIONNAIRE`, `ADMIN`, sans session) qui fixe l'accès attendu ; les
  voir échouer. `test/api/access-matrix.test.ts` (48 méthodes × 4 profils, la
  vraie `lib/auth.ts`) : **78 cas en échec** avant correction.
- [x] `lib/auth.ts` : rôles `USER`, `GESTIONNAIRE`, `ADMIN` (`lib/roles.ts`) ;
  trois gardes (`guardSignedIn` : toute session, `guardManager` : gestionnaire
  ou admin, `guardAdmin`), chaque route en attend une seule ; `guardAuth` et
  `requireAuth` ont disparu, un test vérifie qu'ils n'existent plus nulle part.
- [x] Migration `20261016120000_three_roles` : contrainte `CHECK` de
  `User.role` sur les trois rôles, `MODERATOR` → `GESTIONNAIRE`, défaut `USER`.
  À blanc puis appliquée sur la branche Neon `dev`, avec l'accord du
  propriétaire ; `main` à l'étape 3.
- [x] Écritures de contenu : `guardManager`, créations et suppressions
  comprises (D19). IA (`trigger-research`, `run-due-passes`, `pipeline-status`,
  `pipeline-jobs`, toute l'inbox, `/admin/cron`) : `guardAdmin`. Gestion des
  comptes : `guardAdmin`.
- [x] Layout `/admin` : un `USER` est renvoyé vers le site (`requirePage`) ;
  l'inbox, le cron et les comptes exigent `ADMIN` côté serveur ; le menu ne
  montre que ce que le rôle permet (`app/admin/nav.ts`).
- [x] Proxy : session obligatoire sur tout le site sauf la page de connexion et
  `/api/auth/*` ; l'API v1, `/api/schools/*` et `/api-docs` compris (G6). Le
  plafond de débit de l'API v1 reste.
- [x] `/contribute` selon D2 : page, route et liens retirés.
- [x] Rôle relu selon D1.
- [x] Tests, typecheck, lint verts ; `npm run smoke` adapté (le mur sans
  session, puis le contenu connecté), joué avec l'accord du propriétaire.
- [x] Validation du propriétaire (16 octobre : commit, push et prompt de
  l'étape 2 demandés).

**Docs :** `architecture/gestion-contenu.md` (rôles, gardes, proxy),
`API-rest.md` (authentification), README (sécurité : la règle « chaque route
admin choisit `guardAuth` ou `guardAdmin` » change de forme), `CLAUDE.md`
(règle 9).

### Étape 2 — Liste blanche, première connexion, écran des rôles

**À trancher d'abord :** D3, D4, D5, D6.

- [ ] Migration : `User.email` (unique), nom affiché, état « invité » ou
  « actif », date de première connexion ; `password_hash` facultatif tant que
  la personne ne s'est pas connectée.
- [ ] Écran admin des utilisateurs : ajouter un e-mail à la liste, retirer un
  invité, changer un rôle, remettre en première connexion (D4) ; le dernier
  admin protégé.
- [ ] Connexion : e-mail et mot de passe ; première connexion : e-mail de la
  liste, choix du mot de passe (`lib/password.ts`), nom affiché (D6).
- [ ] Le plafond de tentatives de connexion (proxy) couvre aussi la première
  connexion.
- [ ] Comptes existants selon D3.
- [ ] Tests (dont : un e-mail hors liste ne crée rien, un invité retiré ne peut
  plus se connecter, un `USER` ne peut pas changer son rôle, le dernier admin),
  typecheck, lint verts.

**Docs :** `architecture/gestion-contenu.md`, `bdd.md` (schéma, migrations),
README (comptes), mémo Vercel §3.3 (les comptes : plus de seed, la liste
blanche).

### Étape 3 — Mise en ligne

**À trancher d'abord :** D7, et le §8.2 du [mémo Vercel](../memory/memory-deploiement-vercel.md)
(préversions).

Le mémo Vercel donne la procédure ; elle reste valable, avec `gestion` à la
place de `localpython`.

- [ ] PR `gestion` → `main`, CI verte ; migrations des étapes 1 et 2 appliquées
  sur la base de production **avant** la fusion, avec l'accord du propriétaire.
- [ ] Le propriétaire crée le projet Vercel et pose les variables (règle 3 de
  `CLAUDE.md`) ; l'agent le guide pas à pas sans jamais demander de secret.
- [ ] L'agent note le nom et l'id `prj_…` dans `CLAUDE.md` et vérifie par le
  MCP Vercel (projet, déploiement, noms des variables).
- [ ] Vérifications du mémo §10, plus : sans session, tout renvoie vers la
  connexion, l'API v1 comprise ; un `USER` ne voit pas `/admin` ; un
  gestionnaire ne voit pas l'IA.
- [ ] Avant la mise en ligne, le propriétaire change le mot de passe du rôle
  Neon `neondb_owner` (recommandé le 15 octobre 2026) et ceux des comptes qui
  ont servi en développement (mémo §9, point 12).
- [ ] Le propriétaire ajoute les premiers e-mails de l'équipe.

**Docs :** mémo Vercel, `CLAUDE.md` (MCP Vercel : le projet), README.

### Étape 4 — Charte graphique et composants de base

**À trancher d'abord :** D8, D9, et le choix de la maquette.

- [ ] Deux ou trois maquettes (artefacts HTML en Tailwind) : un écran public
  (fiche école), un écran du back-office (onglet de gestion), la connexion.
- [ ] Le propriétaire choisit ; la charte est consignée dans
  `docs/architecture/charte-graphique.md` (couleurs, polices, espacements,
  composants, règles d'accessibilité).
- [ ] Tailwind CSS v4 installé **sans preflight** (piège 10) ; les jetons de la
  charte en `@theme`.
- [ ] Composants de base (bouton, champ, liste déroulante, tableau, carte,
  onglets, badge, dialogue, message d'erreur) et deux gabarits de page
  (site, back-office).
- [ ] Appliqués d'abord aux écrans nés aux étapes 1 et 2 (connexion, première
  connexion, utilisateurs).
- [ ] Contrôle CSP sur un build de production ; tests, typecheck, lint verts.

**Docs :** `charte-graphique.md`, `architecture/gestion-contenu.md` (styles),
`architecture.md` §10 bis (outillage).

### Étape 5 — Sources et auteur de chaque modification

**À trancher d'abord :** D10, D11, D12.

- [ ] Migration : `updated_by_id`, `updated_at` (et l'origine, selon D11) sur
  les tables de données ; liens source ajoutés selon D12. Colonnes
  facultatives (piège 5).
- [ ] Toutes les écritures les renseignent : routes de gestion, validation de
  l'inbox (`app/api/admin/inbox/[id]/validate`).
- [ ] Champs « lien source » dans les onglets de gestion.
- [ ] Affichage côté utilisateur, comme le classement aujourd'hui : la source
  et « modifié par … le … » sur chaque donnée ; piège 4 (cache).
- [ ] API v1 : les mêmes informations, `/api-docs` à jour (piège 9).
- [ ] Tests, typecheck, lint verts.

**Docs :** `bdd.md`, `API-rest.md`, `architecture/gestion-contenu.md`.

### Étape 6 — Formulaire de signalement

**À trancher d'abord :** D13.

- [ ] Migration : la table des signalements (auteur, cible école, campus ou
  programme, catégorie, message, lien facultatif, statut, dates).
- [ ] Un bouton « Signaler une information » sur les fiches, ouvert à tout
  connecté ; plafond de débit (`lib/rate-limit.ts`, seule limitation du
  projet).
- [ ] Vue des signalements pour les gestionnaires : traiter, rejeter, avec
  lien vers l'onglet de gestion concerné.
- [ ] Aucun modèle d'IA, aucun ticket `Pending_AI` (piège 6).
- [ ] Tests, typecheck, lint verts.

**Docs :** `bdd.md`, `architecture/gestion-contenu.md`, `edgecase.md`
(abus du formulaire).

### Étape 7 — Historique des recherches IA

**À trancher d'abord :** D14.

- [ ] Migration : `PipelineJob.triggered_by_id`, facultatif (le backend gelé
  écrit la table sans le connaître).
- [ ] Les routes `trigger-research` et `run-due-passes` l'écrivent.
- [ ] L'historique de `/admin/cron` affiche qui a lancé chaque recherche.
- [ ] *Facultatif, priorité faible, si le propriétaire le demande :* retirer
  les messages inutiles de l'affichage IA (liste à établir avec lui).
- [ ] Tests TypeScript et Python verts.

**Docs :** `bdd.md`, `architecture/gestion-contenu.md`.

### Étape 8 — Nouvelles données : événements, année d'entrée

**À trancher d'abord :** D15, D16.

- [ ] Migrations, onglets de gestion, affichage sur les fiches, API v1 et
  `/api-docs`, avec sources et auteur (étape 5).
- [ ] Le doc « Données stockées sur les écoles » mis à jour avec le
  propriétaire.
- [ ] Tests, typecheck, lint verts.

**Docs :** `bdd.md`, `API-rest.md`, `architecture/gestion-contenu.md`.

### Étape 9 — Reprise graphique des écrans restants

**À trancher d'abord :** D17.

- [ ] Chaque écran encore dans l'ancien style passe aux composants (site
  public, `/api-docs`, inbox, `/admin/cron`, onglets restants).
- [ ] Preflight Tailwind activé ; les classes mortes de `globals.css`
  supprimées.
- [ ] Contrôle CSP et contrôle visuel de chaque écran ; tests, typecheck, lint
  verts.

**Docs :** `charte-graphique.md`, `architecture/gestion-contenu.md`.

### Étape 10 — Guide utilisateur

- [ ] Un guide par rôle (utilisateur, gestionnaire, admin), sur le site
  (page d'aide) et en Word.

**Docs :** README (le guide).

---

## 6. Hors périmètre : la partie IA gelée

Ne pas modifier, sauf demande explicite d'une étape ou du propriétaire :

- `backend/` (FastAPI, pipeline Phase 1 et 2, crowdsourcing, Tavily, Gemini,
  Gemma) ;
- les routes et écrans IA, au-delà de leur garde (étape 1), de l'historique
  (étape 7) et des messages (étape 7, facultatif) ;
- les règles de dépense de `CLAUDE.md` (règle 7), qui restent en vigueur.

Pour toute question sur la partie IA : [`docs/README.md`](../README.md), partie
« IA gelée ».

---

## 7. Récapitulatif des fichiers probables

| Étape | Fichiers |
|---|---|
| 1 | `lib/auth.ts`, `proxy.ts`, `app/admin/layout.tsx`, `app/admin/SidebarClient.tsx`, toutes les `app/api/admin/**/route.ts`, `app/api/auth/[...nextauth]/route.ts`, `app/contribute/`, `app/api/contribute/`, `prisma/`, `test/api/*`, `test/proxy.test.ts`, `test/auth.test.ts`, `scripts/smoke-local.ts` |
| 2 | `prisma/`, `app/api/auth/`, `app/(admin-auth)/admin/login/`, `app/admin/users/`, `app/api/admin/users/`, `lib/password.ts` |
| 4 | `package.json`, `app/globals.css`, `postcss.config.*`, `components/` (nouveau) |
| 5 | `prisma/`, `app/api/admin/**`, `app/api/admin/inbox/[id]/validate/route.ts`, `app/schools/**`, `app/api/v1/**`, `app/api-docs/` |
| 6 | `prisma/`, `app/schools/**`, `app/admin/` (vue des signalements), `proxy.ts` |
| 7 | `prisma/`, `app/api/admin/trigger-research/`, `app/api/admin/run-due-passes/`, `app/admin/cron/` |

---

## 8. Documentation à mettre à jour, étape par étape

Chaque étape nomme ses docs (§5). Dans tous les cas : le journal (§9), le
statut en tête de ce document, la section « Phase en cours » de `CLAUDE.md`, et
[`architecture/gestion-contenu.md`](../architecture/gestion-contenu.md) dès que
le code qu'elle décrit change.

---

## 9. Journal de progression

| Date | Étape | Fait | Reste / surprises |
|---|---|---|---|
| 2026-10-16 | 0 | **Réorientation du projet** (réunion de l'équipe du 16 octobre, doc « Plan d'évolution – School Data Pipeline »). Décisions G1 à G9 du propriétaire (§2.1). Branche `gestion` créée depuis `localpython` (`423631e`). Relevé du code : 38 méthodes du back-office en `guardAuth` (toute session), 10 en `guardAdmin`, 4 routes publiques sans garde (`/api/contribute`, `/api/schools/*`) ; le proxy n'exige une session que sur `/admin/*` ; rôle figé 8 h dans le JWT ; contrainte `CHECK` sur `User.role` ; le backend Python n'écrit que `PipelineJob` et `ContributionInbox` ; seules 3 routes appellent le backend. Docs écrites : ce plan, `architecture/gestion-contenu.md`, `docs/README.md` ; `CLAUDE.md` réécrit ; en-têtes de `backend-local.md` (gelé), du cahier des charges, d'`architecture.md`, du README et du mémo Vercel. Aucun code modifié, aucune base touchée, aucun appel payant. | Validation du propriétaire ; commit à sa demande. Puis étape 1 : trancher D1 et D2. `docs/tutoriel-demo.md` (non suivi, centré sur la démo IA) laissé tel quel. |
| 2026-10-16 | 0 | **Le propriétaire demande le commit, le push et le prompt de l'étape 1** : étape 0 tenue pour validée. Ajout avant le commit : une case de l'étape 3 pour changer le mot de passe du rôle Neon `neondb_owner` avant la mise en ligne. Un seul commit sur `gestion`, poussé ; `docs/tutoriel-demo.md` reste hors du commit. | **Prochaine** : étape 1, en commençant par D1 et D2. |
| 2026-10-16 | 1 | **Point de départ vérifié** : `gestion` = `origin/gestion` (`52df900`), CI verte sur cette tête ; 722 tests Python (+25 sous-tests), 542 TypeScript, typecheck propre, lint 0 erreur et 109 avertissements. **Décisions du propriétaire** (recommandations retenues) : **D1** le rôle se relit en base dans les gardes et le layout admin, le proxy ne regarde que la session ; **D2** `/contribute` et `/api/contribute` retirés ; **D18** (question née du code) l'écran actuel des comptes crée des `GESTIONNAIRE` jusqu'à l'étape 2. §2.2 mis à jour. | Le travail de l'étape 1. |
| 2026-10-16 | 1 | **D19** (question née du code, règle 4) : créer une école, supprimer une école, un campus ou un programme passent du rôle `ADMIN` à `guardManager`, comme toute écriture de contenu (G4) ; recommandation retenue. **Fait, tests d'abord** : table d'accès unique `test/helpers/access-policy.ts` (48 méthodes : 33 `guardManager`, 14 `guardAdmin`, 1 `guardSignedIn`) ; `test/api/access-matrix.test.ts` (chaque handler × aucune session, `USER`, `GESTIONNAIRE`, `ADMIN`, avec la vraie `lib/auth.ts`) vu en échec sur **78 cas** (un `USER` passait partout où `guardAuth` gardait, un gestionnaire entrait dans l'IA et l'inbox, D19) ; `admin-guards` (3), `auth` (17), `proxy` (8), `admin-pages`, `roles-migration` (5), `no-public-tickets` (3), `smoke-checks` (8) vus en échec aussi. Code : `lib/roles.ts` (rôles, niveaux, libellés, sans dépendance) ; `lib/auth.ts` (`getSession` relit le compte en base, compte supprimé → pas de session, rôle inconnu → droits d'un `USER`, cookie illisible → pas de session, panne de base → 500 ; `guardSignedIn`, `guardManager`, `guardAdmin` ; `requirePage`) ; 30 routes admin sur leur garde ; `proxy.ts` réécrit (session partout sauf `/admin/login` et `/api/auth/*`, 401 JSON sur `/api/*`, renvoi avec `callbackUrl` sinon ; plafond v1 gardé) ; layout `/admin` en `manager`, `inbox/layout.tsx`, `cron` et `users` en `admin` ; menu `app/admin/nav.ts` ; D2 : page, route, liens et entrée du proxy retirés ; D18 dans `POST /api/admin/users` ; types NextAuth. **Migration** `20261016120000_three_roles` écrite à la main : relevé préalable en lecture (MCP) sur `dev` et `main` : 1 `ADMIN`, 1 `MODERATOR`, défaut `MODERATOR`, ancienne contrainte `NOT VALID` ; `db:status` sur `ep-falling-breeze` (dev), puis `db:migrate:dry` et `db:migrate` **avec l'accord du propriétaire à chaque fois** ; vérifié : 1 `ADMIN`, 1 `GESTIONNAIRE`, défaut `USER`, 11/11 ; `main` intacte. **Smoke** adapté (le mur sans session ; puis connecté si `APPVC_ADMIN_*`) et joué avec l'accord du propriétaire contre le `next dev` déjà lancé sur le port 3000 : mur 22/22, connecté 18 bons et 1 absent (statistiques d'EM Strasbourg) ; mot de passe compté à 0 occurrence dans les journaux. **Fin** : 722 tests Python (+25), **798 TypeScript**, typecheck propre, lint 0 erreur et 109 avertissements. **Tests supprimés** (fonction retirée, D2) : `test/api/contribute.test.ts` (21 tests), « /api/contribute : 5 par 20 s » (`proxy.test.ts`), « les contributions du public ne passent jamais par la coupe » (`ticket-sources.test.ts`) ; la porte est gardée par `test/no-public-tickets.test.ts`. **Attendus changés avec la règle** (§0) : `auth.test.ts` (trois rôles, D1), `admin-guards` (trois gardes, la liste ADMIN d'`architecture.md` §3.6 devient `access-policy.ts`), `proxy.test.ts` (session partout), `pipeline-status`, `pipeline-jobs`, `inbox-*` (`MODERATOR` → `ADMIN` : l'IA et l'inbox sont à l'admin), `run-due-passes`, `trigger-research` (`USER` et `GESTIONNAIRE` refusés), `admin-schools`, `admin-programs`, `admin-records` (cas nominaux en `GESTIONNAIRE`, « `MODERATOR` 403 sur créer et supprimer » devient « `USER` 403 partout », D19), `users` (création en `GESTIONNAIRE`, D18 ; un `USER` change son mot de passe), `smoke-checks` (`/contribute` hors des pages). **Docs** : `architecture/gestion-contenu.md` (§2 réécrit, §3, §4, §7), `API-rest.md` (authentification), README (sécurité), `CLAUDE.md` (règle 9, phase, smoke, 11 migrations), et, parce qu'elles décrivaient l'ancien état : `bdd.md`, un encadré dans `architecture.md` §3.6 et dans le mémo Vercel, `edgecase.md` (cas 1), `.env.example` (`CONTRIBUTION_ALLOWED_DOMAINS` n'est plus lue), `/api-docs` (fiche « Authentification »). | **Validation du propriétaire** ; commit et push à sa demande. Puis étape 2 (D3 à D6). **Écarts au plan, et pourquoi** : le formulaire de connexion revient au `callbackUrl` posé par le proxy, chemin du site seulement (`lib/callback-url.ts`, testé) : sans cela, le mur sur tout le site perd la page demandée ; un bouton « Se déconnecter » remplace « Contribuer » dans la barre du site : tout le site est derrière la connexion, il faut pouvoir en sortir ailleurs que dans le back-office ; le proxy répond 401 en JSON sur `/api/*` au lieu d'une redirection, et le plafond v1 ne compte plus que les requêtes connectées (un refus ne consomme pas le quota d'une IP partagée par l'équipe) ; un pré-vol `OPTIONS` sans session est refusé. **Surprises** : `pipeline-status.test.ts` ne tombait pas en échec mais restait **suspendu** (le faux de session prenait le profil disparu `MODERATOR` pour « aucune session », et un test attendait un appel au backend qui ne venait plus) : le faux lève désormais sur un profil inconnu ; `.next/types/validator.ts` (généré par un ancien `next dev`) citait les fichiers retirés et cassait le typecheck local, régénéré par `next typegen` (qui a aussi réécrit `next-env.d.ts`, remis tel quel ; la CI n'a pas de `.next`) ; un `next dev` tournait déjà sur le port 3000 hors de la session. **Restes connus** : D1 accepté, un compte supprimé garde la lecture du site jusqu'à 8 h ; `isValidHttpsUrl`, `isPrivateHost`, `urlBelongsToDomain` (`lib/utils.ts`) n'ont plus d'appelant hors de leurs tests, gardés pour le lien du signalement (étape 6) ; la migration part sur `main` à l'étape 3, avant la fusion (le compte `MODERATOR` de la production devient alors `GESTIONNAIRE` ; d'ici là, si ce code tournait sur `main`, ce compte n'aurait que les droits d'un `USER`) ; les variables `APPVC_ADMIN_USERNAME` et `APPVC_ADMIN_PASSWORD` sont toujours posées dans Windows (depuis le 15 septembre). |
| 2026-10-16 | 1 | **Le propriétaire demande le commit, le push et le prompt de l'étape 2** : étape 1 tenue pour validée. Un seul commit sur `gestion`, poussé ; `docs/tutoriel-demo.md` reste hors du commit. La migration `20261016120000_three_roles` est sur `dev` seulement : `main` la recevra à l'étape 3, avant la fusion. | **Prochaine** : étape 2, en commençant par D3, D4, D5 et D6. |
