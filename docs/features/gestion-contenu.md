# Chantier — Le gestionnaire de contenu en ligne

> **Statut :** plan rédigé le 16 octobre 2026, à partir du plan d'évolution de
> l'équipe (réunion du 16 octobre) et des réponses du propriétaire le même
> jour. Étape 0 (recentrage : branche, documentation) faite le 16 octobre ;
> le propriétaire demande le commit, le push et le prompt de l'étape 1 :
> étape 0 tenue pour validée. Étape 1 (trois rôles, gardes, connexion
> obligatoire) faite le 16 octobre, décisions D1, D2, D18 et D19 prises,
> migration appliquée sur la branche Neon `dev` ; le propriétaire demande le
> commit, le push et le prompt de l'étape 2 : étape 1 tenue pour validée.
> Étape 2 (liste blanche, première connexion, écran des rôles) faite le
> 16 octobre : décisions D3 à D6, D20 et D21 prises, migration appliquée sur
> `dev` ; le propriétaire demande le commit, le push et le prompt de
> l'étape 3 : étape 2 tenue pour validée ; sa phase connectée du smoke,
> rejouée au début de l'étape 3, est verte. **Étape 3 (mise en ligne) : le
> site est en ligne depuis le 19 octobre** (<https://app-vc-emn.vercel.app>,
> comptes de l'école) : D7, D22 et D23 tranchées, migrations sur `main`,
> `main` rattrapée par avance rapide, projet Vercel `app-vc`, Upstash,
> vérifications faites, comptes en place (mot de passe admin changé, un
> premier collègue), secrets Actions du nouveau dépôt créés : toutes les cases
> cochées, **validation du propriétaire attendue**.
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
| D3 | 2 | Les comptes existants n'ont qu'un identifiant, pas d'e-mail | **Tranché le 16 octobre (recommandation retenue)** : la transition se ferme **compte par compte**. La migration laisse l'e-mail vide pour eux ; l'admin le renseigne depuis l'écran des comptes. La connexion accepte l'e-mail ; l'ancien identifiant ne vaut que pour un compte qui n'a pas encore d'e-mail, et cesse de servir dès que l'e-mail est posé. Aucune écriture SQL à la main, ni sur `dev` ni sur `main` |
| D4 | 2 | Mot de passe oublié, sans envoi d'e-mail | **Tranché le 16 octobre (recommandation retenue)** : l'admin **remet le compte en « première connexion »** (mot de passe effacé, compte redevenu invité, rôle et nom gardés) ; la personne en choisit un nouveau, sur le même modèle de confiance que G5. L'admin ne fixe plus jamais le mot de passe d'un tiers (« Réinitialiser » disparaît) ; on ne se remet pas soi-même en première connexion |
| D5 | 2 | Domaine `@em-normandie.fr` : imposé par le code ou liste libre | **Tranché le 16 octobre (recommandation retenue)** : **imposé** par une constante du code, testée, à l'ajout comme à la première connexion, admins compris ; l'élargir est une décision du propriétaire |
| D6 | 2 | Le nom affiché (étape 5 : « modifié par ») : les comptes n'ont qu'un e-mail | **Tranché le 16 octobre (recommandation retenue)** : demandé **à la première connexion**, prérempli depuis `prenom.nom@…`, modifiable ; chacun le change ensuite sur une page « Mon compte » (ouverte à toute session) ; une seule colonne |
| D20 | 2 | (question née du code, demandée par le propriétaire) Une session ouverte doit cesser quand le compte est remis en première connexion, retiré ou désactivé, même si son jeton vaut encore 8 h | **Tranché le 16 octobre (recommandation retenue)** : `getSession()` refuse un compte qui n'est pas actif, et un jeton émis avant la dernière remise à zéro (numéro de version du compte, recopié dans le jeton à la connexion) : plus de back-office, d'écriture ni de « Mon compte ». La **lecture** du site et de l'API v1 reste possible jusqu'à l'expiration du jeton (8 h au plus), comme D1 : le proxy ne lit pas la base (contrôle « optimiste », doc Next 16). Les jetons émis avant ce code n'ont pas de version : leurs sessions sont coupées une fois |
| D21 | 2 | (question née du code) Retirer un compte déjà actif : G5 ne parle que des invités, et « modifié par » (étape 5) renverra au compte | **Tranché le 16 octobre (recommandation retenue)** : un troisième état, **« désactivé »** : plus de connexion, sessions coupées, nom gardé pour l'historique, e-mail réservé ; réactivable par la remise en première connexion. La suppression ne sert plus qu'aux invités |
| D7 | 3 | L'offre Hobby est réservée à un usage personnel non commercial ; le mémo Vercel (§6) note « usage non commercial, accepté par le propriétaire », mais l'outil devient un outil d'équipe | **Tranché le 16 octobre : rester en Hobby, en connaissance de cause** (l'agent recommandait Pro avant d'y faire entrer l'équipe). Les règles d'usage de Vercel (relues le 16 octobre, page du 14 septembre 2026) comptent comme commercial tout déploiement qui rapporte à quelqu'un ayant participé au projet, « y compris un salarié qui écrit le code » ; risque accepté : une mise en pause du compte par Vercel, compte qui gère aussi l'organisation Neon de la base. Passer en Pro (20 $ HT par mois) reste possible à tout moment, par le propriétaire |
| D22 | 3 | (question du mémo Vercel §8.2) Les préversions : base reliée à Production seulement, ou aussi à Preview avec *Preview Branching* | **Tranché le 16 octobre (recommandation retenue)** : **Production seulement**, Ignored Build Step sur « Only build production ». `gestion` se teste sur le poste contre la branche Neon `dev` (G3) : une préversion n'écrit jamais dans la production, et une branche de préversion copiée de la production n'aurait pas les migrations à venir, qui partent du poste |
| D23 | 3 | (question du mémo Vercel §7) `preload` dans l'en-tête `Strict-Transport-Security` | **Tranché le 16 octobre (recommandation retenue)** : **gardé tel quel**. Sur une adresse `*.vercel.app`, la directive n'a d'effet que si quelqu'un soumet le domaine à la liste de préchargement ; à revoir le jour d'un domaine propre |
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

### Étape 2 — Liste blanche, première connexion, écran des rôles ✅ (16 octobre)

**Tranchées :** D3, D4, D5, D6, et deux questions nées du code, D20 et D21
(§2.2).

- [x] Migration `20261016150000_whitelist_accounts` : `User.email` (unique),
  nom affiché, état « invité », « actif » ou « désactivé » (D21), date de
  première connexion, version de session (D20) ; `password_hash` et
  `username` facultatifs. À blanc puis appliquée sur `dev`, avec l'accord du
  propriétaire ; `main` à l'étape 3.
- [x] Écran admin des utilisateurs : ajouter un e-mail à la liste, retirer un
  invité, changer un rôle, remettre en première connexion (D4), désactiver
  (D21), renseigner l'adresse d'un compte ancien (D3) ; le dernier admin
  protégé (transaction sérialisable).
- [x] Connexion : e-mail et mot de passe ; première connexion : e-mail de la
  liste, choix du mot de passe (`lib/password.ts`), nom affiché (D6).
- [x] Le plafond de tentatives de connexion (proxy) couvre aussi la première
  connexion, sur le même compteur.
- [x] Comptes existants selon D3.
- [x] « Mon compte » (`/account`) : son nom affiché et son mot de passe, pour
  toute session (écart au plan, voir le journal).
- [x] Tests (dont : un e-mail hors liste ne crée rien, un invité retiré ne peut
  plus se connecter, un `USER` ne peut pas changer son rôle, le dernier admin),
  typecheck, lint verts.
- [x] `npm run smoke` : le mur, puis la phase connectée, rejouée au début de
  l'étape 3 contre un `next dev` relancé (client Prisma régénéré) : 43 bons,
  1 absent (statistiques d'EM Strasbourg), 0 en échec.
- [x] Validation du propriétaire (16 octobre : commit, push et prompt de
  l'étape 3 demandés).

**Docs :** `architecture/gestion-contenu.md`, `bdd.md` (schéma, migrations),
README (comptes), mémo Vercel §3.3 (les comptes : plus de seed, la liste
blanche).

### Étape 3 — Mise en ligne

**Tranchées :** D7, et deux questions du [mémo Vercel](../memory/memory-deploiement-vercel.md),
D22 (préversions, §8.2) et D23 (HSTS, §7) (§2.2).

Le mémo Vercel donne la procédure ; elle reste valable, avec `gestion` à la
place de `localpython`.

- [x] PR `gestion` → `main`, CI verte ; migrations des étapes 1 et 2 appliquées
  sur la base de production **avant** la fusion, avec l'accord du propriétaire.
  *Migrations : faites le 19 octobre (12/12 sur `main`). PR remplacée par une
  avance rapide de `main` sur `ecad4a9`, CI verte sur ce commit (écart à G3,
  décision du propriétaire, journal). La CI du nouveau dépôt attend ses
  secrets Actions.*
- [x] Le propriétaire crée le projet Vercel et pose les variables (règle 3 de
  `CLAUDE.md`) ; l'agent le guide pas à pas sans jamais demander de secret.
  *Projet `app-vc` sur le Vercel de l'école, 19 octobre.*
- [x] L'agent note le nom et l'id `prj_…` dans `CLAUDE.md` et vérifie par le
  MCP Vercel (projet, déploiement, noms des variables).
- [x] Vérifications du mémo §10, plus : sans session, tout renvoie vers la
  connexion, l'API v1 comprise ; un `USER` ne voit pas `/admin` ; un
  gestionnaire ne voit pas l'IA. *Résultats : mémo §10. Les rôles sont tenus
  par les tests (matrice d'accès, menus) ; aucun compte `USER` n'existe en
  ligne ; le contrôle du gestionnaire en ligne a été proposé au propriétaire
  (réponse « fait », sans détail).*
- [x] Avant la mise en ligne, le propriétaire change le mot de passe du rôle
  Neon `neondb_owner` (recommandé le 15 octobre 2026) et ceux des comptes qui
  ont servi en développement (mémo §9, point 12). *`neondb_owner` : changé le
  19 octobre sur l'ancienne base ; sur la nouvelle base de l'école, le
  propriétaire a décidé de ne pas le changer (risque accepté, journal).
  Comptes : mot de passe admin changé par le propriétaire le 19 octobre
  (vérifié par l'empreinte, à la seconde tentative) ; le compte gestionnaire
  est un compte de test.*
- [x] Le propriétaire ajoute les premiers e-mails de l'équipe. *Un collègue
  le 19 octobre, mis `ADMIN` par le propriétaire, première connexion faite.*

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
| 2026-10-16 | 1 | **Le propriétaire demande le commit, le push et le prompt de l'étape 2** : étape 1 tenue pour validée. Un seul commit sur `gestion`, poussé ; `docs/tutoriel-demo.md` reste hors du commit. La migration `20261016120000_three_roles` est sur `dev` seulement : `main` la recevra à l'étape 3, avant la fusion. Puis un second commit : `test/roles-migration.test.ts` exigeait que cette migration reste **la dernière**, ce qui aurait cassé à la première migration de l'étape 2 ; il exige maintenant qu'elle passe après `20260902120000` (celle qui posait `ADMIN | MODERATOR`), ce qui était l'intention. | **Prochaine** : étape 2, en commençant par D3, D4, D5 et D6. |
| 2026-10-16 | 2 | **Point de départ vérifié** : `gestion` = `origin/gestion` (`43e7153`), CI verte sur cette tête (run 35) ; 722 tests Python (+25 sous-tests), 798 TypeScript, typecheck propre, lint 0 erreur et 109 avertissements. Relevé en lecture (MCP) : `dev` a 1 `ADMIN` et 1 `GESTIONNAIRE`, `main` 1 `ADMIN` et 1 `MODERATOR` ; aucun identifiant ne contient « @ ». **Décisions du propriétaire** (recommandations retenues) : **D3** transition compte par compte (l'identifiant ne vaut que pour un compte sans e-mail) ; **D4** remise en première connexion, l'admin ne fixe plus le mot de passe d'un tiers ; **D5** domaine imposé par une constante ; **D6** nom affiché demandé à la première connexion, prérempli depuis l'e-mail, modifiable sur « Mon compte ». Deux questions nées du code (règle 4) : **D20** une session cesse quand le compte n'est plus actif ou a été remis à zéro (version du compte dans le jeton), la lecture restant possible jusqu'à 8 h comme D1 ; **D21** un compte actif se désactive au lieu d'être supprimé. Annoncés sans objection : le dernier admin actif est protégé par une transaction sérialisable ; première connexion sur `/admin/first-login` et `POST /api/first-login` (hors de `/api/auth/*`), au même plafond que la connexion, tentatives confondues ; un e-mail ajouté devient un invité `USER` ; une page « Mon compte » (`/account`) ouverte à toute session. §2.2 mis à jour. | Le travail de l'étape 2. |
| 2026-10-16 | 2 | **Fait, tests d'abord.** Tests écrits avant le code et vus en échec : **26 échecs sur 802**, dont 6 fichiers qui ne se chargeaient pas (modules et routes absents) ; la matrice d'accès montrait déjà le trou : sorti de `SIGNED_IN`, l'ancien `PATCH users/[id]/password` laissait passer un `USER` au niveau gestionnaire. **Code** : `lib/accounts.ts` (domaine imposé `em-normandie.fr`, D5 ; adresses en minuscules ; nom déduit de l'adresse et borné, D6 ; états) ; `lib/sign-in.ts` (connexion par l'adresse ; l'ancien identifiant ne vaut que sans adresse, D3 ; seul un compte actif ; version de session dans le jeton) branché par la route NextAuth (champ `login`) ; `lib/auth.ts` (`getSession` refuse un compte non actif et un jeton dont la version n'est pas celle du compte, D20 ; nom et adresse lus en base) ; `lib/account-admin.ts` (`changeAccount` : transaction sérialisable, aucun changement ne laisse zéro admin actif, conflit P2034 → 409) ; `lib/request-body.ts` (`readJsonObject`) ; routes `POST /api/first-login` (mise à jour de l'adresse **dans l'état invité** seulement : rien n'est créé, même refus pour une adresse inconnue, active ou désactivée), `users` (GET liste, POST ajout d'un invité `USER`, aucun e-mail), `users/[id]` (DELETE d'un invité seulement, D21), `users/[id]/role`, `reset` (D4), `disable` (D21), `email` (D3), `account` et `account/password` (soi-même, sans identifiant) ; `users/[id]/password` **retirée** (D4) ; `proxy.ts` (première connexion libre, page et route, plafond partagé avec la connexion) ; pages `/admin/first-login`, `/account`, connexion par l'adresse, écran des comptes réécrit, liens « Mon compte » dans la barre du site et le menu ; `prisma/seed.ts` (`SEED_ADMIN_EMAIL`). **Migration** `20261016150000_whitelist_accounts` écrite à la main, additive, cinq contraintes `CHECK` ; relevé préalable en lecture (MCP) des contraintes et index de `User` sur `dev` (aucun conflit de nom) ; `db:status` sur `ep-falling-breeze` (dev, 11/12), puis `db:migrate:dry` et `db:migrate` **avec l'accord du propriétaire à chaque fois** ; vérifié : 12/12, 1 `ADMIN` et 1 `GESTIONNAIRE` actifs sans adresse, défaut `INVITED`, 6 contraintes `CHECK` ; `main` intacte (10 migrations, pas de colonne `email`). **Smoke**, avec l'accord du propriétaire, contre son `next dev` du port 3000 : mur **24/24** (connexion, première connexion, `/account` compris) ; phase connectée **refusée**, parce que ce serveur tourne depuis le 15 octobre avec l'ancien client Prisma (régénéré à 16 h 49) : `lib/sign-in.ts` y voit `email` et `status` indéfinis et refuse, dans le sens sûr. Identifiants recopiés dans le seul processus du smoke (`APPVC_ADMIN_USERNAME` et `APPVC_ADMIN_PASSWORD` présentes, `APPVC_ADMIN_EMAIL` absente) ; mot de passe compté à 0 occurrence dans la sortie. **Fin** : 722 tests Python (+25), **900 TypeScript**, typecheck propre, lint 0 erreur et **104 avertissements** (109 avant : les `any` de l'ancien écran des comptes ont disparu ; il reste sur le nouveau le même `set-state-in-effect` que sur l'ancien). **Tests supprimés** (fonction retirée) : dans `test/api/users.test.ts`, la création par identifiant et mot de passe (« un GESTIONNAIRE (D18) », « nom pris ou trop court », « la politique de mot de passe est appliquée » à la création), remplacée par l'ajout d'une adresse (G5), et « le mot de passe d'un tiers : un ADMIN le réinitialise sans l'actuel » (D4) ; les tests du mot de passe de soi-même sont repris dans `test/api/account.test.ts`. **Attendus changés avec la règle** (§0) : `access-policy.ts` (`SIGNED_IN` = `account`, `account/password` ; quatre routes des comptes en `ADMIN_ONLY`), `access-matrix` (comptes du faux actifs en version 0 ; au moins 53 méthodes : 33 `Gest.`, 18 `Admin`, 2 `Session`), `auth.test` (le faux de base rend état et version, les sessions portent la version), `users.test` (« suppression : sinon supprimé » devient « seul un invité se retire », D21), `proxy.test` (`FREE` + la première connexion), `smoke-checks` (`/account` dans `PAGES`, la première connexion ouverte dans le mur), `callback-url` (pas de retour vers la première connexion), `fake-prisma.ts` (garde les options d'un `$transaction`). **Docs** : `architecture/gestion-contenu.md` (§2 réécrit, §3, §4, §5, §7), `bdd.md` (schéma, 12 migrations, `User.status`), README (section « Comptes », seed, smoke, sécurité), mémo Vercel (encadré de l'étape 2, §1.3, §3.3 réécrit), `CLAUDE.md` (phase, règle 9, smoke, 12 migrations), `API-rest.md` (authentification), encadré d'`architecture.md` §3.6, `manual_testing_cron.md` (le seed), `.env.example` (`SEED_ADMIN_EMAIL`). | **Validation du propriétaire** ; commit et push à sa demande. **À faire** : relancer le `next dev` du port 3000, puis rejouer le smoke (phase connectée, par l'ancien identifiant tant que le compte admin de `dev` n'a pas d'adresse ; une fois l'adresse posée, poser `APPVC_ADMIN_EMAIL`). **Écarts au plan, et pourquoi** : la page « Mon compte » et ses deux routes (`app/api/admin/account/*`, couvertes par la matrice) : sans elle, un `USER`, qui ne voit pas `/admin`, ne pouvait changer ni son mot de passe ni son nom ; le seed exige `SEED_ADMIN_EMAIL` et crée un admin actif avec adresse : l'ancien seed (identifiant, état par défaut `INVITED`) violerait les nouvelles contraintes ; la route de première connexion est hors de `/api/auth/*`, où tout devient public d'office ; les styles de la carte de connexion passent de `styled-jsx` à `globals.css`, partagés avec la première connexion, et le lien actif de la barre du site (`.public-nav-link.active`) prend un style, visible aussi sur `/api-docs` ; pas de `.btn-sm` global (l'inbox gelée s'en sert), un style limité à l'écran des comptes. **Surprises** : l'outil Bash avale les antislashs d'un script en ligne, d'où des éditions par fichier ; un `node --test` coupé par `| head` restait orphelin (arrêté) ; `.next/types/validator.ts` citait encore la route retirée (régénéré par `next typegen`, `next-env.d.ts` remis tel quel) ; le `next dev` du propriétaire, lancé avant `prisma generate`, garde l'ancien client. **Restes connus** : D20 accepté, un compte désactivé ou remis à zéro garde la lecture du site et de l'API jusqu'à 8 h ; changer son propre mot de passe ne coupe pas ses autres sessions (non demandé) ; à la mise en ligne, les jetons sans version sont refusés, chacun se reconnecte une fois ; les deux migrations partent sur `main` à l'étape 3, dans l'ordre, avant la fusion ; le compte admin de `dev` (et ceux de `main`) n'ont pas encore d'adresse. |
| 2026-10-16 | 2 | **Le propriétaire demande le commit, le push et le prompt de l'étape 3** : étape 2 tenue pour validée. Un seul commit sur `gestion`, poussé ; `docs/tutoriel-demo.md` reste hors du commit. La phase connectée du smoke n'a pas été rejouée (le `next dev` du propriétaire n'a pas été relancé) : la case reste ouverte, à cocher au début de l'étape 3. Les migrations `20261016120000_three_roles` et `20261016150000_whitelist_accounts` sont sur `dev` seulement : `main` les recevra à l'étape 3, dans cet ordre, avant la fusion. | **Prochaine** : étape 3 (mise en ligne), en commençant par rejouer le smoke connecté, puis D7 et le §8.2 du mémo Vercel. |
| 2026-10-16 | 3 | **Point de départ vérifié** : `gestion` = `origin/gestion` (`073991d`), CI verte sur cette tête (run 36) ; 722 tests Python (+25 sous-tests), 900 TypeScript, typecheck propre, lint 0 erreur et 104 avertissements. **Les secrets de la CI visent la branche Neon `main`** : dans le run 36, `prisma migrate status` a lu `ep-twilight-forest-ab9qjkm7` et y a vu les deux migrations en attente (étape en échec, non bloquante sur `gestion`) ; une PR vers `main` restera donc rouge tant que `main` n'aura pas ses migrations (piège 11). **Smoke de l'étape 2**, avec l'accord du propriétaire, qui a demandé à l'agent de relancer lui-même le `next dev` : l'ancien (lancé le 15 octobre par `npm run local`, backend arrêté, port 8000 libre) arrêté, `npm run dev` relancé par l'agent ; mur 24/24, connecté (ancien identifiant) 19 bons et 1 absent (statistiques d'EM Strasbourg) ; mot de passe compté à 0 occurrence dans la sortie ; case de l'étape 2 cochée. **Décisions du propriétaire** : **D7** rester en Hobby, en connaissance de cause (l'agent recommandait Pro) ; **D22** (mémo §8.2) base reliée à Production seulement, recommandation retenue ; **D23** (mémo §7) `preload` de HSTS gardé, recommandation retenue. §2.2 mis à jour. **Relevé de `main` par le MCP** (lecture) : 10 migrations, 1 `ADMIN` et 1 `MODERATOR` avec mot de passe, aucun identifiant avec « @ », contraintes `User_pkey` et `User_role_check` (`ADMIN | MODERATOR`, `NOT VALID`), index `User_pkey` et `User_username_key` : conforme au relevé du 16 octobre, aucun conflit de nom avec les deux migrations. | Migrations sur `main` (bascule du poste par le propriétaire), PR, projet Vercel. |
| 2026-10-19 | 3 | **Migrations des étapes 1 et 2 appliquées sur `main`** (base de production). Bascule du poste vers `main` faite par l'agent, sur **autorisation explicite du propriétaire** de modifier les `.env*` : un script du scratchpad remplace l'identifiant d'endpoint sur les seules lignes actives `DATABASE_URL` et `DIRECT_URL` et n'affiche que le numéro de ligne, le nom et la branche, jamais une valeur ; 4 lignes (`.env.local` : 2, `.env` : 2) ; `backend/.env` laissé sur `dev` (le backend ne se lance pas, les migrations ne le lisent pas). `db:status` : `ep-twilight-forest-ab9qjkm7`, 10/12. `db:migrate:dry` avec l'accord du propriétaire : les deux migrations vérifiées, puis `ROLLBACK` ; contrôlé par le MCP : rien d'écrit. `db:migrate` : **refusé à l'agent par le classifieur du mode automatique** (« déploiement en production »), malgré l'accord du propriétaire, qui l'a lancé lui-même : 2 migrations appliquées sur `ep-twilight-forest-ab9qjkm7`. Vérifié par le MCP (lecture) : 12/12, `ADMIN` et `GESTIONNAIRE` (l'ancien `MODERATOR`) `ACTIVE`, sans adresse, avec identifiant et mot de passe, version de session 0 ; défauts `USER`, `INVITED`, 0 ; 6 contraintes `CHECK` (`User_role_check` `NOT VALID`, les 5 de la liste blanche validées) ; index `User_email_key`. Poste remis sur `dev` par le même script (4 lignes) ; `db:status` : `ep-falling-breeze-abibnpc4`, 12/12. Le backend ne s'est lancé à aucun moment. | Mot de passe de `neondb_owner`, Upstash, PR `gestion` → `main`, projet Vercel. **Surprise** : après ce refus, le classifieur a aussi refusé un `db:status` (lecture seule) ; l'état a été relu par le MCP. |
| 2026-10-19 | 3 | **Mot de passe du rôle Neon `neondb_owner` changé** (recommandation du 15 octobre : l'URL de `main` avait été collée dans le chat). Question d'ordre posée (règle 4) : le changer **avant** la PR et avant de relier la base à Vercel (recommandé, retenu), et sur `dev` aussi (recommandé, retenu). Le propriétaire a fait le reset dans la console Neon sur `main` et `dev`, et mis à jour les secrets GitHub `DATABASE_URL` et `DIRECT_URL` (qui visent `main`). Pour `dev`, il a **donné le nouveau mot de passe dans le chat** (non recopié ici) et demandé à l'agent de l'écrire : un script du scratchpad l'a posé dans les 5 lignes `dev` du poste (`.env.local` : 2, `.env` : 2, `backend/.env` : 1) sans rien afficher ; `db:status` : `ep-falling-breeze-abibnpc4`, 12/12. Les deux branches n'ont plus le même mot de passe : une bascule change désormais l'URL entière (`manual_testing_cron.md` §1.3 réécrit). **Le propriétaire ne veut pas de PR pour l'instant** et demande le commit et le push : commit sur `gestion`, poussé. Docs mises à jour : `CLAUDE.md` (phase en cours), `bdd.md` et `architecture/gestion-contenu.md` (migrations sur `main`), mémo Vercel (encadré du 19 octobre, §3.1), `manual_testing_cron.md` §1.3, statut et cases de ce plan. | Upstash ; fusion de `gestion` dans `main` (le propriétaire dira comment) ; projet Vercel ; vérifications ; comptes. Le mot de passe de `dev` est passé par le chat : un nouveau reset de `dev` le rendrait propre, au choix du propriétaire. La CI de `gestion` dira si les secrets GitHub marchent (étape « statut des migrations » : connexion à `main`, 12/12). |
| 2026-10-19 | 3 | **Secrets GitHub vérifiés.** Run 37 (`ecad4a9`), première tentative : l'étape « statut des migrations » (non bloquante sur `gestion`) échouait en `P1013` (« The scheme is not recognized ») : la valeur collée dans le secret `DIRECT_URL` portait des guillemets. Le propriétaire les a retirés ; run relancé par l'agent (MCP GitHub, à sa demande) : `ep-twilight-forest-ab9qjkm7`, 12 migrations, « Database schema is up to date! » ; les trois jobs verts. | Rattrapage de `main` sur `gestion` (le propriétaire ne veut pas de PR pour l'instant) ; Upstash ; projet Vercel. **À retenir** : un secret GitHub prend la valeur nue, sans guillemets ; un job vert sur `gestion` ne prouve pas l'étape des migrations (`continue-on-error`), il faut lire son journal. |
| 2026-10-19 | 3 | **`main` rattrapée sur `gestion` par avance rapide, sans PR** (décision du propriétaire, règle 4 : avance rapide recommandée, ou PR plus tard). `origin/main` était un ancêtre de `gestion` : `git push origin ecad4a9:refs/heads/main`, `e4c09cf..ecad4a9`, sans commit de fusion ni `--force`. Ce commit avait déjà toute sa CI verte, migrations contre `main` comprises. Nécessaire **avant** le projet Vercel : la production se déploie depuis `main`, dont l'ancien code (site public, ancien schéma de `User`) aurait violé G9 et cassé sur la base migrée. | **Écart à G3** (« rattrapée par PR, CI verte ») : le propriétaire ne veut pas de PR pour l'instant ; la CI verte est tenue, sur le commit lui-même. Suite : CI du push sur `main`, Upstash, projet Vercel. |
| 2026-10-19 | 3 | **Le propriétaire déplace l'hébergement sur des comptes de l'école** : le dépôt GitHub et le projet Vercel iront au compte GitHub `emnormandie76` (compte personnel, `type: User`, créé le 29 septembre 2026) ; `Anton1P` ne sert plus qu'à commiter et pousser. Relevés de l'agent : un transfert GitHub garde les secrets Actions et ajoute l'ancien propriétaire comme collaborateur ; en Hobby, Vercel ne bloque les commits d'un autre auteur que pour les dépôts d'**organisation**, pas pour les collaborateurs d'un compte personnel ; la base `vc-bdd` vit dans l'organisation Neon gérée par le Vercel d'`Anton1P` et **ne peut pas** être transférée (Neon refuse les organisations gérées par Vercel ; Vercel exige d'être membre des deux équipes, impossible entre deux Hobby). **Transfert GitHub** lancé, e-mail d'acceptation jamais reçu ; **repli** : `emnormandie76` crée un dépôt privé vide `veille-concurenciel`, `Anton1P` collaborateur. Le push des branches a été **refusé à l'agent par le classifieur** (« exfiltration de données »), comme ensuite un simple `ls-remote` du nouveau dépôt ; le MCP GitHub (accès limité aux dépôts d'`Anton1P`) répond 404. Le propriétaire a poussé lui-même les 6 branches de l'ancien dépôt (`refs/remotes/origin/*` → `refs/heads/*`, `main` d'abord ; aucune étiquette) et renommé les remotes : `origin` = `emnormandie76/veille-concurenciel`, `anton1p` = l'ancien. Vérifié sur le poste (lecture des références locales) : 6 branches, mêmes commits ; `gestion` suit `origin/gestion`. | Secrets Actions à recréer dans le nouveau dépôt (`DATABASE_URL`, `DIRECT_URL` sans guillemets, `NEXTAUTH_SECRET`) ; CI du nouveau dépôt rouge d'ici là. **Décision à prendre** : la base (A : nouvelle base Neon à l'école, données copiées par l'*Import Data Assistant* ; B : garder `vc-bdd`, `DATABASE_URL` saisie à la main dans Vercel). Compte Vercel de l'école, Upstash avec le compte de l'école. Docs à revoir : `CLAUDE.md` (MCP Vercel, Neon, dépôt), mémo Vercel. Les push vers le nouveau dépôt et le suivi de sa CI passent par le propriétaire, sauf règle de permission ou accès du MCP GitHub. |
| 2026-10-19 | 3 | **La base passe à l'école (option A du propriétaire).** Nouvelle base Neon `vc-bdd` créée par le propriétaire depuis le Vercel de l'école (Hobby, `emnormandie76`), à Londres, Postgres 17 : endpoint `ep-super-rain-zas6jyy2` (`c-2.eu-west-2`). L'*Import Data Assistant* de Neon est écarté (il crée un **nouveau projet**, hors de la base créée par Vercel). **Schéma** : `scripts/db-migrate.ts` refuse une base jamais migrée (la première fois, `_prisma_migrations` doit venir de la CLI Prisma) ; le propriétaire passe sur le partage de connexion de son téléphone (5432 ouvert), et l'agent lance, à sa demande, `npx prisma migrate status` (hôte `ep-super-rain-zas6jyy2`, 12 en attente) puis `npx prisma migrate deploy` (12 appliquées). **Données** : script du scratchpad `copy-db.cjs` (WebSocket 443 ; source lue dans un instantané `REPEATABLE READ READ ONLY` ; cible refusée si c'est l'ancienne base, si elle n'est pas vide ou pas migrée comme la source, si une colonne diffère ; copie par `json_agg` puis `json_populate_recordset`, 14 tables dans l'ordre des 16 clés étrangères, une transaction ; empreinte MD5 de chaque table des deux côtés, `ROLLBACK` au moindre écart). Aller-retour JSON vérifié d'abord en lecture sur `dev` (MCP, 13 tables non vides identiques). L'URL de l'ancienne `main` posée par le propriétaire le temps de la copie dans `.env.local` (`SOURCE_URL`), puis retirée par l'agent. `check` (lecture), `copy --dry-run`, `copy`, `check` : **14 tables identiques** (6 écoles, 13 campus, 46 programmes, 51 programme × campus, 26 rattachements, 7 capacités, 21 tarifs, 8 classements, 0 placement, 1 chiffres clés, 17 accréditations, 4 jobs, 8 tickets, 2 comptes). L'ancienne base n'a été que lue. | Le poste (`.env.local`) vise la **nouvelle `main`**, c'est-à-dire la future production : créer la branche `dev` de la nouvelle base et y remettre le poste (5 lignes) ; secrets Actions du nouveau dépôt sur la nouvelle `main` ; MCP Neon à reconnecter au compte de l'école (les identifiants de `CLAUDE.md` deviennent ceux de l'ancienne base) ; Upstash ; projet Vercel. L'ancienne base (`lucky-cell-29057691`, Vercel d'`Anton1P`) reste en sauvegarde, figée : plus rien ne doit y écrire. |
| 2026-10-19 | 3 | **Branche `dev` de la nouvelle base** créée par le propriétaire depuis `main` (`br-odd-cloud-zao7fqra`, `ep-proud-lab-za705j3u`, données comprises ; vérifié par le MCP : 12 migrations, 6 écoles, 46 programmes, 2 comptes, aucun `Pending_AI`). Le propriétaire a **collé dans le chat** les URL de `dev`, mot de passe compris, et demandé à l'agent de les poser : script du scratchpad, 5 lignes (`.env.local` : 2, `.env` : 2, `backend/.env` : 1), rien d'affiché ; `db:status` : `ep-proud-lab-za705j3u`, 12/12. Le script a relevé que ce mot de passe est **identique** à celui de la nouvelle `main` (une branche Neon hérite des rôles de sa parente). Recommandation de l'agent : le changer sur `main` et `dev` avant de relier la base à Vercel. **Décision du propriétaire : ne pas le changer** (risque accepté : le mot de passe de la production est passé par le chat). MCP Neon et Vercel reconnectés par le propriétaire aux comptes de l'école ; `CLAUDE.md` (sections MCP) et `manual_testing_cron.md` §1.3 réécrits sur les nouveaux identifiants. Le MCP GitHub n'a pas accès au nouveau dépôt (aucune application à configurer côté `emnormandie76`) : la CI se lira par le propriétaire. | Secrets Actions du nouveau dépôt (à créer en `emnormandie76`, seul à voir les Settings d'un dépôt personnel) ; Upstash ; projet Vercel. |
| 2026-10-19 | 3 | **Mise en ligne sur le Vercel de l'école.** Upstash créé par l'intégration du Marketplace Vercel (`appvc-ratelimit`), qui pose `KV_REST_API_URL` et `KV_REST_API_TOKEN`, des noms que `lib/rate-limit.ts` ne lit pas (piège du mémo §5) : option retenue, sans toucher au code, recopier les valeurs sous `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN`. Projet : trois imports par le propriétaire (`veille-concurenciel`, `vc`, puis `app-vc`), les deux premiers supprimés ; Vercel proposait un projet « Services » (backend FastAPI + Next.js) : seul le site Next.js est importé (« Import single project »), le backend n'est pas hébergé. **`app-vc`** (`prj_x0D6x90ihnJnc86piYtt9fJXfNLM`), équipe `em-normandie1`, adresse `https://app-vc-taupe.vercel.app` (`app-vc.vercel.app` était prise). Premier build en échec faute de `DATABASE_URL`, attendu. Neon relié d'abord en Production **et Preview**, corrigé en Production seule (D22) ; Upstash en Production seule. Variables vérifiées par le MCP (noms seulement) : `DATABASE_URL` (intégration), `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, toutes en Production ; aucune du §1.3 du mémo. Réglages : `lhr1`, Fluid compute, « Only build production », Node 24.x. **Redéploiement READY** (`dpl_DSeQFiVphpvY7CsDTAHgzaEwjdZK`, `ecad4a9`, régions `lhr1`). Contrôles sans session (GET, script Node du scratchpad, `curl` étant refusé sur le poste) : 9 pages en 307 vers `/admin/login?callbackUrl=…`, connexion et première connexion en 200, 6 routes d'API (v1, `/api/schools`, back-office, IA, comptes) en 401 JSON, les 6 en-têtes de sécurité présents. La protection Vercel « Standard » laisse publiques les adresses de production (documentation relue). | Test du 429 (bloque l'IP 15 min : accord du propriétaire), comptes (adresses, mots de passe), contrôles connectés (`/admin/cron`, `pipeline-status` 503, CSP, rôles), adresses de l'équipe, secrets Actions du nouveau dépôt, docs et compte rendu. Les MCP Vercel appelés **avec** `teamId` rendent 403 (portée `em-normandie1` non accordée) ; sans `teamId`, ils passent. |
| 2026-10-19 | 3 | Le propriétaire signale dans le journal du build Vercel « Dynamic server usage » sur `GET /api/schools` (`request.url`). Connu (mémo §4, build du 15 octobre). Vérifié sur un build local du même commit : `/api/schools` est `ƒ (Dynamic)`, pas figée au build. Le message vient du pré-rendu tenté à cause de `revalidate = 3600`, dont le `catch` de la route journalise l'erreur. `next-env.d.ts`, réécrit par le build, remis tel quel. | Point mineur, hors de l'étape 3 : déclarer la route dynamique explicitement (ou relancer l'erreur avec `unstable_rethrow`) ferait taire ce bruit ; à décider avec le propriétaire. |
| 2026-10-19 | 3 | **Test du plafond de connexion**, avec l'accord du propriétaire (prévenu du blocage de 15 min de l'IP) : 6 `POST /api/auth/callback/credentials` (adresse inexistante, faux mot de passe, sans jeton CSRF, donc sans lecture de compte) : 302 ×5, puis **429** (`retry-after: 900`). Le 429 seul ne distingue pas Upstash du repli mémoire : preuve demandée au propriétaire, la clé `rl:login:<ip>:<fenêtre>` dans le Data Browser d'Upstash (`lib/rate-limit.ts`). | Comptes après la levée du blocage ; contrôles connectés. |
| 2026-10-19 | 3 | **Fin de la mise en ligne.** Le propriétaire, qui ne suivait plus les consignes, a demandé à l'agent de **piloter son Chrome** (Claude in Chrome) ; règle posée : l'agent ne tape aucun mot de passe. **Upstash prouvé** : dans le Data Browser, la clé `rl:login:<ip>:1991570` et 12 commandes comptées (INCR + EXPIRE des 6 tentatives). **Changement d'adresse** : le propriétaire a ajouté `app-vc-emn.vercel.app` comme domaine principal ; `app-vc-taupe.vercel.app` y renvoie en 307 (MCP `list_project_domains`). Il a corrigé `NEXTAUTH_URL` puis redéployé (`dpl_AyKob5yTqk6nHcpR5tGijfPKYbbB`, READY, variable modifiée avant ce déploiement d'après le MCP). Vérifié sans lire la valeur : `GET /api/auth/providers` rend `https://app-vc-emn.vercel.app/api/auth/callback/credentials`. Contrôles sans session rejoués sur la nouvelle adresse : 9 pages en 307, connexion et première connexion 200, 6 API en 401 JSON, 6 en-têtes. **Comptes** : le propriétaire s'est connecté lui-même par l'ancien identifiant ; l'agent a posé dans « Comptes » l'adresse `aparede@em-normandie.fr` (admin) et, à la demande du propriétaire (« une adresse test »), `test.gestionnaire+e9e9d2@em-normandie.fr` sur le compte `test` (gestionnaire), avec un suffixe tiré au hasard pour qu'elle ne se devine pas ; relu par le MCP : deux comptes `ACTIVE` avec adresse, version de session 0. **Écart, annoncé** : le compte de test n'est pas remis en première connexion (mémo §3.3), car tout porteur de l'adresse pourrait alors choisir son mot de passe ; il garde l'ancien. **Contrôles connectés** : `/admin/cron` affiche « Pilotage depuis le poste local » et « Backend local : absent (site en ligne) » ; `GET /api/admin/pipeline-status` rend `BACKEND_LOCAL_ONLY` ; `/admin/inbox` s'affiche (aucun ticket `Pending_Admin`) ; l'accueil montre 6 écoles, 13 campus, 51 programmes ; aucune ligne dans la console sur l'accueil, `/admin/schools`, `/admin/cron` et `/admin/inbox` (pas de violation CSP). **Mot de passe admin** : le propriétaire a répondu « fait », mais le relevé (MCP, empreinte courte du hachage) montre le même hachage sur `main` et sur `dev`, copiée avant : **pas changé** à ce relevé. **Fin d'étape** : 722 tests Python (+25), 900 TypeScript, typecheck propre, lint 0 erreur et 104 avertissements. **Docs** : mémo Vercel (état réel, §10 avec résultats), `CLAUDE.md` (en ligne, adresse, phase), README (adresse), ce plan (statut, cases). | **Au propriétaire** : changer son mot de passe sur « Mon compte » ; créer les secrets Actions du nouveau dépôt (en `emnormandie76`, valeurs de la **nouvelle** base, sans guillemets) et lire la CI ; ajouter les adresses de l'équipe (ou reporter, décision à consigner) ; valider l'étape. **Non rejoués en ligne** : le plafond de l'API v1 (60/min, exige une session ; Upstash est déjà prouvé par la connexion) et les journaux d'exécution (`get_runtime_logs` exige `teamId`, refusé en 403). Les 12 migrations ont été rejouées depuis une base vierge sur la nouvelle base : preuve ponctuelle, pas le test de CI du mémo §13, qui reste ouvert. |
| 2026-10-19 | 3 | **Restes du propriétaire faits** (« j'ai tout fait »), relus par le MCP (lecture) : mot de passe admin **changé** (l'empreinte courte du hachage n'est plus celle de `dev`) ; **un collègue ajouté**, passé `ADMIN` par le propriétaire, `ACTIVE`, première connexion faite : deux admins actifs. Secrets Actions du nouveau dépôt créés par le propriétaire ; sur la question de `NEXTAUTH_SECRET`, l'agent a recommandé une valeur **neuve**, distincte de celle de Vercel (la CI ne s'en sert pas ; la recopier multiplierait les copies de la clé des sessions). Le MCP GitHub répond toujours 404 sur le nouveau dépôt : la CI ne se lit que par le propriétaire. Cases de l'étape 3 toutes cochées. | **Validation du propriétaire.** Puis commit des docs (l'agent) et push (le propriétaire : le classifieur refuse à l'agent le push vers le nouveau dépôt) ; la CI de ce push est la première avec les nouveaux secrets : lire le journal de l'étape « statut des migrations » (hôte `ep-super-rain-zas6jyy2`, 12 migrations, « up to date »), non bloquante sur `gestion`. |
