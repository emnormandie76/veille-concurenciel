# Veille Concurrentiel (dépôt appVC)

**Gestionnaire de contenu** des données sur les écoles françaises : campus,
programmes, tarifs, classements, capacités d'accueil, accréditations et
statistiques. Des collègues de l'équipe (e-mails `@em-normandie.fr`) consultent
les données, des gestionnaires les tiennent à jour, des admins gèrent les
accès.

**Réorientation du 16 octobre 2026** (réunion de l'équipe) : le site doit
devenir utilisable en ligne, derrière une connexion obligatoire, avec trois
rôles. **La recherche IA est gelée** : le pipeline Tavily + Gemini et le
backend FastAPI restent tels quels, réservés à l'admin, sans nouveau
développement ni recette.

- **Next.js 16 sur Vercel** (offre Hobby) : site, API v1 et back-office de
  gestion de contenu. Il ne joint aucun backend : depuis l'étape 11, la console
  IA (`/admin/cron`), ses routes et le backend vivent sur la branche `local`
  (D100, D101) ; l'inbox reste en ligne.
- **Base Neon** partagée avec le backend gelé.
- **Le backend FastAPI (Python)** se lance à la main sur le poste de l'admin,
  pour l'IA seulement (décision du 14 octobre 2026), depuis la branche
  `local` (étape 11).
- **En ligne depuis le 19 octobre 2026** : <https://app-vc-emn.vercel.app>,
  sur les comptes de l'école (dépôt GitHub `emnormandie76/veille-concurenciel`,
  Vercel et Neon de l'école ; `Anton1P` ne fait que pousser : les commits
  sont signés au nom d'`emnormandie76` par le réglage Git local du dépôt,
  sans quoi Vercel bloque le déploiement, offre Hobby).

## Documents de référence

[`docs/README.md`](docs/README.md) range toute la documentation en deux
parties : gestion de contenu, IA gelée.

| Document | Rôle |
|---|---|
| [docs/features/gestion-contenu.md](docs/features/gestion-contenu.md) | **le plan en cours** : décisions (§2), pièges (§4), étapes (§5), journal (§9) |
| [docs/architecture/gestion-contenu.md](docs/architecture/gestion-contenu.md) | **l'état réel du code** du gestionnaire de contenu : rôles, gardes, écrans, routes, tables, styles, tests |
| [docs/architecture/charte-graphique.md](docs/architecture/charte-graphique.md) | **la charte graphique** (étape 4) : jetons, contrastes, polices, composants, gabarits, accessibilité, mise en œuvre (un seul monde depuis l'étape 9, lot 6) et historique de la reprise |
| [README.md](README.md) | démarrage, variables, commandes, points de sécurité |
| [docs/architecture/bdd.md](docs/architecture/bdd.md) · [API-rest.md](docs/architecture/API-rest.md) | schéma de la base (16 migrations, dont la provenance de chaque donnée, les signalements, le journal des lancements de l'IA et les admissions des programmes) · API v1 (15 routes, session exigée) |
| [docs/memory/memory-deploiement-vercel.md](docs/memory/memory-deploiement-vercel.md) | mise en ligne sur Vercel |
| [docs/cahier-des-charges-school-pipeline.md](docs/cahier-des-charges-school-pipeline.md) | exigences d'origine (l'en-tête renvoie au plan d'évolution) |
| [docs/architecture/architecture.md](docs/architecture/architecture.md) | référence technique v2.1, centrée sur le pipeline IA : pour les questions sur l'IA, la sécurité (§10) et l'outillage (§10 bis) |
| [docs/features/backend-local.md](docs/features/backend-local.md) | dernier chantier IA, **gelé** le 16 octobre ; son journal (§11) tient l'historique |
| [docs/edgecase.md](docs/edgecase.md) | cas limites et leurs parades |

## Phase en cours

Chantier « gestionnaire de contenu en ligne »
([docs/features/gestion-contenu.md](docs/features/gestion-contenu.md)), sur la
branche `gestion` :

- plan rédigé le 16 octobre 2026 à partir du doc « Plan d'évolution – School
  Data Pipeline » du propriétaire ; décisions G1 à G9 prises le même jour
  (trois rôles `USER`, `GESTIONNAIRE`, `ADMIN` ; liste blanche d'e-mails sans
  envoi d'e-mail ; API v1 derrière la connexion ; production = `main`
  rattrapée sur `gestion` ; Tailwind et refonte en deux temps ; IA réservée à
  l'admin) ;
- étape 0 (recentrage : branche, documentation) faite le 16 octobre et
  validée (le propriétaire demande le commit, le push et le prompt de
  l'étape 1) ;
- étape 1 (trois rôles, gardes, connexion obligatoire) faite le 16 octobre et
  validée (le propriétaire demande le commit, le push et le prompt de
  l'étape 2) : décisions D1 (rôle relu en base), D2
  (`/contribute` retirée), D18 (l'écran des comptes crée des `GESTIONNAIRE`),
  D19 (créations et suppressions du contenu au gestionnaire) ; migration
  `20261016120000_three_roles` appliquée sur la branche Neon `dev`, puis sur
  `main` le 19 octobre (étape 3) ; `npm run smoke` adapté et joué (vert) avec
  l'accord du propriétaire ;
- étape 2 (liste blanche, première connexion, écran des rôles) faite le
  16 octobre et validée (le propriétaire demande le commit, le push et le
  prompt de l'étape 3) : décisions D3
  (l'ancien identifiant ne vaut que pour un compte sans adresse), D4 (remise
  en première connexion, plus de mot de passe fixé pour un tiers), D5
  (domaine `@em-normandie.fr` imposé), D6 (nom affiché à la première
  connexion), D20 (un compte qui n'est plus actif perd sa session ; la lecture
  reste possible jusqu'à 8 h), D21 (un compte actif se désactive au lieu
  d'être supprimé) ; migration `20261016150000_whitelist_accounts` appliquée
  sur la branche Neon `dev`, puis sur `main` le 19 octobre (étape 3) ; smoke
  adapté et vert (la phase connectée, rejouée au début de l'étape 3) ;
- étape 3 (mise en ligne) faite et validée le 19 octobre (le propriétaire
  demande le commit et le push, `522d68e`, CI verte) ; **le site est en
  ligne** :
  smoke connecté vert ; décisions D7 (Hobby gardé, en connaissance de cause),
  D22 (préversions : base reliée à Production seulement), D23 (`preload` de
  HSTS gardé) ; `main` rattrapée sur `gestion` par avance rapide, sans PR
  (écart à G3, décision du propriétaire) ; hébergement déplacé sur les comptes
  de l'école (dépôt, Vercel, nouvelle base Neon où les données ont été
  copiées à l'identique) ; Upstash, projet `app-vc`, vérifications sans
  session et connectées, 429 de la connexion, adresses des deux comptes
  posées, mot de passe admin changé, un premier collègue, secrets Actions du
  nouveau dépôt créés. Détail : journal du plan ;
- étape 4 (charte graphique et composants de base) faite et validée le
  19 octobre (le propriétaire demande le commit, le push et le prompt de
  l'étape 5) : maquette A « Registre » choisie
  parmi trois, D8 (composants maison), D9 (clair, jetons prêts pour un
  sombre), périmètre avec « Mon compte » et le menu latéral actuel gardé ;
  Tailwind CSS v4 sans preflight, l'ancien CSS rangé dans la couche `legacy` ;
  charte dans `docs/architecture/charte-graphique.md` ; connexion, première
  connexion, « Comptes » et « Mon compte » repris ; contrôle CSP et visuel
  sur un build de production. Détail : journal du plan ;
- étape 5 (sources et auteur de chaque modification) faite et validée le
  20 octobre (le propriétaire demande le commit, le push et la fusion dans
  `main`) : décisions D10 (colonnes de dernière
  modification sur les neuf tables de données), D11 (l'auteur d'une donnée
  validée depuis l'inbox est l'admin qui valide, avec l'origine `MANUAL`,
  `AI` ou `REPORT`), D12 (lien source sur les chiffres clés, les
  accréditations et le programme), D24 (clé `RESTRICT` : un auteur ne se
  supprime pas, il se désactive, invités compris), D25 (« modifié par »
  affiche le nom seul ; revue le 20 octobre : l'API v1 ne rend que la date),
  D26 (fiches revalidées à chaque écriture), D27 (liens `http(s)` contrôlés à
  la saisie), D28 (ajouts à l'ancien style), D29 (le gestionnaire montre le
  nom et la date de chaque modification), D30 (pourcentages des chiffres clés
  à toutes décimales) ; migration
  `20261019120000_content_provenance` appliquée sur la branche Neon `dev` le
  20 octobre, puis sur `main` le même jour, avant la fusion de `gestion`
  dans `main` (mise en production) ; contrôles
  visuels de l'agent et du propriétaire. Détail : journal du plan ;
- étape 6 (formulaire de signalement) faite et validée le 20 octobre (le
  propriétaire demande le push, la fusion dans `main` et le prompt de
  l'étape 7) : décisions D13 (une table neuve,
  `ContentReport`, jamais l'inbox), D31 (écran `/admin/reports` à part de
  l'inbox), D32 (pas d'origine `REPORT` : une correction reste `MANUAL`),
  D33 (lien à l'ancien style sur les fiches, formulaire dans la charte),
  D34 (lien selon D27), D35 (10 signalements par heure et par compte),
  D36 (« Vos signalements » sur « Mon compte »), D37 (école supprimée :
  signalements supprimés ; campus ou programme : détachés), D38 (clés
  `RESTRICT` sur l'auteur et le traitant), D39 (le nom affiché seul) ;
  migration `20261020120000_content_reports` appliquée sur la branche Neon
  `dev` le 20 octobre, puis sur `main` le même jour, avant l'avance de
  `main` sur `gestion` (mise en production) ; contrôle visuel de l'agent dans le
  Chrome du propriétaire. Détail : journal du plan ;
- étape 7 (historique des recherches IA) faite et validée le 20 octobre (le
  propriétaire demande le commit et la fusion dans `main`) : décisions D14 (un journal des lancements
  tenu par Next.js seul, `ResearchLaunch` ; `PipelineJob` et le backend gelé
  intacts ; écart au texte du plan, qui prévoyait une colonne), D40 (passes
  dues : fenêtre de lancement, au plus N jobs), D41 (la trace d'abord : rien
  ne part sans trace), D42 (clé `RESTRICT`), D43 (une colonne « Lancé par »
  dans l'historique, rien d'autre), D44 (« non suivi »), D45 (ancien style),
  D46 (messages IA : rien à l'étape 7, liste consignée) ; migration
  `20261020150000_research_launches` appliquée sur la branche Neon `dev` le
  20 octobre, puis sur `main` le même jour, avant l'avance de `main` sur
  `gestion` (mise en production) ; contrôle visuel de l'agent dans le Chrome
  du propriétaire. Détail : journal du plan ;
- étape 8 (nouvelles données) faite et validée le 20 octobre (le
  propriétaire demande le commit, le push et la fusion dans `main`) : D15
  (les événements) **pas encore
  tranchée**, l'équipe ne les a pas confirmés : l'étape ne fait que l'année
  d'entrée ; D16 (une table fille, `ProgramEntry`), D47 (`admission_exam`
  reste tel quel), D48 (listes fermées), D49 (provenance de l'étape 5 et
  lien source), D50 (onglet « Admissions », routes par entrée), D51 (ancien
  style), D52 (catégorie de signalement `ADMISSIONS`), D53 (admissions
  imbriquées dans l'API v1) ; migration `20261020180000_program_entries`
  appliquée sur la branche Neon `dev` le 20 octobre, puis sur `main` le même
  jour, avant l'avance de `main` sur `gestion` (mise en production) ;
  contrôle visuel de l'agent dans le Chrome
  du propriétaire. Détail : journal du plan ;
- étape 9 (reprise graphique des écrans restants) **faite et validée, en six lots**,
  une session et une validation par lot (D54, écart au « une étape par
  session » du plan, décidé par le propriétaire) : D17 (extra high pour toute
  l'étape), D55 (contrôle visuel en deux temps quand la session tourne dans un
  conteneur cloud : Chromium sur une base Postgres jetable, puis le Chrome du
  propriétaire), D56 à D59 (émojis retirés, pas de « Back-office » sur les
  pages en cache, libellés visibles des recherches, exemples de code de
  `/api-docs` en clair) ; **lot 1** (site public et `/api-docs`) fait et
  validé le 20 octobre ; **lot 2** (liste des écoles, cadre de la gestion,
  campus, onglets Infos, Accréditations, Chiffres clés, Admissions) fait et
  validé le 20 octobre (le propriétaire demande le commit et le push sur
  `gestion`) : D60 (les quatre
  onglets du lot 3 dans un îlot sombre, hors du sous-arbre `.charte`), D61
  (`LastEdit` et les deux sélecteurs à la charte en place, copies à
  l'ancien style dans `manage/legacy/` jusqu'au lot 3), D62 à D67 (barre
  d'onglets, dialogue à la place de `confirm()`, case à cocher, libellés,
  tons des statuts, erreur dans la fenêtre) ; **lot 3** (onglets Campus &
  Programmes, Tarifs, Classements, Capacités ; l'îlot et `manage/legacy/`
  retirés) fait et validé le 21 octobre (le propriétaire demande le commit
  et le push sur `gestion`) : D68 (podium du classement en tons de catégorie), D69
  (interrupteurs d'un programme en cases à cocher), D70 (Tarifs : une vue à
  la fois), D71 (modification rapide des places au clavier, erreur sous le
  champ), D72 (lien « Source » en `http(s)`) ; le 21 octobre, sur le poste,
  relecture des lots 1 à 3 et contrôle dans le Chrome du propriétaire sur
  `dev` (D55, second temps) : trois défauts corrigés, D73 (titre des cartes
  écrasé par ses boutons), D74 (note d'un tarif sous ses montants), D75
  (l'accueil compte les programmes comme les fiches, `programs_count` de
  `/api/schools`), validés le 21 octobre (le propriétaire demande le commit
  et le push sur `gestion`, pas de mise en production). Détail : journal
  du plan ;
  **lot 4** (l'inbox, IA gelée : le style seulement) fait et validé le
  21 octobre, sur le poste (le propriétaire demande le commit et le push
  sur `gestion`, pas de mise en production) : D76
  (détail d'un ticket en dialogue collé à droite, `Dialog`
  `placement="side"`, clic à côté gardé), D77 (un ton de badge par état),
  D78 (✓, ✕, ⚠ retirés comme les émojis), D79 (liens en `http(s)`
  seulement, `sourceHref`), D80 (bandeau `Pending_AI` en « info ») ;
  requêtes, textes et identifiants gardés (`test/inbox-screen.test.ts`) ;
  contrôle dans le Chrome du propriétaire sur `dev`, en lecture seule,
  avec des tickets fictifs injectés dans l'onglet. Détail : journal du
  plan ;
  **lot 5** (`/admin/cron`, IA gelée : le style seulement) fait et validé
  le 21 octobre, sur le poste (le propriétaire demande le commit et le push
  sur `gestion`, pas de mise en production) : D46
  posée, D81 (« Réservé aux ADMIN » retiré, `isAdmin` gardé), D82
  (« Job #<id> » retiré), D83 (contributions gardées, l'inbox suit), D84
  (passe réelle confirmée dans le dialogue de la charte, texte figé, focus
  sur « Annuler »), D85 (bandeaux du backend : info et danger), D86
  (barres natives, `components/ui/ProgressBar.tsx`), D87 (un ton par état,
  `cron/cron-tones.ts`), D88 (quotas Tavily : bouton natif), D89 (phase en
  `aria-pressed`), D90 (détail d'un job sous sa ligne), D91 (école tronquée
  gardée) ; requêtes, textes et identifiants gardés
  (`test/cron-screen.test.ts`) ; contrôle dans le Chrome du propriétaire
  sur `dev`, en lecture seule, l'état du backend injecté dans l'onglet,
  tout POST bloqué. Détail : journal du plan ;
  **lot 6** (menu latéral et cadre du back-office ; preflight, nettoyage de
  `globals.css`, Inter) fait et validé le 21 octobre, sur le poste (le
  propriétaire demande le commit, le push et la mise en production :
  `main` avancée sur `gestion` (`be0c052`), **les lots 1 à 6 en
  production**, aucune migration, CI verte, déploiement Vercel READY) : D92
  (menu sombre sur `side-*`, filet
  de l'entrée choisie, focus en `side-ink`), D93 (texte seul, plus de
  champ `icon`), D94 (repliable sous 1 024 px, bouton « Menu »), D95 (le
  rôle en texte), D96 (la base sur le document, plus de classe `charte`),
  D97 (la couche `legacy` supprimée entière), D98 (contrôle dans une
  fenêtre Edge pilotée, profil temporaire, puis le Chrome du
  propriétaire) ; **un seul monde** : Tailwind entier, preflight compris,
  Inter retirée ; styles calculés des 15 écrans repris comparés avant et
  après, à 1 440 et 390 px ; les trois cases de l'étape 9 cochées, **étape 9
  validée**. Détail : journal du plan ;
- **replanifié le 21 octobre** (demande du propriétaire, D99 à D104) :
  ranger avant le guide. Étape 10 : deux corrections d'interface (le type
  d'une accréditation en français ; le lien « Back-office » dès la
  connexion, D104) ; étape 11 : une branche `local` garde la
  console IA et le backend (D100), qui quittent `gestion` et `main` (D101),
  l'inbox restant en ligne ; étape 12 : ne garder que `main`, `gestion` et
  `local`, sur le poste et `origin` (D102) ; étape 13 : nettoyage du
  contexte de chaque branche, inventaire puis validation (D103) ; étape 14 :
  le guide utilisateur, en dernier ;
- étape 10 (deux corrections d'interface) **faite et validée le
  21 octobre, sur le poste** (le propriétaire demande le commit et le push
  sur `gestion` ; en production le 22 octobre, avec l'étape 12) : D104 tranchée
  (un composant client dans la barre du site, `BackOfficeLink`, demande à
  `GET /api/admin/account/back-office`, en `guardSignedIn`, si le compte a
  accès au back-office ; la réponse gardée dans l'onglet, revérifiée à
  chaque page ; les pages gardent leur cache ; revient sur D57) ; le type
  d'une accréditation en français sur sa carte
  (`manage/accreditation-type.ts`) ; 61 méthodes sous `app/api/admin`
  (4 en `Session`) ; aucune migration ; contrôle dans une fenêtre Edge
  pilotée (D98) sur `dev`, en lecture seule, un `USER` simulé dans
  l'onglet. Détail : journal du plan ;
- étape 11 (séparer l'IA) **faite le 21 octobre, contrôlée et validée le
  22, sur le poste** (le propriétaire demande le commit et le push sur
  `gestion` ; en production le 22 octobre, avec l'étape 12) : la branche `local` créée depuis `e4ba0c5` et poussée
  sur `origin` (CI verte, aucun déploiement Vercel) ; sur `gestion`, la
  console (`/admin/cron`, « Monitoring & Cron »), ses cinq routes, le code
  de `lib/` qu'elles seules employaient, `backend/`, les tests Python,
  `pytest.ini`, `npm run backend`, `npm run local`,
  `scripts/start-local.ps1` et le job Python de la CI retirés ; l'inbox
  reste (bandeau `Pending_AI` gardé tel quel) ; D105 (`npm test` lance les
  tests TypeScript) ; un test TypeScript remplace la part de
  `test_contribution_enums.py` qui tient `lib/contribution.ts` contre la
  base ; `test/no-ai-backend.test.ts` verrouille la séparation ; 56 méthodes
  sous `app/api/admin` ; aucune migration. Détail : journal du plan ;
- étape 12 (le tri des branches, D102) **faite et validée le 22 octobre,
  sur le poste** (le propriétaire demande le commit, le push et la mise en
  production des étapes 10 à 12) : il ne reste que
  `main`, `gestion` et `local`, sur le poste et sur `origin` (accord du
  propriétaire pour `origin`) ; aucune des branches supprimées n'avait de
  commit hors de `gestion` ; la `newresearch` du poste, refusée par
  `git branch -d` (son amont `anton1p/newresearch` n'avait pas 8 de ses
  commits, tous dans `gestion`), supprimée par `-d` une fois ce lien coupé,
  sur décision du propriétaire ; la `main` du poste avancée sur
  `origin/main` ; le dépôt `Anton1P/veille-concurenciel` et le remote
  `anton1p` intacts ; la CI ne vise plus `devresearch` (piège 11) ; aucune
  migration. **Les étapes 10 à 12 en production le 22 octobre** : `main`
  avancée sur `gestion` (`0880308`) par avance rapide, CI verte, déploiement
  Vercel READY ; en ligne, le menu sans « Monitoring & Cron » et
  `/admin/cron` en 404. Détail : journal du plan ;
- prochaine : l'étape 13 (le nettoyage du contexte, D103), dans une
  nouvelle session ; D15 reste ouverte.

L'étape en cours se lit dans le journal du plan (§9).

## Partie IA gelée

État au gel (16 octobre 2026), détail dans le journal de
[`backend-local.md`](docs/features/backend-local.md) (§11) :

- étapes 0 à 8 du plan backend-local faites et validées : backend local,
  `DB_DRIVER=neon-ws`, plus de cron, passes dues sur demande
  (`POST /internal/run-due-passes`), `/admin/cron` en trois états,
  `npm run local`, tests des parties non couvertes, préparation de Vercel ;
- étape 9 (vérification de bout en bout) jouée et validée en l'état le
  15 octobre, **case non cochée** ; tâches C1 à C4 (crowdsourcing par la
  cascade Gemini) et « trois sources par ticket » poussées (`12b6bb3`,
  `423631e`) ; la recette de bout en bout qui devait cocher l'étape 9 est
  **abandonnée** par la réorientation ;
- les règles de dépense (règle 7) restent en vigueur : le code IA est
  toujours là, et lancer le backend paie toujours ;
- **depuis l'étape 11 (21 octobre)**, le code IA (le backend, ses tests
  Python, la console `/admin/cron` et ses routes, `npm run local`,
  `npm run backend`) vit sur la branche **`local`**, un instantané de
  `gestion` à la fin de l'étape 10 (`e4ba0c5`) ; `gestion` et `main` n'en
  gardent que l'inbox. On ne fusionne jamais `gestion` dans `local` (le
  retrait s'y appliquerait) : un correctif s'y reporte par `cherry-pick`.

## Règles pour tout agent

1. **Avant toute action**, lire dans le plan en cours
   ([gestion-contenu.md](docs/features/gestion-contenu.md)) le journal (§9),
   le mode d'emploi (§0), les pièges (§4) et la section de l'étape en cours,
   puis [architecture/gestion-contenu.md](docs/architecture/gestion-contenu.md).
   En fin de session, compléter le journal : ce qui est fait, ce qui reste, les
   surprises, les écarts au plan et leur raison.
2. **Une étape à la fois.** Ne pas commencer la suivante tant que les cases de
   l'étape ne sont pas cochées, que les tests ne sont pas verts **et** que le
   propriétaire n'a pas validé.
3. **Ce qui revient au propriétaire** : variables d'environnement, `DB_DRIVER`,
   variables Vercel, branche Neon, déploiement. S'arrêter, le guider pas à pas
   sans jamais lui demander de secret dans le chat, vérifier, puis consigner au
   journal.
4. **Ne pas s'écarter** du plan, de l'architecture ni du cahier des charges de
   sa propre initiative. En cas de doute ou de contradiction, exposer le
   problème avec deux options et une recommandation, puis consigner la décision
   au journal.
5. **Un test qui échoue** ne se désactive pas et ne s'affaiblit pas. Quand le
   propriétaire change une règle, l'attendu du test change avec elle, et le
   journal le dit (plan §0).
6. **En fin d'étape** :
   - `npm test`, `npm run test:ts`, `npm run typecheck`, `npm run lint`
     (sur `gestion`, `npm test` lance les tests TypeScript, D105 ; sur
     `local`, les tests Python) ;
   - mettre à jour les docs de contexte pour qu'elles décrivent ce que le code
     fait réellement (§8 du plan), à commencer par
     `docs/architecture/gestion-contenu.md` ;
   - faire un compte rendu.
7. **Dépenses réelles.** Aucun appel payant (Tavily, Gemini, Gemma) sans accord
   explicite du propriétaire, et les tests ne touchent jamais le réseau.
   - Une passe réelle ne part que par `POST /internal/run-due-passes` avec
     `dry_run: false`, et seulement avec l'accord du propriétaire. La
     simulation (`dry_run: true`) ne paie rien.
   - Lancer le backend suffit pourtant à dépenser : le traitement des
     contributions part dès le démarrage et paie Tavily, Gemini (et Gemma en
     dernier recours) s'il trouve des tickets `Pending_AI`. Le démarrage écrit aussi dans la base (reprise
     et purge des jobs). Pas de `uvicorn`, `npm run backend` ni
     `npm run local` sans l'accord du propriétaire.
   - Depuis l'étape 11, le backend et ces commandes n'existent que sur la
     branche `local` : sur `gestion` et `main`, aucune commande ne peut
     dépenser (`test/no-ai-backend.test.ts`).
   - Rien de nouveau ne doit créer de ticket `Pending_AI` (plan, piège 6).
8. **Base de données.** Jamais `prisma db push`, `prisma migrate dev` ni
   `prisma migrate reset`. Jamais de modification d'un `migration.sql` déjà
   appliqué, même un commentaire : son empreinte change. Jamais
   `prisma db seed` sur la base partagée, dont la branche `main` est aussi la
   production Vercel. Une nouvelle migration s'écrit à la main, se joue à
   blanc, puis sur la branche Neon `dev`, avec l'accord du propriétaire à
   chaque fois (plan §0).
9. **Sécurité** (README) :
   - connexion obligatoire sur tout le site (`proxy.ts`), sauf la page de
     connexion, la première connexion (`/admin/first-login`,
     `POST /api/first-login`) et `/api/auth/*` ; toute route posée sous
     `/api/auth/` devient publique d'office ; le proxy ne regarde que la
     session, jamais le rôle ; connexion et première connexion partagent un
     seul plafond ;
   - chaque route admin attend une seule garde de `lib/auth.ts` :
     `guardSignedIn` (toute session), `guardManager` (gestionnaire ou admin)
     ou `guardAdmin` ; le niveau de chaque route est dans
     `test/helpers/access-policy.ts` et
     `docs/architecture/gestion-contenu.md` §4 ; l'IA (inbox comprise) et les
     comptes sont en `guardAdmin` ; les écrans `/admin` passent par
     `requirePage` ; le rôle est relu en base à chaque requête (D1), jamais
     pris dans le jeton ; un compte qui n'est pas actif, ou dont la version
     de session a changé, n'a plus de session (D20) ; ce que chacun fait pour
     soi (« Mon compte ») et l'envoi d'un signalement (étape 6) sont en
     `guardSignedIn`, sans identifiant dans la route, l'auteur pris dans la
     session ; aucune opération ne laisse zéro admin actif
     (`lib/account-admin.ts`) ;
   - tout contenu externe injecté dans un prompt passe par `wrap_source()`
     (backend, branche `local`) ;
   - `user_text` n'atteint jamais un modèle d'IA (idem) ;
   - `lib/rate-limit.ts` est la seule limitation de débit.
10. **Partie IA gelée.** Ne modifier ni `backend/`, ni les routes et écrans IA,
    sauf ce qu'une étape du plan demande explicitement (plan §6). Depuis
    l'étape 11, ils vivent sur la branche `local` (D100, D101) : rien n'y
    change sans demande, jamais de fusion de `gestion` dans `local`, un
    correctif s'y reporte par `cherry-pick`. Sur `gestion`, l'inbox reste
    de l'IA gelée. Le backend de `local` partage la base : une colonne
    renommée ou rendue obligatoire le casse, et ses tests Python, sur
    `local`, ne le disent que si on les y lance ; toute colonne ajoutée à
    `PipelineJob` ou `ContributionInbox` accepte le vide.

## Modèle

Tout le projet se fait avec **Opus 5.5 en effort extra high** : réflexion,
architecture, code et revue. Si la session tourne sur un autre modèle ou un autre
niveau d'effort, le signaler à l'utilisateur en début de session. Pas
d'exception pour la reprise graphique (étape 9) : D17, tranchée par le
propriétaire le 20 octobre.

## Conventions

- Échanges et documentation en français.
- Code en anglais (variables, fonctions, fichiers) ; commentaires et docstrings
  en français, comme dans le code existant. Messages de commit en français, au
  format du dépôt : `feat(auth): …`, `fix(admin): …`.
- Textes de l'interface en français, avec vouvoiement.
- Le poste est sous Windows (Git Bash et PowerShell). L'interpréteur du backend
  (branche `local`) est `backend/.venv/Scripts/python`, et les scripts
  doivent tourner sous Windows.
- **Secrets** : `.env.local`, `.env.development.local` et `backend/.env`
  appartiennent au propriétaire. Ne jamais les lire, les afficher, les modifier
  ni les committer. La liste des variables est dans `.env.example`.
- Pas de commit ni de push sans demande explicite. Le propriétaire indique la
  branche de travail : aujourd'hui `gestion`, créée le 16 octobre 2026
  depuis `423631e` (alors la tête de `localpython`). Depuis l'étape 12
  (22 octobre, D102), le dépôt ne garde que trois branches, sur le poste
  comme sur `origin` : `main` (la production, avancée sur `gestion` par
  avance rapide), `gestion` (le travail) et `local` (la partie IA, depuis le
  21 octobre, `e4ba0c5`). Le remote `anton1p`
  (`Anton1P/veille-concurenciel`) est une sauvegarde figée : aucune commande
  vers lui ; `git fetch origin`, jamais `git fetch --all`, qui y reste
  bloqué (il demande des identifiants).
- Next.js 16 : lire `node_modules/next/dist/docs/` avant de toucher au front
  (voir le bloc en fin de fichier). `proxy.ts` tient lieu de middleware.
- Styles : la charte graphique
  ([`docs/architecture/charte-graphique.md`](docs/architecture/charte-graphique.md)),
  seule, depuis le lot 6 de l'étape 9 (D96, D97) : Tailwind CSS v4 entier,
  preflight compris (`app/globals.css` : l'import de Tailwind, la charte,
  et les `@source` `app/` et `components/`, rien d'autre) ; jetons et base
  du document dans `app/charte.css`, composants dans `components/ui/`,
  gabarits dans `components/layout/`, cadre du back-office dans
  `app/admin/layout.tsx` et `SidebarClient.tsx`. Tout écran s'y construit,
  dans son gabarit. Pas d'autre feuille de style, ni de bloc `styled-jsx`
  ou `<style>`, ni de couleur littérale, ni de `style` en ligne, ni d'émoji
  (D56) ; une classe écrite en clair est un utilitaire de la charte (test).
  Regarder un écran nouveau à 1 440 et à 390 px.

## Réseau du poste

Le réseau de l'établissement ne laisse sortir que les ports 80 et 443. Le port
5432 de Neon est fermé.

| Qui se connecte à Neon | État |
|---|---|
| Next.js (Prisma + `@neondatabase/serverless`, `lib/prisma.ts`) | marche, en WebSocket sur 443, sans lire `DB_DRIVER` |
| Migrations | CLI Prisma bloquée (5432). Avec `DB_DRIVER=neon-ws` dans `.env.development.local` (posée le 14/10/2026), `npm run db:status` et `npm run db:migrate` passent en WebSocket (`scripts/db-migrate.ts`) ; `db:status` vérifié le 14/10/2026 |
| Backend Python (psycopg2), branche `local` | avec `DB_DRIVER=neon-ws` dans `backend/.env` (posée le 14/10/2026), passe par le pont local `backend/neon_ws_bridge.py` (`127.0.0.1` → `wss://<hôte>/v2`) ; `get_pool()` vérifié le 14/10/2026. Sans la variable : 5432, donc bloqué |

## MCP Neon

Autorisé, sur le **projet de l'application uniquement**. Depuis le
19 octobre 2026, la base appartient au compte de l'école (étape 3 du plan,
journal) ; le MCP est connecté à ce compte :

- projet `vc-bdd`, id `noisy-credit-34683167`, dans l'organisation
  `org-long-unit-38729916` (« Vercel: EM-Normandie », gérée par le Vercel de
  l'école, compte `emnormandie76`) ; Postgres 18 ;
- branche `main`, id `br-late-water-za82d15h`, endpoint
  `ep-super-rain-zas6jyy2` : c'est aussi la **production Vercel** ;
- branche `dev`, id `br-odd-cloud-zao7fqra`, endpoint
  `ep-proud-lab-za705j3u`, créée depuis `main` le 19 octobre 2026 (données
  comprises) : essais, vérifications et migrations à blanc. **Cible par défaut
  des lectures**. Le poste vise `dev` ; bascule :
  `docs/testing/manual_testing_cron.md` §1.3 ;
- région `aws-eu-west-2` (endpoints en `c-2.eu-west-2.aws.neon.tech`).

Passer `project_id` **et** `branch_id` à chaque appel. Les autres projets que le
MCP peut voir appartiennent à d'autres applications : n'y faire aucun appel.
C'est le cas de `neon-bisque-pillar` (`gentle-thunder-89807010`) et de tout
projet d'un autre compte.

**L'ancienne base** (projet `lucky-cell-29057691`, organisation
`org-lively-cell-45152555`, gérée par le Vercel personnel d'`Anton1P` ;
branches `main` `ep-twilight-forest-ab9qjkm7` et `dev`
`ep-falling-breeze-abibnpc4`) reste en **sauvegarde figée** : ses données ont
été copiées le 19 octobre 2026, à l'identique. Plus rien n'y écrit, et le MCP
ne la voit plus.

| | Outils |
|---|---|
| **Permis sans demander** (lectures) | `run_sql` limité à des `SELECT` ; `get_database_tables`, `describe_table_schema`, `describe_project`, `list_branches`, `list_postgres_endpoints` |
| **Avec l'accord du propriétaire, à chaque fois** | toute écriture (`run_sql` ou `run_sql_transaction` qui modifie, `prepare_database_migration`, `complete_database_migration`) ; tout `delete_*` ; `create_branch`, `reset_from_parent`, `restore_snapshot` ; tout changement de réglage |
| **Jamais** | `get_connection_string`, `create_credential`, `rotate_credential`, `revoke_credential`, `reset_postgres_role_password` : ils rendent ou changent des secrets |

Le MCP sert à l'agent : il ne remplace pas la connexion de l'application, et
les migrations ne passent pas par lui.

## MCP Vercel

Branché le 14 octobre 2026 : serveur `vercel` de `.mcp.json`
(`https://mcp.vercel.com`), connexion par `/mcp`. Il sert à l'agent pour lire
l'état du déploiement ; il ne déploie pas à la place du propriétaire.

- **Compte** (depuis le 19 octobre 2026) : celui de l'école, créé avec le
  GitHub `emnormandie76` (utilisateur `BjIsUlzdkbYaOS6dBuc8YQpm`), offre
  Hobby, équipe `team_hWcs8vjorV4Dp3j3YhN7HL1w`. C'est le compte qui gère
  l'organisation Neon de la base. Le compte personnel d'`Anton1P`
  (`anton1ps-projects`) ne sert plus.
- **Projet de l'application** : `app-vc`, id
  `prj_x0D6x90ihnJnc86piYtt9fJXfNLM`, créé par le propriétaire le 19 octobre
  2026 depuis le compte de l'école (import du seul site Next.js, sans le
  backend) ; équipe `em-normandie1`. **Adresse du site :
  `https://app-vc-emn.vercel.app`**, domaine principal ajouté par le
  propriétaire le 19 octobre (c'est la valeur de `NEXTAUTH_URL`) ; l'adresse
  attribuée à la création, `https://app-vc-taupe.vercel.app`
  (`app-vc.vercel.app` était prise), y renvoie en 307.
  **Ne cibler que lui.** Deux essais d'import (`veille-concurenciel`, `vc`)
  ont été supprimés par le propriétaire le 19 octobre.
  Procédure :
  [docs/memory/memory-deploiement-vercel.md](docs/memory/memory-deploiement-vercel.md).
- Le projet visible aujourd'hui, `les-petits-pronos-de-la-promo`
  (`prj_yEjDnV9JJXXsVhHnyk6DZcrssT2Z`), appartient à une autre application :
  n'y faire aucun appel.
- **Portée de la connexion** (relevé du 19/10/2026) : les appels **sans**
  `teamId` passent ; tout appel **avec** `teamId` rend 403 (« scope
  em-normandie1 »). Les outils qui exigent `teamId`, comme `get_runtime_logs`,
  échoueront tant que le propriétaire ne se sera pas reconnecté par `/mcp` en
  accordant la portée de l'équipe `em-normandie1`.

| | Outils |
|---|---|
| **Permis sans demander** (lectures, sur le projet de l'application) | `list_projects`, `get_project`, `list_deployments`, `get_deployment`, `list_deployment_events`, `get_runtime_logs`, `get_runtime_errors`, `list_project_domains`, `filter_project_envs` **sans** `decrypt` (noms des variables seulement), `search_vercel_documentation` |
| **Avec l'accord du propriétaire, à chaque fois** | tout ce qui crée, modifie ou supprime : `create_project`, `update_project`, `create_deployment`, `cancel_deployment`, `request_promote`, `request_rollback`, `pause_project`, domaines, pare-feu, routes, redirections |
| **Jamais** | écrire une variable (`create_project_env`, `edit_project_env`) : les variables reviennent au propriétaire (règle 3), et `DB_DRIVER` ne se pose jamais sur Vercel ; lire une valeur (`get_project_env`, `get_shared_env_var`, `decrypt=true`) ; créer un jeton ou une clé (`create_edge_config_token`, `create_sdk_key`, `create_kms_*`) ; tout achat ou changement d'offre (`buy_domain`, `create_or_transfer_domain`) |

## MCP GitHub

Serveur `github` de `.mcp.json` (`https://api.githubcopilot.com/mcp/`,
outils `actions` et `repos`), authentifié par la variable Windows
`GITHUB_MCP_PAT` du propriétaire. Depuis le 19 octobre 2026, c'est un jeton
*fine-grained* du compte **`emnormandie76`**, limité au dépôt
`emnormandie76/veille-concurenciel` : Actions en lecture et écriture
(lire la CI, relancer un run), Contents en lecture seule. Il ne voit plus les
dépôts d'`Anton1P`. Permis sans demander : lire les runs, les jobs et leurs
journaux. Relancer ou annuler un run : avec l'accord du propriétaire. Le
code ne passe jamais par le MCP : commits et push par `git`.

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Next.js sur http://localhost:3000 (back-office : `/admin`) |
| `npm test` | les tests TypeScript, comme `npm run test:ts` (D105, étape 11). Sur la branche `local` : les tests Python (pytest), avec le `python` du `PATH`, et non `backend/.venv` (décision du 14/10/2026) |
| `npm run test:ts` | tests TypeScript (`node --test`), dont les routes de `test/api/` (banc : `test/helpers/`, requêtes relues contre le schéma Prisma) ; en CI, job `ts-tests` |
| `npm run typecheck` / `npm run lint` | types / ESLint (les avertissements sont la dette connue) |
| `npm run build` | `prisma generate` puis `next build` |
| `npm run smoke` | smoke local contre `npm run dev` : le mur sans session (pages renvoyées vers la connexion, `/api/schools` et 15 `GET /api/v1/*` en 401), puis, si `APPVC_ADMIN_PASSWORD` et `APPVC_ADMIN_EMAIL` (ou, tant que le compte n'a pas d'adresse, `APPVC_ADMIN_USERNAME`) sont posées, les pages et l'API connecté. Lecture seule. Lit la base visée : **accord du propriétaire requis**. Pas en CI |
| `npm run db:status` | état des migrations, en lecture seule : CLI Prisma sans `DB_DRIVER`, WebSocket avec `DB_DRIVER=neon-ws` |
| `npm run db:migrate` / `db:migrate:dry` | applique les migrations en attente / passe à blanc terminée par `ROLLBACK` (`neon-ws` seulement). Jamais sans l'accord du propriétaire |
| `npx prisma migrate status` / `deploy` | la CLI Prisma directe : exige le port 5432, fermé sur le réseau de l'établissement |
| `npm run local` / `npm run backend` | **branche `local` seulement** (IA, étape 11) : le backend FastAPI dans sa propre fenêtre puis Next.js (`scripts/start-local.ps1`) / le backend seul (`uvicorn` sur `127.0.0.1:8000`, sans `--reload`, jamais `--host 0.0.0.0`). **Lancent le backend : accord du propriétaire requis (règle 7)** |

@AGENTS.md
