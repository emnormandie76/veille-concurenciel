# Chantier — Le gestionnaire de contenu en ligne

> **Statut au 22 octobre 2026 :** plan rédigé le 16 octobre 2026, à partir du
> plan d'évolution de l'équipe (réunion du 16 octobre) et des réponses du
> propriétaire le même jour. **Étapes 0 à 13 faites, validées et en
> production** (le site est en ligne depuis le 19 octobre, sur les comptes de
> l'école ; `main` = `gestion`). L'étape 13 a nettoyé le contexte (D103) sur
> `gestion`, sur `local` et dans la mémoire de l'agent.
> **Ensuite** : l'étape 14, le guide utilisateur ; D15 (les événements des
> écoles) reste ouverte, en attente de l'équipe. Le détail de chaque étape est
> au §5, son histoire au journal (§9).
> **Branche de travail :** `gestion`, créée le 16 octobre 2026 (G2) ; la
> partie IA vit sur la branche `local` (D100).
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

**Migrations.** Chacune s'écrit à la main, additive autant que possible, se
joue à blanc, puis sur la branche Neon `dev`, puis sur `main` avant le code
qui la lit, **avec l'accord du propriétaire à chaque fois** : marche à suivre
dans [`bdd.md`](../architecture/bdd.md) §4. Toute colonne ajoutée à une table
que le backend Python écrit (`PipelineJob`, `ContributionInbox`) accepte le
vide ou a une valeur par défaut. La CI bloque une PR vers `main` tant que
`prisma migrate status` voit une migration en attente.

**La partie IA est gelée** (§6). Elle vit sur la branche `local` (D100,
D101) : on ne modifie ni `backend/`, ni les écrans et routes IA (sur
`gestion`, l'inbox), sauf ce qu'une étape du plan demande explicitement. Les
tests Python, sur `local`, protègent le backend gelé, qui partage la base.

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
| G1 | **IA gelée.** Code conservé tel quel ; ni développement ni recette ; réservée à l'admin. La recette de bout en bout de `backend-local.md` est abandonnée (étape 9 de ce plan non cochée). Les tests Python restent dans la CI comme filet. *Revu le 21 octobre (D101) : les tests Python vivent sur la branche `local`, avec le backend* | propriétaire |
| G2 | **Branche `gestion`**, depuis `localpython` (`423631e`). `localpython` est gardée en l'état. *Revu le 21 octobre (D102) : `localpython` supprimée à l'étape 12 (22 octobre), sur le poste et sur `origin` ; `423631e` reste dans l'histoire de `gestion`* | propriétaire |
| G3 | **Production Vercel = `main`**, rattrapée sur `gestion` à chaque version validée (PR, CI verte). Les préversions se font sur `gestion` (réglage : [mémo Vercel](../memory/memory-deploiement-vercel.md) §8) | propriétaire |
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
  admins ; les gestionnaires y voient les signalements (étape 6). *Revu le
  20 octobre (D31) : les signalements ont leur propre écran,
  `/admin/reports` ; l'inbox reste à l'admin et à l'IA ;*
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
| D22 | 3 | (question du mémo Vercel, aujourd'hui §8) Les préversions : base reliée à Production seulement, ou aussi à Preview avec *Preview Branching* | **Tranché le 16 octobre (recommandation retenue)** : **Production seulement**, Ignored Build Step sur « Only build production ». `gestion` se teste sur le poste contre la branche Neon `dev` (G3) : une préversion n'écrit jamais dans la production, et une branche de préversion copiée de la production n'aurait pas les migrations à venir, qui partent du poste |
| D23 | 3 | (question du mémo Vercel §7) `preload` dans l'en-tête `Strict-Transport-Security` | **Tranché le 16 octobre (recommandation retenue)** : **gardé tel quel**. Sur une adresse `*.vercel.app`, la directive n'a d'effet que si quelqu'un soumet le domaine à la liste de préchargement ; à revoir le jour d'un domaine propre |
| D8 | 4 | Bibliothèque de composants : shadcn/ui (Radix + Tailwind, copiés dans le dépôt) ou composants maison | **Tranché le 19 octobre (recommandation retenue) : composants maison**, sur les éléments natifs (`<dialog>`, `<select>`, `<table>`), comme dans les maquettes ; deux paquets seulement (Tailwind). shadcn/ui, sans preflight, exigeait une base globale (bordures, focus, fond) qui aurait touché les anciens écrans (piège 10), et seuls le dialogue, la liste déroulante et les onglets y gagnaient. Contrepartie acceptée : le clavier des onglets est écrit et testé dans le dépôt |
| D9 | 4 | Thème clair, sombre ou les deux (le site actuel est sombre seulement) | **Tranché le 19 octobre (recommandation retenue) : clair**, avec la maquette A « Registre ». Les couleurs restent des variables CSS lues par `@theme inline` : un thème sombre s'ajoutera plus tard sans toucher aux composants |
| D10 | 5 | Traçabilité : colonnes « dernière modification » ou historique complet des modifications | **Tranché le 19 octobre (recommandation retenue) : colonnes** `updated_by_id` (clé vers `User`), `updated_at` et l'origine (D11), facultatives, sur les neuf tables de données : `School`, `Campus`, `Program`, `PricingRecord`, `CapacityRecord`, `RankingRecord`, `SchoolStatsRecord`, `AccreditationRecord`, `ProgramCampusAttachment`. Ni `ProgramCampus` (une arête sans contenu propre : la changer, c'est modifier le programme), ni `ProgramPlacement` (aucun chemin d'écriture). Les lignes d'avant la migration restent « non suivies ». Limites acceptées : seule la dernière modification est connue, une suppression ne laisse pas de trace ; un historique complet plus tard, si l'équipe le demande |
| D11 | 5 | Données validées depuis un ticket IA : qui est l'auteur affiché | **Tranché le 19 octobre (recommandation retenue)** : le **validateur** (l'admin connecté), avec l'origine dans `updated_via` : `MANUAL` (saisie), `AI` (recherche IA validée), `REPORT` (signalement, réservé à l'étape 6), sous une contrainte `CHECK`. Couvre `validate`, `attachments` (lignes et note de campus) et `create-programs` ; une écriture qui ne change rien (un programme déjà là dans `create-programs`) laisse l'auteur en place |
| D12 | 5 | Où ajouter un lien source | **Tranché le 19 octobre (recommandation retenue)** : `source_url` facultatif sur `SchoolStatsRecord`, `AccreditationRecord` et `Program`, avec un champ dans les onglets Chiffres clés et Accréditations et dans le formulaire du programme ; la validation de l'inbox écrit le `source_url` que les tickets Chiffres clés et Accréditations portent déjà (jeté jusqu'ici). Rien sur `School` (le domaine officiel en tient lieu) ni sur `Campus` |
| D24 | 5 | (question née du code) Un compte remis en première connexion (D4) redevient invité, et un invité se retire : un auteur pouvait être supprimé | **Tranché le 19 octobre (recommandation retenue)** : `ON DELETE RESTRICT` sur `updated_by_id` : la base refuse de supprimer un compte qui figure comme auteur, et « Retirer » répond 409 (« désactivez-le ») ; « Désactiver » s'ouvre aussi aux invités (extension de D21), pour qu'un tel compte puisse être fermé. Le nom ne se perd jamais |
| D25 | 5 | (question née du code) Ce que « modifié par » affiche pour un compte désactivé | **Tranché le 19 octobre (recommandation retenue)** : **le nom seul**, quel que soit l'état du compte (D21 le garde pour ça) ; le nom affiché (`display_name`), sinon « Compte sans nom », jamais l'adresse ni l'ancien identifiant. **Revue le 20 octobre par le propriétaire** (option B, recommandée) : une donnée lue par l'API est tenue pour vérifiée ; l'**API v1** ne rend que la date (`updated_at`) et le lien source, ni le nom ni l'origine ; le nom sert au site et au gestionnaire |
| D26 | 5 | (piège 4) Le cache ISR d'une heure retarde « modifié par » | **Tranché le 19 octobre (recommandation retenue) : revalider à l'écriture** : après chaque écriture réussie du contenu, toutes les fiches école et programme et les routes `/api/schools/*` sont invalidées (`revalidatePath` en `layout`), régénérées à la visite suivante ; un échec de la revalidation est journalisé, il n'annule pas l'écriture |
| D27 | 5 | (question née du code) Un lien source saisi n'est contrôlé nulle part | **Tranché le 19 octobre (recommandation retenue) : contrôle à la saisie**, une règle pour toutes les saisies à la main (tarifs, places et classements compris) : vide, pas de lien ; sinon une adresse `http(s)` de 2 048 caractères au plus, sinon 400. À l'affichage, seul un lien `http(s)` est cliquable. Relevé du 19 octobre sur `dev` : les 56 liens existants sont en `http(s)` |
| D28 | 5 | (G7, question de style) Les nouveautés tombent dans des écrans restés à l'ancien style | **Tranché le 19 octobre (recommandation retenue) : l'ancien style, sur les motifs de chaque écran** (le champ « URL de la source » des tarifs, le lien « Source ↗ » des classements), sans règle ajoutée à `globals.css` ; le texte « Modifié par … le … » vient d'un module sans style, testé, que l'étape 9 reprendra. Écart limité à G7, accepté : un composant de la charte (claire, D9) ne tient pas le contraste sur un écran sombre, et ces écrans passent à la charte à l'étape 9 |
| D29 | 5 | (demande du propriétaire, 20 octobre) Montrer dans le gestionnaire qui a modifié chaque donnée, campus compris (le site ne montre un campus que par son nom) | **Tranché le 20 octobre** : **le nom et la date** (« Modifié par X le … »), sous chaque donnée des onglets de gestion et de la page des campus ; ni l'origine, ni l'adresse. L'agent recommandait d'y ajouter l'adresse et l'origine (un compte sans nom affiché reste « Compte sans nom ») ; le propriétaire a retenu le nom et la date |
| D30 | 5 | (défaut relevé au contrôle visuel) Les pourcentages des chiffres clés n'acceptaient qu'une décimale (`step="0.1"`), la base en tient à deux (49,46 pour Em Normandie) : le navigateur bloquait l'envoi | **Tranché le 20 octobre (recommandation retenue)** : **toutes les décimales** (`step="any"`), comme le serveur et la base ; corrigé dans l'étape 5, avec un test |
| D13 | 6 | Stockage des signalements | **Tranché le 20 octobre (recommandation retenue) : une table neuve, `ContentReport`**, pas `ContributionInbox` (le traitement IA gelé lit les tickets `Pending_AI` de l'inbox, et un mélange finirait en appel payant ; le mot « report » désigne déjà les rapports Research dans le code IA). Auteur, école, campus ou programme facultatif (l'un ou l'autre), nom de la cible à l'envoi, catégorie (huit, chacune liée à un onglet de gestion), message, lien facultatif, état `OPEN`, `RESOLVED` ou `REJECTED`, réponse du gestionnaire, qui a traité et quand, date d'envoi ; contraintes `CHECK` |
| D31 | 6 | (question née du code) Le §2.1 voulait les signalements dans l'inbox, réservée à l'admin et à l'IA gelée | **Tranché le 20 octobre (recommandation retenue) : un écran à part**, `/admin/reports` (« Signalements » dans le menu), niveau gestionnaire, dans la charte ; l'inbox, ses gardes et son écran ne changent pas (G1, règle 10). Écart au §2.1, consigné |
| D32 | 6 | (question née du code) Quand une donnée porte l'origine `REPORT` (D11), sans croire le corps de la requête | **Tranché le 20 octobre (recommandation retenue) : jamais à l'étape 6.** Une correction faite après un signalement reste `MANUAL` ; le lien se lit dans le signalement (traité par qui, quand, avec quelle réponse). Aucune route d'écriture ni aucun onglet ne change ; `REPORT` reste permis par la contrainte, sans servir. Écarté : un `report_id` renvoyé par les onglets et vérifié par le serveur (la cohérence se vérifie, l'intention non ; 21 routes et 7 onglets) |
| D33 | 6 | (G7, D28) Le bouton tombe dans des fiches restées à l'ancien style | **Tranché le 20 octobre (recommandation retenue)** : sur les fiches, « Signaler une information » est un **lien à l'ancien style** de la fiche ; il mène à une **page de la charte**, `/schools/[id]/report` (`SiteShell`), le programme présélectionné depuis sa fiche (`?program=`). Les fiches gardent leur cache ISR (elles ne lisent pas la session). Écarté : un dialogue de la charte dans la fiche sombre |
| D34 | 6 | (question née du code) Le lien facultatif : la règle D27, ou `isValidHttpsUrl` et `isPrivateHost` (`lib/utils.ts`), gardés pour ça | **Tranché le 20 octobre (recommandation retenue) : la règle D27** (`readSourceUrl`) ; cliquable dans la vue par `sourceHref` seulement. Aucun serveur n'ouvre ce lien (ni IA ni Tavily) : le contrôle des hôtes internes n'a plus d'objet. Les trois fonctions de `lib/utils.ts` restent sans appelant hors de leurs tests, laissées en place |
| D35 | 6 | (question née du code) Le plafond de débit du formulaire | **Tranché le 20 octobre (recommandation retenue) : 10 signalements par heure et par compte**, dans la route, après la garde (`checkRateLimit("report:<compte>", …)`, `lib/rate-limit.ts`), 429 avec `Retry-After` au-delà : par compte, parce que l'équipe sort par la même IP. Message de 10 à 2 000 caractères, réponse du gestionnaire de 1 000 au plus |
| D36 | 6 | (question née du code) Ce que l'auteur voit de la suite donnée | **Tranché le 20 octobre (recommandation retenue)** : une section **« Vos signalements » sur « Mon compte »**, lue par la page serveur, ses seuls signalements : date, cible, catégorie, état et réponse du gestionnaire. Aucune route en plus ; sans e-mail (G5), c'est le seul retour |
| D37 | 6 | (question née du code) Un signalement dont la cible est supprimée | **Tranché le 20 octobre (recommandation retenue)** : une école supprimée emporte ses signalements (`ON DELETE CASCADE`, comme toutes ses données) ; un campus ou un programme supprimé laisse le signalement à l'école (`ON DELETE SET NULL`), avec le nom gardé à l'envoi et la mention « supprimé » ; il reste traitable |
| D38 | 6 | (question née du code, D24) L'auteur d'un signalement, et celui qui l'a traité | **Tranché le 20 octobre (recommandation retenue)** : clés `ON DELETE RESTRICT`, comme D24 : un compte qui a envoyé ou traité un signalement ne se retire pas (« Retirer » répond 409, message élargi aux signalements), il se désactive ; ses signalements restent, traitables |
| D39 | 6 | (question née du code, D25, D29) Ce que le gestionnaire voit de l'auteur | **Tranché le 20 octobre (recommandation retenue) : le nom affiché seul**, jamais l'adresse ; la réponse passe par « Vos signalements » (D36) |
| D14 | 7 | Qui écrit « lancé par » sur `PipelineJob` | **Tranché le 20 octobre (recommandation de l'agent, revue à la lecture du code) : un journal des lancements, tenu par Next.js seul**, une table neuve (`ResearchLaunch`) : qui (la session), quand (l'heure de la base), quoi (le corps envoyé au backend), ce que le backend a répondu, et l'id du job rendu par une recherche ciblée. **`PipelineJob` n'est pas touchée**, ni le backend gelé. Écart au texte du plan (une colonne `PipelineJob.triggered_by_id`, écrite après la réponse) : la réponse des passes dues ne porte aucun id de job (leurs jobs naissent ensuite, un par un, dans un fil), et le backend purge une recherche ciblée Phase 2 au bout de 7 jours ; le journal couvre les deux lancements et survit à la purge. Écarté : la colonne |
| D40 | 7 | (question née du code) Les passes dues : la réponse 202 ne porte que le plan (nom de l'école, phase), et leurs jobs `rotation` naissent après la réponse | **Tranché le 20 octobre (recommandation retenue) : une fenêtre de lancement.** Le lancement réel s'écrit avant l'appel, à l'heure de la base ; les jobs `rotation` créés ensuite, jusqu'au lancement suivant qui a pu partir et au plus N (le nombre de passes demandé), lui sont attribués. Le verrou du backend (409 si une exécution réelle tourne) rend la fenêtre sûre ; un job hors fenêtre (appel direct au backend avec le jeton, ancien cron) reste « non suivi ». Une simulation n'est pas notée. Écarté : ne pas attribuer les passes dues |
| D41 | 7 | (question née du code) La recherche ciblée : une écriture de « lancé par » qui échoue, un job déjà fini | **Tranché le 20 octobre (recommandation retenue) : la trace d'abord.** Le lancement s'écrit avant l'appel au backend : si cette écriture échoue, rien ne part (500, aucune dépense sans trace). Après la réponse, Next.js y ajoute l'id du job, ou le refus ; si ce second temps échoue, la recherche est partie : la réponse du backend revient telle quelle, l'erreur est journalisée, le lancement reste « non relié » en base. Un job déjà fini ne change rien : on n'écrit jamais dans `PipelineJob`. Écarté : écrire après coup seulement |
| D42 | 7 | (question née du code, D24, D38) La clé du lanceur vers `User` | **Tranché le 20 octobre (recommandation retenue) : `ON DELETE RESTRICT`**, comme D24 et D38 : un compte qui a lancé une recherche ne se retire plus (« Retirer » répond 409, message élargi), il se désactive ; son nom reste dans l'historique. Écarté : `SET NULL` |
| D43 | 7 | (question née du code) La purge des jobs par le backend (7 jours pour une recherche ciblée Phase 2, 400 pour un passage complet ; edgecase 19 et 27) | **Tranché le 20 octobre (recommandation retenue) : une colonne « Lancé par » dans l'historique actuel**, rien d'autre. Un lancement dont le job est purgé reste dans le journal en base, lisible par le MCP, sans s'afficher. Écarté : une liste « Derniers lancements » en plus |
| D44 | 7 | (question née du code) Les jobs sans lanceur connu : d'avant la migration, ou lancés hors de l'écran | **Tranché le 20 octobre (recommandation retenue) : « non suivi »**, le mot de D10, avec une bulle au survol (lancé avant le suivi des lancements, ou hors de cet écran) ; jamais de devinette. Écarté : un tiret |
| D45 | 7 | (G7, D28) Le style de l'historique | **Tranché le 20 octobre (recommandation retenue) : l'ancien style** de `/admin/cron` jusqu'à l'étape 9, sans règle ajoutée à `globals.css` ; le texte vient d'un module sans style, testé. Écarté : la charte dès maintenant |
| D46 | 7 | (point facultatif de l'étape) Les messages inutiles de l'affichage IA | **Tranché le 20 octobre (recommandation retenue) : rien à l'étape 7.** Liste proposée, consignée pour plus tard : « Réservé aux ADMIN : une recherche paie Research » (branche morte, la page est réservée à l'admin, avec la prop `isAdmin`) ; « Job #<id> » (36 caractères) dans le message de lancement et sur les cartes des tâches en cours ; le bloc « Contributions du public » et la ligne « N contributions attendent… » (contribution abandonnée, G8, D2). Écarté : les retirer. **Reposée au lot 5 de l'étape 9 (21 octobre)** : D81 à D83 |
| D15 | 8 | Les événements des écoles (JPO, salons…) : à confirmer par l'équipe (« point d'interrogation à lever »), puis le modèle | **Pas encore tranché le 20 octobre** (le propriétaire, au début de l'étape 8) : l'équipe n'a pas confirmé les événements ; l'étape 8 ne fait que l'année d'entrée (D16). Reste à trancher le jour où l'équipe les confirme. La recommandation tient : une table `SchoolEvent` (type, titre, dates, campus facultatif, lien source) ; questions à poser alors : la liste des types, un jour ou un intervalle, avec ou sans heure, en ligne ou sur un campus, le sort des événements passés |
| D16 | 8 | L'année d'entrée d'un programme et le diplôme requis | **Tranché le 20 octobre (recommandation retenue) : une table fille, `ProgramEntry`**, une ligne par entrée possible : l'année du programme où l'on entre, le niveau requis, la voie, une note, un lien source ; un programme a souvent plusieurs entrées (post-bac en 1re année, Bac+2 en 3e année). `Program` n'est pas touchée (piège 5). Écarté : deux colonnes sur `Program` (une seule entrée par programme) |
| D47 | 8 | (question née du code) `Program.admission_exam` (le concours, en texte libre ; 9 programmes sur 46 sur `dev`) face à la voie d'une entrée | **Tranché le 20 octobre (recommandation retenue) : les entrées le complètent, il reste tel quel** : la validation de l'inbox l'écrit encore, l'API v1 le filtre (`?admission_exam=`), les fiches l'affichent. Écarté : le remplacer par les entrées (9 valeurs reprises à la main, un filtre de l'API qui change de sens, une valeur écrite par l'IA que personne ne verrait plus) |
| D48 | 8 | (question née du code) Les valeurs de l'année d'entrée, du niveau requis et de la voie | **Tranché le 20 octobre (recommandation retenue) : des listes fermées**, sous contraintes `CHECK`, avec un module de référence (`lib/program-entries.ts`), comme `lib/content-reports.ts` : année d'entrée de 1 à 5 ; niveau requis, un entier de 0 (Bac) à 5 (Bac+5) ; voie parmi `PARCOURSUP`, `EXAM` (concours), `TITLE` (admission sur titre), `INTERNATIONAL` (candidats internationaux), `UNSPECIFIED` (non précisée) ; le nom du concours et les précisions dans une note de 500 caractères au plus. Écarté : du texte libre (ni filtre ni tri fiables) |
| D49 | 8 | (question née du code, D10, D27) La provenance des entrées | **Tranché le 20 octobre (recommandation retenue) : comme les neuf tables** : `updated_by_id` (clé `RESTRICT` vers `User`, D24), `updated_at`, `updated_via`, avec les deux `CHECK` de l'étape 5, et `source_url` contrôlé par `readSourceUrl` (D27) ; l'auteur vient de la session, chaque écriture revalide les fiches (D26) ; « Modifié par … le … » sur la fiche et dans le gestionnaire. « Retirer » répond déjà 409 pour un auteur : ni la route ni son message ne changent. Écarté : le lien source seul |
| D50 | 8 | (question née du code) Où le gestionnaire saisit les entrées | **Tranché le 20 octobre (recommandation retenue) : un 8e onglet, « Admissions »**, avec le sélecteur de programme, comme Tarifs et Classements ; une carte par entrée (Modifier, Supprimer) ; des routes par entrée, au motif des classements (`schools/[id]/entries` : GET ; `programs/[id]/entries` : POST ; `program-entries/[id]` : PUT, DELETE ; `guardManager`), chacune gardant son auteur ; `?tab=admissions`. Écarté : une liste dans le formulaire du programme, envoyée avec lui (chaque enregistrement réécrirait toutes les entrées, et leur auteur) |
| D51 | 8 | (G7, D28) Le style de l'onglet et de la fiche | **Tranché le 20 octobre (recommandation retenue) : l'ancien style**, sur les motifs de l'écran où l'ajout tombe (cartes et fenêtre de l'onglet Accréditations ; section de la fiche programme avec `SourceLine`), sans règle ajoutée à `globals.css` ; le texte (« Entrée en 1re année avec le Bac, par Parcoursup ») vient d'un module sans style, testé ; l'étape 9 reprendra. Écarté : la charte (claire, D9) dans des écrans sombres |
| D52 | 8 | (question née du code, D13) Les signalements | **Tranché le 20 octobre (recommandation retenue) : une 9e catégorie, `ADMISSIONS`** (« Admissions »), reliée au nouvel onglet ; `ContentReport_category_check` est remplacée dans la migration de l'étape 8 (l'ancienne migration n'est pas touchée ; les lignes existantes tiennent la nouvelle contrainte ; le backend gelé ne lit pas `ContentReport`). Écarté : « Autre » |
| D53 | 8 | (question née du code, G6, D25 revue) L'API v1 | **Tranché le 20 octobre (recommandation retenue) : imbriquées**, un champ `entries` ajouté à `GET /api/v1/programs/[id]` et à `GET /api/v1/compare/programs`, avec la date seule pour la provenance (`updated_at`) et le lien source ; toujours 15 routes ; `/api-docs` dans le même lot (piège 9). Écarté : une route `programs/[id]/entries` (16 routes, et la comparaison sans les admissions) |
| D17 | 9 | Effort de raisonnement réduit pour la reprise graphique, mécanique (`CLAUDE.md` impose extra high partout) | **Tranché le 20 octobre (recommandation retenue) : Opus 5.5 en extra high pour toute l'étape**, comme `CLAUDE.md`. La reprise n'est pas mécanique : 393 `style` en ligne à traduire en jetons, comportements et identifiants à garder, dialogues natifs, écrans IA où seul le style change, attendus de tests à faire évoluer. Écarté : un effort réduit pour les lots de reprise simple |
| D54 | 9 | (question de l'étape) Le découpage : 28 fichiers à l'ancien style, 11 021 lignes, 393 `style` en ligne, 6 blocs `styled-jsx`, et les 2 016 lignes de `globals.css` | **Tranché le 20 octobre (recommandation retenue) : six lots, une session par lot**, chacun fini sur les quatre suites, le build, les docs, une ligne de journal, un compte rendu et la validation du propriétaire : **1** site public et `/api-docs` ; **2** liste des écoles, cadre de la gestion, page des campus, onglets Infos, Accréditations, Chiffres clés, Admissions ; **3** onglets Campus & Programmes, Tarifs, Classements, Capacités ; **4** inbox ; **5** `/admin/cron` ; **6** menu latéral et cadre du back-office, puis le preflight et le nettoyage de `globals.css` (classes mortes, règle `:has()`, base `.charte`, exclusions `block` et `fill-accent`, Inter). Les cases de l'étape ne se cochent qu'au lot 6. **Écart au §0** (« une étape par session »), décidé par le propriétaire. Écartés : quatre lots (gestion entière, inbox et cron ensemble) ; toute l'étape dans une session |
| D55 | 9 | (question née de l'environnement) La session du lot 1 tourne dans un conteneur cloud : ni le Chrome du propriétaire, ni la base `dev` depuis l'application, ni son port 3000 | **Tranché le 20 octobre (recommandation retenue) : le contrôle en deux temps.** Dans le conteneur : une base Postgres jetable (les migrations jouées sur elle seule, le contenu de `dev` copié par des `SELECT`, aucun compte copié, des comptes d'essai locaux), un build de production et Chromium : captures de chaque écran repris, styles calculés d'un écran voisin non repris comparés avec l'ancien code (`af1db58`), console sans violation CSP. Puis le contrôle du propriétaire dans son Chrome, sur `dev`, après un push sur `gestion` à sa demande (D22 : la production ne bouge pas). Écarté : le contrôle chez lui seulement |
| D56 | 9 | (question née du code, charte §1) Les émojis décoratifs des écrans à reprendre : 🎓 du logo, 📚 des onglets, 🎯 devant le concours, 🌐 devant le domaine, titres de section, icônes du menu | **Tranché le 20 octobre (recommandation retenue) : retirés, textes gardés**, comme à l'étape 4 ; une icône SVG cachée aux lecteurs d'écran là où elle aide (campus, lien externe). Vaut pour les six lots. Écarté : les garder (écart à la charte, dessin propre à chaque système) |
| D57 | 9 | (question née du code, D1, piège 4) `SiteShell` montre « Back-office » d'après la session relue en base ; l'accueil, les deux fiches (cache ISR) et `/api-docs` ne lisent pas la session, et leurs barres n'avaient pas ce lien | **Tranché le 20 octobre (recommandation retenue) : pas de lien sur ces quatre pages** (`showBackOffice={false}`) : le comportement d'avant, les fiches gardent leur cache, aucune lecture en base de plus ; le lien reste sur « Mon compte » et le formulaire de signalement. Écarté : lire la session (cache perdu, pages dynamiques). **Revue le 21 octobre par D104** (étape 10) : le lien sur toutes les pages, demandé par la barre |
| D58 | 9 | (question née du code, charte §6 et §8) Les champs de recherche de l'accueil et de `/api-docs` n'avaient qu'un texte indicatif | **Tranché le 20 octobre (recommandation retenue) : un libellé visible**, « Rechercher une école » et « Rechercher un endpoint », tiré du texte indicatif, qui reste tel quel. Deux textes visibles ajoutés. Écarté : un libellé lu par les lecteurs d'écran seulement |
| D59 | 9 | (question née du code, D9) Le panneau d'exemples de code de `/api-docs`, noir | **Tranché le 20 octobre (recommandation retenue) : clair, avec les composants** : onglets de la charte (`Tabs`) pour cURL, JavaScript et Python, code en Plex Mono sur `surface-2`, « Copier » en bouton secondaire ; aucun jeton nouveau. Écarté : un bloc sombre (jetons à créer, ou ceux du menu détournés) |
| D60 | 9 | (question née du code du lot 2, D54) L'écran de gestion d'une école est un seul écran : son cadre est au lot 2, quatre de ses huit onglets au lot 3. La base `.charte` est dans la couche `base`, au-dessus de `legacy` : un onglet de l'ancien style posé sous une racine `.charte` perdrait fonds de boutons, bordures et titres blancs ; à l'inverse, un cadre resté sombre ne tient pas, `.admin-content-area:has(.charte)` peignant toute la zone en clair dès qu'un onglet est dans la charte | **Tranché le 20 octobre (recommandation retenue) : un îlot sombre.** Le cadre passe à la charte (`AdminPage`, en-tête, `Tabs`, onglets du lot 2) ; le panneau d'un onglet du lot 3 se pose à côté du gabarit, hors du sous-arbre `.charte`, dans un petit fichier de transition à l'ancien style, hors des `@source`, qui lui rend son fond sombre et sa largeur ; les onglets du lot 3 ne changent pas (styles calculés comparés) ; l'îlot disparaît au lot 3. D54 inchangée. Écarté : avancer le lot 3 dans cette session (lots 2 et 3 fusionnés) |
| D61 | 9 | (question née du code du lot 2, D60) Trois pièces servent aux deux lots : `ProgramSelector` (Admissions ; Tarifs, Classements), `YearSelector` (Chiffres clés ; Tarifs, Classements, Capacités), `LastEdit` (tous les écrans de gestion) | **Tranché le 20 octobre (recommandation retenue) : la charte en place.** Les trois passent à la charte à leur chemin actuel ; une copie à l'ancien style, inchangée, dans `manage/legacy/`, sert les quatre onglets du lot 3 (seules leurs lignes d'import changent) jusqu'au lot 3, qui la supprime ; `manager-screens` accepte ce chemin pour ces quatre onglets seulement, pendant l'intervalle (attendu changé, consigné). Écarté : l'ancien en place et la charte sous de nouveaux chemins (aucun onglet du lot 3 touché, mais des chemins définitifs moins parlants) |
| D62 | 9 | (question du propriétaire, lot 2) La barre des 8 onglets de la gestion déborde | **Tranché le 20 octobre (recommandation retenue) : le composant `Tabs` tel quel, une ligne qui défile en largeur** quand l'écran est étroit, comme la maquette ; compteurs montrés seulement au-dessus de 0, comme avant. Écarté : une option « wrap » de `Tabs` (deux rangées) |
| D63 | 9 | (question du propriétaire, lot 2) Le `confirm()` de « Supprimer cette année » (Chiffres clés) | **Tranché le 20 octobre (recommandation retenue) : le dialogue de la charte**, comme la maquette A : titre « Supprimer les statistiques pour l'année … ? », boutons « Annuler » et « Supprimer cette année » ; aucun texte nouveau. Écarté : garder la fenêtre du navigateur |
| D64 | 9 | (question du propriétaire, lot 2) L'interrupteur « Statut de l'accréditation », une `div` cliquable, inaccessible au clavier | **Tranché le 20 octobre (recommandation retenue) : une case à cocher native**, « Accréditation encore active », dans un groupe dont la légende est « Statut de l'accréditation » ; le texte « Accréditation expirée / inactive » disparaît (la case vide le dit). Écarté : un bouton `role="switch"` gardant les deux textes |
| D65 | 9 | (question née du code du lot 2, D58) Trois champs sans libellé relié : la recherche de la liste des écoles, la nouvelle année et « Copier depuis : » du sélecteur d'année | **Tranché le 20 octobre (recommandation retenue) : des libellés visibles**, comme D58 : « Rechercher une école » (texte indicatif gardé), « Nouvelle année » (le texte du bouton) pour le champ d'année, « Copier depuis : » devient le libellé de sa liste. Un texte nouveau. Écarté : des libellés pour lecteurs d'écran seulement |
| D66 | 9 | (question née du code du lot 2) Le badge de statut d'une école : vert pour tout statut sur la liste ; ACTIVE et DRAFT en vert, INACTIVE en gris dans l'en-tête de la gestion | **Tranché le 20 octobre (recommandation retenue) : un ton par statut**, sur la liste comme dans l'en-tête : ACTIVE en réussite, INACTIVE en neutre, DRAFT en attente (avertissement) ; textes inchangés. Écarté : les tons d'avant |
| D67 | 9 | (question née du code du lot 2) Une fenêtre qui échoue (liste des écoles, campus, suppressions d'accréditations et d'admissions) affichait l'erreur sur la page, derrière la fenêtre restée ouverte | **Tranché le 20 octobre (recommandation retenue) : dans la fenêtre**, comme « Comptes » et « Signalements », annoncée (`role="alert"`) : avec un dialogue natif, la page est inerte et une erreur posée derrière n'est pas lue. Les erreurs de chargement restent sur la page ; textes inchangés. Écarté : sur la page, comme avant |
| D68 | 9 | (question du propriétaire, lot 3) Les médailles du classement (« 🥇 1er », « 🥈 2ème », « 🥉 3ème », sinon « #N ») : D56 retire les émojis ; le code tient déjà trois paliers de couleur (1 à 3 vert, 4 à 10 bleu, au-delà gris) | **Tranché le 21 octobre (recommandation retenue) : trois tons de catégorie** (charte §6 : un rang n'est pas un état) : le podium en `solid`, de 4 à 10 en `accent`, au-delà en `neutral` ; textes « 1er », « 2ème », « 3ème », « #N » inchangés. Écartés : le vert de l'ancien style au podium (une couleur d'état en décoration) ; le texte seul, sur un badge neutre |
| D69 | 9 | (question du propriétaire, lot 3) Les deux interrupteurs du formulaire d'un programme, des `div` cliquables sans clavier (« Possibilité d'alternance » : « Alternance possible » / « Pas d'alternance » ; « Expatriation obligatoire » : « Obligatoire » / « Optionnel / Non ») | **Tranché le 21 octobre (recommandation retenue) : D64 telle quelle** : deux groupes légendés « Possibilité d'alternance » et « Expatriation obligatoire », chacun avec une case native libellée « Alternance possible » et « Obligatoire » ; « Pas d'alternance » et « Optionnel / Non » disparaissent (la case vide le dit). Écarté : une case seule par champ, libellée par l'intitulé, sans groupe |
| D70 | 9 | (question du propriétaire, lot 3) L'onglet Tarifs : le code montre une vue à la fois (le tableau pour « Tous les programmes », la grille d'un programme seule, « ← Voir tous les programmes » pour revenir) ; la maquette A pose la grille sous le tableau, étiquetée « Vue détaillée, après « Éditer » » | **Tranché le 21 octobre (recommandation retenue) : une vue à la fois**, le comportement du code (la maquette empile les deux états pour les montrer) ; les libellés du code, pas ceux de la maquette. Écarté : la grille ouverte sous le tableau resté affiché |
| D71 | 9 | (question née du code du lot 3) La modification rapide des places (Capacités) : un `span` cliquable « N places ✏️ », sans clavier ; un champ en ligne sans libellé ; « ✓ » et « ✕ » sans nom ; deux `alert()` du navigateur pour les erreurs | **Tranché le 21 octobre (recommandation retenue) : accessible, le message sous le champ** : un bouton natif « N places » (le crayon part, la bulle « Cliquer pour modifier rapidement » reste) ; le champ nommé « Places disponibles » (le titre de sa colonne) pour les lecteurs d'écran ; « ✓ » et « ✕ » deviennent des boutons d'icône nommés « Enregistrer » et « Annuler » ; le focus revient au bouton à la fermeture ; les deux `alert()` deviennent un message sous le champ (`role="alert"`), mêmes textes ; Entrée et Échap inchangés. Écarté : garder les `alert()` |
| D72 | 9 | (question née du code du lot 3, D27) Le lien « Source » des classements et des capacités prenait l'adresse en base telle quelle ; Accréditations et Admissions passent par `sourceHref` | **Tranché le 21 octobre (recommandation retenue) : `sourceHref`, comme D27** : un lien `http(s)` devient « Source » avec l'icône de lien externe, en nouvel onglet (`noopener noreferrer`) ; sinon « — ». Aucun changement visible sur les données de `dev` (tous les liens y sont en `http(s)`, la saisie est contrôlée depuis l'étape 5). Écarté : le lien brut |
| D73 | 9 | (née du contrôle du propriétaire, 21 octobre, lot 2) Les cartes des onglets Accréditations et Admissions (et des campus, même motif) : « Modifier » et « Supprimer » (`shrink-0`) laissaient 80 px au titre sur une carte de 288 px ; « Conférence des Directeurs des Écoles Françaises de Management » sur 7 lignes, coupé au milieu d'un mot | **Tranché le 21 octobre (recommandation retenue) : les boutons sous un titre long** : l'en-tête de la carte passe à la ligne (`flex-wrap`), un titre court garde ses boutons à côté ; aucun texte changé. Écarté : les boutons toujours en pied de carte |
| D74 | 9 | (née du contrôle, lot 1) Le tableau des tarifs de la fiche programme : montants sur une ligne, le tableau débordait de 53 px et la colonne « Notes » tombait à 160 px ; une note de 1 287 caractères (Programme Grande École, Em Normandie) donnait une ligne de 1 150 px | **Tranché le 21 octobre (recommandation retenue) : la note sous la ligne**, sur toute la largeur (`colSpan`), précédée de « Notes : », chaque année et sa note dans un `TBody` ; la colonne « Notes » et son « — » disparaissent. Écartés : la note repliée (`details`) ; une colonne élargie |
| D75 | 9 | (née du contrôle, d'avant l'étape 9) L'accueil comptait les programmes à travers leurs campus : 51 pour 46 (un programme sur deux campus compté deux fois, un programme sans campus oublié) ; la carte d'Em Normandie disait 30 (sa fiche : 15), celle d'Em Lyon 14 (sa fiche : 24, dont 15 sans campus) | **Tranché le 21 octobre (recommandation retenue, en deux temps) : comme les fiches.** `/api/schools` rend `programs_count` (un `_count` Prisma, lecture seule, même garde), que lisent le bandeau et les cartes : 46, 24, 15. Le premier choix (« programmes distincts ») donnait 31 et 9 pour Em Lyon, loin de l'annonce « comme sa fiche » de l'agent : reposé au propriétaire, qui a retenu `programs_count`. Écarté : garder les programmes distincts rattachés à un campus |
| D76 | 9 | (question née du code du lot 4) Le panneau de détail d'un ticket de l'inbox : une fenêtre glissée depuis la droite (600 px, pleine hauteur), fermée par un clic à côté, sans Échap ni focus gardé | **Tranché le 21 octobre (recommandation retenue) : un panneau à droite**, dialogue natif collé au bord droit, pleine hauteur, 600 px, la liste visible derrière (une variante `side` de `Dialog`, testée) ; Échap, « Fermer » et un clic à côté le ferment (le clic à côté, comme avant, et de même pour la fenêtre de purge, refusé pendant une opération) ; focus gardé, puis rendu ; sans l'animation de glissement (charte §8 : des transitions de couleur seulement). Écarté : un dialogue centré et élargi, sans fermeture au clic à côté |
| D77 | 9 | (question née du code du lot 4) Les tons des statuts des tickets (`Pending_AI`, `Pending_Admin`, `Validated`, `Rejected`, `Failed`), de leurs alertes et de la correspondance d'un programme | **Tranché le 21 octobre (recommandation retenue) : un ton par état**, comme les signalements : `Pending_Admin` en `warning` (à l'admin d'agir), `Pending_AI` en `neutral` (il attend le backend), `Validated` en `success`, `Rejected` en `neutral`, `Failed` en `danger` ; « Année supposée » et « Nom incohérent » en `warning` (l'orange n'existe pas dans la charte), « Conflit » en `danger` ; la correspondance exacte en `success`, approximative en `warning`, absente en `danger` ; textes inchangés. Écarté : les teintes d'avant (`Pending_AI` jaune, `Pending_Admin` bleu, `Rejected` rouge) |
| D78 | 9 | (question née du code du lot 4) Les symboles ✓, ✕ et ⚠ en tête de textes (« ✓ Valider et publier — … », « ✕ Réinitialiser », « ⚠ Match approximatif », boutons « ✕ » seuls), que le test des émojis ne voit pas | **Tranché le 21 octobre (recommandation retenue) : retirés, comme les émojis (D56 étendue)** ; les boutons « ✕ » seuls deviennent des boutons d'icône nommés par leur bulle (« Supprimer ce programme », « Retirer cette ligne avant l'écriture »), comme D71 ; « Ticket validé ✓ », le message par défaut, perd son ✓ ; les flèches (« Examiner → », « ← Précédent ») et le « + » (« + Programme ») restent. Écarté : les garder |
| D79 | 9 | (question née du code du lot 4, D27, D72) Les liens de l'inbox : le prompt du lot les disait limités à http(s) ; le bloc « Sources » ne filtrait qu'un ticket du pipeline de plus de 3 liens, et la fiche d'un rattachement, la source d'une voie d'admission et celle d'une accréditation prenaient l'adresse brute | **Tranché le 21 octobre (recommandation retenue) : `sourceHref` aux quatre endroits** : un lien `http(s)` reste cliquable, en nouvel onglet (`noopener noreferrer`) ; une autre adresse s'affiche en texte. Relevé sur `dev` : 179 adresses de tickets et 33 `source_url` de leur JSON, toutes en `http(s)` : rien ne change à l'écran. Écarté : les adresses brutes |
| D80 | 9 | (question née du code du lot 4) Le bandeau jaune des contributions `Pending_AI` (« N contributions attendent… », bouton « Voir ») face aux trois tons du composant `Alert` | **Tranché le 21 octobre (recommandation retenue) : le ton `info`** (`role="status"`), aucun composant changé ; texte inchangé (son sort relève de D46, au lot 5 : gardé, D83). Écarté : un quatrième ton `warning` du composant |
| D81 | 9 | (D46 posée au lot 5, 1/3) « Réservé aux ADMIN : une recherche paie Research (crédits Tavily). », branche morte : la page exige le rôle (`requirePage("admin")`), `isAdmin` vaut toujours vrai | **Tranché le 21 octobre (recommandation retenue) : le texte part** ; la prop `isAdmin` et ses contrôles (`canLaunch`, `canRun`) restent, `page.tsx` inchangé. Écarté : le garder |
| D82 | 9 | (D46, 2/3) « Job #<id> » (36 caractères) dans le message de lancement d'une recherche et en pied des cartes des tâches en cours ; l'historique ne montre aucun identifiant de job | **Tranché le 21 octobre (recommandation retenue) : retiré** : le message garde « <message du backend> · rattachement campus : … » (Phase 1) ou le message seul (Phase 2) ; l'identifiant reste dans la réponse et dans les journaux du backend. Écarté : le garder en entier, en Plex Mono |
| D83 | 9 | (D46, 3/3) Le bloc « Contributions du public » et la ligne « N contributions attendent le traitement par le backend local. » (contribution abandonnée, G8, D2 ; 0 ticket `Pending_AI` sur `dev` comme sur `main` le 21 octobre) ; le bandeau de l'inbox reprend la ligne (D80) | **Tranché le 21 octobre (recommandation retenue) : gardés, textes inchangés** : le backend gelé traite encore au démarrage les tickets `Pending_AI`, et paie (règle 7) ; ce sont les seuls signaux de cette dépense à l'écran ; la ligne en message « info », comme D80. **L'inbox suit** : son bandeau reste. Écarté : les retirer, et le bandeau de l'inbox avec |
| D84 | 9 | (question née du code du lot 5, D63) Le lancement réel des passes dues, qui paie Research et Gemini, passait par `window.confirm()` | **Tranché le 21 octobre (recommandation retenue) : le dialogue de la charte** : titre « Lancer au plus N passes dues ? », les autres lignes de `confirmText` en paragraphes, boutons « Annuler » et « Lancer N passes dues » (le texte du bouton qui l'ouvre) ; le texte figé à l'ouverture (l'écran se rafraîchit toutes les 5 s : on confirme ce qu'on a lu) ; focus sur « Annuler » ; Échap et « Fermer » ne lancent rien ; même requête, partie seulement du bouton du dialogue, après sa fermeture. Aucun texte nouveau. Écarté : garder `window.confirm()` |
| D85 | 9 | (question née du code du lot 5, D80) Les bandeaux de l'état du backend (« Pilotage depuis le poste local » bleu, « Backend local non lancé » orange, « Backend injoignable » et les erreurs du démarrage rouges) face aux trois tons d'`Alert` | **Tranché le 21 octobre (recommandation retenue) : info, comme D80** : le poste local et « non lancé » (l'état habituel de l'écran sur le poste) en `info`, l'injoignable et les erreurs du démarrage en `danger` ; « Une tâche est déjà en cours pour cette école » en petit texte d'avertissement ; aucun composant changé. Écarté : un ton `warning` ajouté à `Alert` |
| D86 | 9 | (question née du code du lot 5) Trois barres de progression tenaient leur largeur par un `style` en ligne : la progression d'une tâche, les crédits du mois sur le plafond, l'usage de chaque clé Tavily | **Tranché le 21 octobre (recommandation retenue) : une barre native** : un composant de la charte, `ProgressBar` (`components/ui/`), sur `<progress>` (valeur, maximum, nommé par l'appelant), le ton sur la valeur avec les seuils d'avant (épuisé ou ≥ 100 % en `danger`, ≥ 75 % en `warning`, sinon `success`), la tâche en `accent` ; sans animation ; les chiffres restent écrits à côté. Écarté : les retirer, les chiffres seuls |
| D87 | 9 | (question née du code du lot 5, D77) Les tons des états : statut d'un job, badges des tâches en cours, mode des passes dues, « hors plafond », « N épuisée(s) » ; des pastilles colorées, dont deux pulsaient | **Tranché le 21 octobre (recommandation retenue) : un ton par état** (`app/admin/cron/cron-tones.ts`) : terminé `success`, échec `danger`, en file et en cours `neutral` (rien à faire, comme `Pending_AI` en D77) ; « sur demande » `neutral`, « plafond à 0 » et « hors plafond » `warning`, « N épuisée(s) » `danger` ; les pastilles partent (couleur seule, mouvement) ; textes inchangés. Écarté : les teintes d'avant |
| D88 | 9 | (question née du code du lot 5, D64, D71) L'en-tête des quotas Tavily, une `div role="button"` hors du clavier, et le corps ouvert par une animation de hauteur | **Tranché le 21 octobre (recommandation retenue) : un bouton natif** (`aria-expanded`, `aria-controls`), le corps caché par `hidden`, sans animation ; textes, badge, total et chevron gardés ; fermé par défaut, comme avant. Écarté : `<details>` et `<summary>` |
| D89 | 9 | (question née du code du lot 5) Le choix de la phase : deux boutons dont seul le style disait lequel était choisi | **Tranché le 21 octobre (recommandation retenue) : `aria-pressed`**, le choisi en accent ; aucun texte nouveau, même clavier. Écarté : un groupe de boutons radio légendé « Phase » |
| D90 | 9 | (question née du code du lot 5, D74) La colonne « Détail » de l'historique : l'aperçu de 300 caractères d'une erreur dans une colonne de 220 à 420 px ; sur `dev`, les 4 jobs sont en échec, erreurs de 1 475 à 1 649 caractères | **Tranché le 21 octobre (recommandation retenue) : sous la ligne, comme D74** : « Détail : … » (l'en-tête devenu préfixe) sur toute la largeur, sous les sept autres colonnes, chaque job dans son `TBody` ; rien sous la ligne quand il n'y a rien à dire (le « — » part) ; bulle du texte entier gardée. Écarté : garder la colonne |
| D91 | 9 | (question née du code du lot 5, D82) « — École 1a2b3c4d... » sur les cartes des passes dues en cours (les 8 premiers caractères de l'identifiant de l'école ; le backend ne donne pas son nom pour ces jobs) | **Tranché le 21 octobre (recommandation retenue) : gardé**, texte inchangé : seul repère de l'école sur la carte, hors de la liste de D46 ; le nom se lit dans l'historique. Écarté : le retirer |
| D92 | 9 | (question du lot 6, charte §2 et §3, maquette A) Le menu latéral du back-office : sombre sur les jetons `side-*`, prévus pour lui, ou clair comme la barre du site | **Tranché le 21 octobre (recommandation retenue) : sombre**, comme la maquette A : fond `side`, texte `side-ink`, secondaire `side-ink-2`, filets `side-line` ; l'entrée choisie en `side-active`, avec `aria-current="page"` et un filet à gauche (la couleur ne la dit pas seule) ; le focus du menu en `side-ink` : le bleu du focus n'y tiendrait que 2,0:1. Écarté : un menu clair (`surface`) |
| D93 | 9 | (question du lot 6, D56) Les émojis des entrées du menu (🏫 🚩 📬 ⚙️ 👥, 👤 et 🚪) | **Tranché le 21 octobre (recommandation retenue) : texte seul**, comme la maquette A ; le champ `icon` de `app/admin/nav.ts` disparaît (`admin-pages.test` ne lit que `href` et `level`). Écarté : une icône SVG cachée aux lecteurs d'écran devant chaque entrée |
| D94 | 9 | (question du lot 6) Le back-office sur un écran étroit : le menu fixe de 260 px contraignait tous ses écrans, inbox et `/admin/cron` compris | **Tranché le 21 octobre (recommandation retenue) : repliable**, comme la maquette A : sous 1 024 px, une barre sombre « School Data Pipeline » et un bouton « Menu » (`aria-expanded`, `aria-controls`) ; le menu s'ouvre sous la barre et pousse le contenu, sans calque ni piège à focus, et se referme quand la page change ; au-delà, une colonne de 240 px collée en haut de la fenêtre. Écarté : le menu toujours ouvert au-dessus du contenu |
| D95 | 9 | (question du lot 6, charte §6) Le rôle sous le nom (`ROLE_LABELS`), dans un badge de l'ancien style | **Tranché le 21 octobre (recommandation retenue) : en texte secondaire** (`side-ink-2`), comme la maquette A ; les initiales de l'avatar passent en `aria-hidden` (le nom suit), leur calcul ne change pas. Écarté : un badge de la charte (le ton `solid` se confond avec le fond sombre) |
| D96 | 9 | (question du lot 6, piège 10) Le preflight remplace la base limitée à `.charte` : où va ce qu'elle posait à sa racine (fond, encre, Plex Sans 14 px, interligne, lissage, `color-scheme`) | **Tranché le 21 octobre (recommandation retenue) : sur le document**, un seul monde : la base dans `app/charte.css` sur `html` et `body`, le focus visible et le curseur des boutons sur tout le document ; la classe `charte` quitte `SiteShell`, `AuthShell` et `AdminPage`. Les attendus « la racine porte la classe charte » (`charte.test`, `ui-components`) changent avec la règle. Écarté : garder la classe comme racine de la base |
| D97 | 9 | (question du lot 6) La couche `legacy` : ses 201 classes toutes mortes une fois le cadre et le menu repris, ses 21 variables lues par le seul bloc `styled-jsx` du menu | **Tranché le 21 octobre (recommandation retenue) : supprimée entière**, avec le nom de la couche, la règle de transition `:has()` et l'exclusion `block fill-accent` ; le body sombre, le `* { margin: 0; padding: 0 }` et les titres blancs sont remplacés par le preflight et la base ; le CSS compilé est comparé règle à règle, chaque règle partie listée. Écarté : garder les 21 variables, sans lecteur |
| D98 | 9 | (question du lot 6, D55) Le contrôle : les styles calculés des écrans repris avant et après le preflight, et la largeur de téléphone, jamais vue sur le poste (fenêtre de Chrome fixe, cadrage interdit) | **Tranché le 21 octobre (recommandation retenue) : une fenêtre Edge à part, pilotée**, profil temporaire dans le scratchpad, port de pilotage local ; le propriétaire s'y connecte lui-même ; un script relit les styles calculés de chaque écran à 1 440 et 390 px, avant puis après, compare et capture ; à la fin, fenêtre fermée et profil supprimé ; puis un coup d'œil dans le Chrome du propriétaire. `db:status`, puis `npm run dev` sur `dev`, en lecture seule. Écarté : le Chrome du propriétaire en mode appareil des DevTools |
| D99 | 10 à 14 | (demande du propriétaire, 21 octobre) L'ordre de la fin du chantier : le guide utilisateur d'abord, ou ranger avant | **Tranché le 21 octobre (demande du propriétaire) : ranger avant** ; quatre étapes s'insèrent (10 à 13), le guide devient l'étape 14, la dernière. Ordre retenu sur la recommandation de l'agent : les deux corrections d'interface d'abord, pour que la branche `local` les ait ; puis la séparation de l'IA, le tri des branches, le nettoyage du contexte (il décrit l'état final), le guide |
| D100 | 11 | (demande du propriétaire) La console IA (`/admin/cron`) en production : elle ne peut pas marcher sans le backend, lancé sur le poste seulement | **Tranché le 21 octobre (recommandation retenue, idée du propriétaire) : une branche `local`**, copie de `gestion` à la fin de l'étape 10, console et backend compris, lancée sur le poste ; sur `gestion` et `main`, la console et ses routes sont retirées, **l'inbox et la validation des tickets IA restent en ligne**. `local` est un instantané : on n'y fusionne jamais `gestion` (le retrait s'y appliquerait) ; un correctif s'y reporte par `cherry-pick`. Vercel ne la construit pas (préversions en « Only build production », mémo Vercel §8). Écarté : un interrupteur dans un seul code (la console cachée sans `FASTAPI_URL`) : aucune divergence, mais le code et le contexte de l'IA restaient sur `gestion` |
| D101 | 11 | Le backend Python (`backend/`, les tests Python, `npm run backend`, `npm run local`) sur `gestion` et `main`, une fois la console partie | **Tranché le 21 octobre (recommandation retenue) : retiré**, il ne vit plus que sur `local`. Sur `gestion`, plus aucune commande ne dépense de crédits ; la CI perd son job Python, un filet faible (un seul test Python lit le schéma, `test_contribution_enums.py`). `PipelineJob`, `ContributionInbox` et `ResearchLaunch` restent au schéma, sans migration : la base est partagée, et la règle « toute colonne ajoutée à une table que le backend écrit accepte le vide » reste écrite. Écarté : le garder (le plus petit changement, mais du code mort en production et un contexte qui parle encore de l'IA) |
| D102 | 12 | Le tri des branches : ne garder que `main`, `gestion` et `local` | **Tranché le 21 octobre (recommandation retenue) : le poste et `origin`** ; le dépôt `Anton1P/veille-concurenciel` (remote `anton1p`) reste tel quel, en sauvegarde figée, comme l'ancienne base Neon. Relevé du 21 octobre : aucune des branches à supprimer n'a de commit hors de `gestion` |
| D103 | 13 | La méthode du nettoyage du contexte (les documents qui gardent la trace des directions passées) | **Tranché le 21 octobre (recommandation retenue) : inventaire, puis validation** : un agent, en effort maximal, relève les documents de chaque branche et propose, fichier par fichier, de garder, réécrire ou supprimer ; le propriétaire valide ; l'agent applique. L'historique Git garde tout. Écarté : la suppression directe |
| D104 | 10 | (question née du code, revient sur D57) Le lien « Back-office » dès la connexion : l'accueil, les fiches et `/api-docs` ne lisent pas la session (cache ISR), le lien n'apparaît donc que sur « Mon compte » et le formulaire de signalement | **Tranché le 21 octobre (recommandation retenue) : un composant client dans la barre**, `BackOfficeLink`, qui demande à une route neuve, `GET /api/admin/account/back-office` (`guardSignedIn`, sans identifiant), si le compte, relu en base (D1), a accès au back-office ; la route ne rend que `{ backOffice: true \| false }`, en `private, no-store`. Les pages qui lisent déjà la session (« Mon compte », le signalement) le disent au gabarit, sans appel ; les autres gardent leur cache. Rien dans le HTML du serveur : rien n'apparaît puis disparaît pour un `USER`. **Sous-question, même série (recommandation retenue)** : la réponse est gardée en mémoire le temps de l'onglet et revérifiée à chaque page (un gestionnaire ne voit le lien arriver qu'au premier chargement) ; écarté : la demander à chaque page sans mémoire (le lien disparaissait puis revenait à chaque page). Écarté : les pages lisent la session (cache ISR perdu, `/api-docs` dynamique, une enveloppe serveur pour l'accueil) |
| D105 | 11 | Le sens de `npm test` une fois les tests Python partis de `gestion` (D101) | **Tranché le 21 octobre (recommandation retenue) : il lance les tests TypeScript** (`npm test` = `npm run test:ts`, l'usage d'un dépôt Node ; `test:ts` reste, la CI et la doc l'appellent ; la règle 6 reste vraie). Sur `local`, `npm test` lance toujours pytest. Écarté : le supprimer (npm répondrait « Missing script » ; la règle 6, le README et le §0 le perdaient) |
| D106 | 11 | (question née du code) Le bandeau des contributions `Pending_AI` de l'inbox, une fois la console partie : « … attendent le traitement par le backend local. Passage en `Pending_Admin` au prochain lancement du backend, sur le poste de l'admin. », sans lien vers `/admin/cron` | **Tranché le 21 octobre (recommandation retenue) : gardé tel quel**, toujours vrai (le backend se lance sur le poste de l'admin, depuis `local`) ; aucun texte de l'IA gelée ne bouge. Écarté : nommer la branche dans le texte |
| D107 | 11 | (question née du code) `test_contribution_enums.py` part avec le backend ; il tenait aussi les listes de `lib/contribution.ts` contre les contraintes `CHECK` de `ContributionInbox`, ce qu'aucun test TypeScript ne faisait | **Tranché le 21 octobre (recommandation retenue) : un test TypeScript** dans `test/contribution.test.ts` : statuts, catégories et origines contre la migration `20260902120000_inbox_relations_and_enum_guards`, seule à poser ces contraintes ; les catégories publiques incluses dans les autres, sans `Program_Discovery`. Écarté : pas de remplacement (rien ne tenait plus les listes de l'inbox contre la base, que `local` écrit toujours) |

---

## 3. État des lieux au départ

Le relevé du 16 octobre 2026 (deux rôles `ADMIN` et `MODERATOR`, une session
exigée sur `/admin/*` seulement, 38 méthodes du back-office en « toute
session », aucune traçabilité des modifications, l'ancien thème sombre de
`app/globals.css` ; 722 tests Python, 542 TypeScript, lint 109
avertissements) se lit dans l'historique Git :
`git show b123272:docs/features/gestion-contenu.md` (§3). L'état réel du code
est dans [`architecture/gestion-contenu.md`](../architecture/gestion-contenu.md).

---

## 4. Pièges connus

1. **`guardAuth` voulait dire « toute session ».** Un compte `USER` aurait pu
   écrire partout : les gardes ont changé à l'étape 1, tests d'abord, avant le
   premier compte `USER`. `guardAuth` n'existe plus, et
   `test/api/admin-guards.test.ts` le garde.
2. **Le proxy laisse entrer toute session** (`authorized: ({ token }) =>
   !!token`). Un `USER` ne doit pas voir `/admin` : le contrôle de rôle se fait
   côté serveur (`requirePage` dans le layout, une garde par route), pas
   seulement en masquant des liens.
3. **Le rôle copié dans le jeton y vivrait 8 h** : il est relu en base à
   chaque requête (D1).
4. **Pages publiques en cache ISR d'une heure** (`revalidate = 3600`). Le
   proxy passe avant le cache, donc le mur de connexion tient ; l'affichage
   « modifié par » serait en retard d'autant, d'où la revalidation à chaque
   écriture (D26).
5. **Le backend gelé partage la base.** Il écrit `PipelineJob` et
   `ContributionInbox`, et lit les tables de données (diff de la Phase 2).
   Renommer ou supprimer une colonne qu'il lit le casse sans bruit : ses
   tests, sur la branche `local`, le diront, à condition de les y lancer.
6. **Lancer le backend paie** dès qu'un ticket `Pending_AI` existe (règle 7 de
   `CLAUDE.md`). Rien dans ce plan ne doit créer de ticket `Pending_AI` (D13).
7. **Une contrainte `CHECK` se remplace par une nouvelle migration.** Celle de
   `User.role` (migration `20260902120000_inbox_relations_and_enum_guards`)
   refusait tout rôle hors `ADMIN` et `MODERATOR` : la migration
   `20261016120000_three_roles` l'a remplacée, sans toucher l'ancienne.
8. **Le banc de tests relit chaque requête du faux Prisma contre le vrai
   schéma** (`test/helpers/prisma-schema.ts`) : une colonne ajoutée au code sans
   l'être au schéma fait échouer les tests. C'est voulu.
9. **`/api-docs` et les titres de page sont verrouillés par des tests**
   (`test/api-docs.test.ts`, `test/page-titles.test.ts`) : toute route v1
   modifiée met `/api-docs` à jour dans le même commit.
10. **Tailwind et son « preflight ».** La remise à zéro des styles de base de
    Tailwind cassait les écrans à l'ancien style : Tailwind est resté sans
    preflight tant qu'ils existaient, jusqu'au lot 5 de l'étape 9 ; depuis le
    lot 6, tout est dans la charte et le preflight est actif (D96, D97). La CSP
    (`style-src 'self' 'unsafe-inline'`) ne bloque pas : Tailwind produit un
    fichier CSS statique au build.
11. **CI.** `prisma migrate status` bloque sur `main` et sur les PR vers `main`,
    pas sur `gestion` ni sur `local`. Le déclencheur `pull_request` ne vise
    que `main`.

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

### Étape 3 — Mise en ligne ✅ (19 octobre)

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
  gestionnaire ne voit pas l'IA. *Résultats : le relevé du 19 octobre, au
  §10 du mémo dans sa version de `b123272` (les contrôles à rejouer sont au
  §9 du mémo réécrit à l'étape 13). Les rôles sont tenus
  par les tests (matrice d'accès, menus) ; aucun compte `USER` n'existe en
  ligne ; le contrôle du gestionnaire en ligne a été proposé au propriétaire
  (réponse « fait », sans détail).*
- [x] Avant la mise en ligne, le propriétaire change le mot de passe du rôle
  Neon `neondb_owner` (recommandé le 15 octobre 2026) et ceux des comptes qui
  ont servi en développement (mémo de l'époque, §9, point 12). *`neondb_owner` : changé le
  19 octobre sur l'ancienne base ; sur la nouvelle base de l'école, le
  propriétaire a décidé de ne pas le changer (risque accepté, journal).
  Comptes : mot de passe admin changé par le propriétaire le 19 octobre
  (vérifié par l'empreinte, à la seconde tentative) ; le compte gestionnaire
  est un compte de test.*
- [x] Le propriétaire ajoute les premiers e-mails de l'équipe. *Un collègue
  le 19 octobre, mis `ADMIN` par le propriétaire, première connexion faite.*

**Docs :** mémo Vercel, `CLAUDE.md` (MCP Vercel : le projet), README.

### Étape 4 — Charte graphique et composants de base ✅ (19 octobre)

**Tranchées :** D8, D9, le choix de la maquette (A « Registre ») et le
périmètre (« Mon compte » compris, menu latéral gardé) (§2.2, journal).

- [x] Deux ou trois maquettes (artefacts HTML en Tailwind) : un écran public
  (fiche école), un écran du back-office (onglet de gestion), la connexion.
  *Trois, aux données réelles de `dev`, avec une planche des composants.*
- [x] Le propriétaire choisit ; la charte est consignée dans
  `docs/architecture/charte-graphique.md` (couleurs, polices, espacements,
  composants, règles d'accessibilité).
- [x] Tailwind CSS v4 installé **sans preflight** (piège 10) ; les jetons de la
  charte en `@theme`. *`tailwindcss` et `@tailwindcss/postcss` 4.3.3 ; l'ancien
  CSS rangé, inchangé, dans la couche `legacy`.*
- [x] Composants de base (bouton, champ, liste déroulante, tableau, carte,
  onglets, badge, dialogue, message d'erreur) et deux gabarits de page
  (site, back-office). *`components/ui/`, `components/layout/` ; plus le
  gabarit des pages de connexion.*
- [x] Appliqués d'abord aux écrans nés aux étapes 1 et 2 (connexion, première
  connexion, utilisateurs). *Et « Mon compte », à la demande du propriétaire.*
- [x] Contrôle CSP sur un build de production ; tests, typecheck, lint verts.
- [x] Validation du propriétaire (19 octobre : commit, push et prompt de
  l'étape 5 demandés).

**Docs :** `charte-graphique.md`, `architecture/gestion-contenu.md` (styles),
`architecture.md` §10 bis (outillage).

### Étape 5 — Sources et auteur de chaque modification ✅ (20 octobre)

**Tranchées :** D10, D11, D12, et D24 à D28, nées du code (§2.2, journal).

- [x] Migration : `updated_by_id`, `updated_at` (et l'origine, selon D11) sur
  les tables de données ; liens source ajoutés selon D12. Colonnes
  facultatives (piège 5). *`20261019120000_content_provenance`, écrite à la
  main, sur les neuf tables, clé `RESTRICT` (D24) ; à blanc puis sur `dev` le
  20 octobre, avec l'accord du propriétaire à chaque fois ; `main` à la
  prochaine mise en production.*
- [x] Toutes les écritures les renseignent : routes de gestion, validation de
  l'inbox (`app/api/admin/inbox/[id]/validate`). *Et `attachments`,
  `create-programs` (D11) ; l'auteur vient de la session, jamais du corps ;
  fiches revalidées après chaque écriture (D26).*
- [x] Champs « lien source » dans les onglets de gestion. *Chiffres clés,
  accréditations, programme (tarifs, places et classements l'avaient) ; une
  adresse `http(s)` contrôlée par le serveur (D27).*
- [x] Affichage côté utilisateur, comme le classement aujourd'hui : la source
  et « modifié par … le … » sur chaque donnée ; piège 4 (cache).
  *`SourceLine` sur les fiches école et programme, à l'ancien style (D28) ;
  revalidation à l'écriture (D26). Un campus n'a sa provenance que dans
  l'API, la fiche ne montrant que son nom.*
- [x] API v1 : les mêmes informations, `/api-docs` à jour (piège 9). *15
  routes, enregistrements imbriqués compris ; depuis le 20 octobre, la date
  et le lien source seulement (D25 revue).*
- [x] *Ajout du 20 octobre (D29, D30)* : « Modifié par … le … » sous chaque
  donnée du gestionnaire, campus compris ; pourcentages des chiffres clés à
  toutes décimales.
- [x] Tests, typecheck, lint verts. *Et un contrôle visuel dans le Chrome du
  propriétaire, sur `dev`.*
- [x] Validation du propriétaire (20 octobre : contrôle fait par lui dans le
  gestionnaire ; documentation, commit, push et fusion dans `main` demandés).

**Docs :** `bdd.md`, `API-rest.md`, `architecture/gestion-contenu.md` ; *et le
mémo Vercel (§3.1 : la migration sur `main`).*

### Étape 6 — Formulaire de signalement ✅ (20 octobre)

**Tranchées :** D13, et D31 à D39, nées du code (§2.2, journal).

- [x] Migration : la table des signalements (auteur, cible école, campus ou
  programme, catégorie, message, lien facultatif, statut, dates).
  *`20261020120000_content_reports` : `ContentReport`, écrite à la main,
  additive (une table neuve, 3 index, 5 clés, 7 contraintes `CHECK`) ; relevé
  en lecture, à blanc, puis sur `dev` le 20 octobre, avec l'accord du
  propriétaire à chaque fois ; puis sur `main` le même jour, avant la fusion.*
- [x] Un bouton « Signaler une information » sur les fiches, ouvert à tout
  connecté ; plafond de débit (`lib/rate-limit.ts`, seule limitation du
  projet).
  *Lien à l'ancien style sur les fiches école et programme (D33), page
  `/schools/[id]/report` dans la charte, `POST /api/admin/reports` en
  `guardSignedIn` ; 10 envois par heure et par compte (D35).*
- [x] Vue des signalements pour les gestionnaires : traiter, rejeter, avec
  lien vers l'onglet de gestion concerné.
  *`/admin/reports` (D31), dans la charte, à part de l'inbox ; l'écran de
  gestion ouvre l'onglet demandé (`?tab=`) ; l'auteur suit la suite sur
  « Mon compte » (D36).*
- [x] Aucun modèle d'IA, aucun ticket `Pending_AI` (piège 6).
  *`test/no-public-tickets.test.ts` vert ; les tests des routes vérifient
  qu'aucun appel ne touche `ContributionInbox`.*
- [x] Tests, typecheck, lint verts. *Et un contrôle visuel dans le Chrome du
  propriétaire, sur `dev`.*
- [x] Validation du propriétaire (20 octobre : push, fusion dans `main` et
  prompt de l'étape 7 demandés).

**Docs :** `bdd.md`, `architecture/gestion-contenu.md`, `edgecase.md`
(abus du formulaire) ; *et `charte-graphique.md` (onglets, dialogue,
sources), le README (sécurité), le mémo Vercel (§3.1 : la migration attend
`main`), `CLAUDE.md`.*

### Étape 7 — Historique des recherches IA ✅ (20 octobre)

**Tranchées :** D14, et D40 à D46, nées du code (§2.2, journal).

- [x] Migration : `PipelineJob.triggered_by_id`, facultatif (le backend gelé
  écrit la table sans le connaître). *Remplacée par une table neuve (D14) :
  `20261020150000_research_launches`, `ResearchLaunch`, écrite à la main,
  additive (2 index, 1 clé `RESTRICT` vers `User`, 6 contraintes `CHECK`,
  `launched_at` à l'heure de la base) ; `PipelineJob` intacte. Relevé en
  lecture, à blanc, puis sur `dev` le 20 octobre, avec l'accord du
  propriétaire à chaque fois ; puis sur `main` le même jour, avant la
  fusion.*
- [x] Les routes `trigger-research` et `run-due-passes` l'écrivent. *Au
  journal, avant l'appel au backend, au nom de la session ; rien ne part si
  l'écriture échoue ; l'issue ensuite (D41). Une simulation ne s'écrit pas.*
- [x] L'historique de `/admin/cron` affiche qui a lancé chaque recherche.
  *Colonne « Lancé par » (D43), à l'ancien style (D45) : une recherche ciblée
  par l'id de son job, une passe due par la fenêtre de son lancement (D40),
  sinon « non suivi » et sa raison au survol (D44).*
- [ ] *Facultatif, priorité faible, si le propriétaire le demande :* retirer
  les messages inutiles de l'affichage IA (liste à établir avec lui).
  *Non fait (D46) : liste proposée et consignée au §2.2.*
- [x] Tests TypeScript et Python verts. *Et typecheck, lint, build de
  production, contrôle visuel sur `dev`.*
- [x] Validation du propriétaire (20 octobre : commit et fusion dans `main`
  demandés).

**Docs :** `bdd.md`, `architecture/gestion-contenu.md` ; *et `architecture.md`
(§2.3, une note), `CLAUDE.md`.*

### Étape 8 — Nouvelles données : événements, année d'entrée ✅ (20 octobre, année d'entrée seulement)

**Tranchées :** D16, et D47 à D53, nées du code (§2.2, journal). **D15
(événements) pas encore tranchée** : l'équipe ne les a pas confirmés ;
l'étape 8 ne fait que l'année d'entrée.

- [x] Migrations, onglets de gestion, affichage sur les fiches, API v1 et
  `/api-docs`, avec sources et auteur (étape 5). *L'année d'entrée
  seulement (D15 pas tranchée) : `20261020180000_program_entries`, écrite à
  la main, additive (`ProgramEntry`, et la contrainte des catégories de
  signalement élargie, D52) ; relevé en lecture, à blanc, puis sur `dev` le
  20 octobre, avec l'accord du propriétaire à chaque fois ; sur `main` le
  même jour, avant la mise en production. Onglet « Admissions » (D50,
  D51), section « Admissions » de la fiche programme, `entries` dans le détail d'un
  programme et la comparaison (D53), `/api-docs` dans le même lot ;
  provenance et lien source (D49).*
- [x] Le doc « Données stockées sur les écoles » mis à jour avec le
  propriétaire. *Sous-section « Admissions (par programme) » et une ligne au
  schéma ; trois points périmés corrigés à sa demande (les voies d'arrivée
  des données, la page source des chiffres clés et des accréditations,
  « Modifié par … le … ») ; date du 20 octobre.*
- [x] Tests, typecheck, lint verts. *Et build de production, contrôle visuel
  sur `dev`.*
- [x] Validation du propriétaire (20 octobre : commit, push et fusion dans
  `main` demandés).
- *Les événements (D15) restent à faire le jour où l'équipe les confirme.*

**Docs :** `bdd.md`, `API-rest.md`, `architecture/gestion-contenu.md` ; *et
`CLAUDE.md`, `edgecase.md` (cas 42 : neuf catégories), mémo Vercel (§3.1 :
la migration sur `main`).*

### Étape 9 — Reprise graphique des écrans restants ✅ (21 octobre)

**Tranchées :** D17, D54 (six lots, une session par lot), D55 (contrôle
visuel en deux temps), D56 à D59, nées du code du lot 1, D60 à D67, nées
du code du lot 2, D68 à D72, nées du code du lot 3, D73 à D75, nées du
contrôle du propriétaire le 21 octobre, D76 à D80, nées du code du lot 4,
D81 à D91, nées du code du lot 5 (dont D81 à D83 : D46 posée), et D92 à
D98, nées du code du lot 6 (§2.2, journal).

| Lot | Écrans | État |
|---|---|---|
| 1 | site public : accueil, fiches école et programme ; `/api-docs` | fait et validé le 20 octobre |
| 2 | liste des écoles, cadre de la gestion, page des campus, onglets Infos, Accréditations, Chiffres clés, Admissions | fait et validé le 20 octobre |
| 3 | onglets Campus & Programmes, Tarifs, Classements, Capacités ; retirer l'îlot et `manage/legacy/` (D60, D61) | fait et validé le 21 octobre |
| 4 | inbox (IA gelée : le style seulement ; D76 à D80) | fait et validé le 21 octobre |
| 5 | `/admin/cron` (IA gelée : le style seulement ; D46 posée : D81 à D83 ; D84 à D91) | fait et validé le 21 octobre |
| 6 | menu latéral et cadre du back-office ; preflight, nettoyage de `globals.css`, Inter (D92 à D98) | fait et validé le 21 octobre |

- [x] Chaque écran encore dans l'ancien style passe aux composants (site
  public, `/api-docs`, inbox, `/admin/cron`, onglets restants).
  *Lot 1 : le site public et `/api-docs` (20 octobre) ; lot 2 : la gestion
  des écoles, sauf quatre onglets (20 octobre) ; lot 3 : les quatre onglets
  restants (21 octobre) ; lot 4 : l'inbox (21 octobre) ; lot 5 :
  `/admin/cron` (21 octobre) ; lot 6 : le menu latéral et le cadre du
  back-office (21 octobre, D92 à D95) : plus aucun écran à l'ancien style.*
- [x] Preflight Tailwind activé ; les classes mortes de `globals.css`
  supprimées. *Lot 6 (21 octobre) : Tailwind entier, la base de la charte
  sur le document (D96) ; la couche `legacy` supprimée entière, ses 201
  classes, ses variables et ses règles d'éléments (D97), avec la règle de
  transition `:has()`, l'exclusion `block fill-accent` et Inter.*
- [x] Contrôle CSP et contrôle visuel de chaque écran ; tests, typecheck, lint
  verts. *Lots 1 à 3 : faits dans le conteneur (D55), puis dans le Chrome
  du propriétaire sur `dev` le 21 octobre (sauf la largeur de téléphone,
  faite dans le conteneur) ; trois défauts relevés et corrigés (D73 à D75).
  Lot 4 : sur le poste, CSS compilé comparé, build de production, contrôle
  dans le Chrome du propriétaire sur `dev`, en lecture seule, avec des
  tickets fictifs injectés dans l'onglet (largeur de téléphone non
  vérifiable : fenêtre fixe, cadrage interdit). Lot 5 : sur le poste, CSS
  compilé comparé, build de production, contrôle dans le Chrome du
  propriétaire sur `dev`, en lecture seule, l'état du backend injecté dans
  l'onglet, tout POST bloqué ; un défaut vu et corrigé (la piste de la
  barre) ; largeur de téléphone non vérifiable, comme au lot 4. Lot 6 : sur
  le poste, CSS compilé comparé, build de production ; dans une fenêtre
  Edge pilotée (D98), les styles calculés des 15 écrans repris (22
  adresses) relevés avant et après, à 1 440 et 390 px, chaque écart
  expliqué, aucune violation CSP ; **la largeur de téléphone vue pour la
  première fois**, menu replié compris ; puis l'inbox et `/admin/cron`
  dans le Chrome du propriétaire, console vide.*

**Docs :** `charte-graphique.md`, `architecture/gestion-contenu.md`.

### Étape 10 — Deux corrections d'interface ✅ (21 octobre)

**À trancher au début :** D104 (tranchée le 21 octobre). Étapes 10 à 13
insérées le 21 octobre (D99).

- [x] Le type d'une accréditation en français partout où il s'affiche
  (« International », « État », « Label ») : la carte de l'onglet
  Accréditations montrait la valeur brute (`state`,
  `AccreditationsTab.tsx`). La base, les routes et l'API v1 gardent
  `international`, `state` et `label`. *Fait : `manage/accreditation-type.ts`
  ; c'était le seul endroit (relevé de `app/`, `components/`, `lib/`).*
- [x] Le lien « Back-office » dans la barre du site, sur toutes les pages,
  dès la connexion, pour un gestionnaire ou un admin, jamais pour un `USER`
  (tests d'abord). Revient sur D57. *Fait par D104 : `BackOfficeLink` et
  `GET /api/admin/account/back-office`.*
- [x] Contrôle visuel à 1 440 et 390 px ; tests, typecheck, lint verts.

**Docs :** `architecture/gestion-contenu.md` (§3), `charte-graphique.md`
si la barre du site change.

### Étape 11 — Séparer l'IA : la branche `local`, `gestion` sans console ni backend ✅ (21 et 22 octobre)

**Tranchées :** D100, D101.

- [x] La branche `local` créée depuis `gestion` une fois l'étape 10 validée
  et poussée, puis poussée sur `origin` : elle garde la console, le backend
  et `npm run local`. Jamais de fusion de `gestion` dans `local` (D100).
  *Fait le 21 octobre : `local` = `e4ba0c5`, sur `origin` ; CI verte
  (runs 34 et 35) ; aucun déploiement Vercel.*
- [x] Sur `gestion` : l'entrée « Monitoring & Cron » et `app/admin/cron/`
  retirées, avec les routes qui les servent (`trigger-research`,
  `run-due-passes`, `pipeline-status`, `pipeline-jobs`, et
  `schools-with-programs` si la console seule l'appelle), le code de `lib/`
  qu'elles seules emploient et leurs tests (listés au journal, §0). L'inbox
  reste, avec ce qu'elle lit (`describePendingAi`, `lib/pipeline-history.ts`).
  *Fait : inventaire au journal avant toute suppression ; `schools-with-programs`
  confirmée (la console seule l'appelait) ; huit modules de `lib/` ; le
  bandeau gardé (D106).*
- [x] Sur `gestion` : `backend/`, les tests Python, `pytest.ini`,
  `npm run backend`, `npm run local`, `scripts/start-local.ps1` et le job
  Python de la CI retirés (D101) ; le sens de `npm test` se fixe au début de
  l'étape. Aucune migration : `PipelineJob`, `ContributionInbox` et
  `ResearchLaunch` restent au schéma. *Fait : D105 (`npm test` lance les
  tests TypeScript), D107 (un test TypeScript des listes de l'inbox) ;
  `scripts/dump-program-identity.ts` part aussi (seuls les scripts Python le
  lisaient).*
- [x] `test/helpers/access-policy.ts`, le menu et leurs tests suivent ;
  tests, typecheck et lint verts sur `gestion` ; rien ne change sur `local`.
  *Fait : 56 handlers ; `test/no-ai-backend.test.ts` verrouille la
  séparation ; 1 184 TypeScript, typecheck propre, lint 0 erreur ; contrôle
  dans une fenêtre Edge pilotée (D98) à 1 440 et 390 px.*
- [x] Mise en production à la demande du propriétaire : `main` avancée sur
  `gestion`. *Faite le 22 octobre, avec l'étape 12 : `main` avancée sur
  `0880308` par avance rapide, aucune migration ; CI verte sur `main`
  (run 38) ; déploiement de production READY ; en ligne, le menu sans
  « Monitoring & Cron » et `/admin/cron` en 404.*

**Docs :** `architecture/gestion-contenu.md`, README, `.env.example`,
`CLAUDE.md` (règles 7 et 10, commandes), mémo Vercel.

### Étape 12 — Tri des branches ✅ (22 octobre)

**Tranchée :** D102.

- [x] Sur le poste : `devresearch`, `fix/audit-revision2`,
  `fix/audit-revision2-plan`, `fix/gemma-none-response`, `localpython` et
  `newresearch` supprimées ; la `main` du poste remise sur `origin/main`.
  *Fait le 22 octobre, par `git branch -d` ; `newresearch`, refusée (son
  amont `anton1p/newresearch` n'avait pas 8 de ses commits, tous dans
  `gestion`), supprimée par `-d` une fois ce lien coupé, sur décision du
  propriétaire ; `main` avancée de `e4c09cf` à `9f71567` en avance rapide
  seulement, elle suit `origin/main`.*
- [x] Sur `origin` : `devresearch`, `fix/gemma-none-response`, `localpython`
  et `newresearch` supprimées, avec l'accord du propriétaire, après une
  dernière vérification qu'aucune n'a de commit hors de `gestion` (relevé du
  21 octobre : aucune). *Fait le 22 octobre (relevé refait : aucune), chaque
  suppression liée à la tête relevée (`--force-with-lease`) ; il reste
  `main`, `gestion` et `local`.*
- [x] Le dépôt `Anton1P/veille-concurenciel` et le remote `anton1p` restent
  inchangés. *Aucune commande vers lui.*
- [x] CI : le déclencheur `pull_request` et le contrôle des migrations ne
  visent plus `devresearch` (piège 11). *Fait ; la CI se lit sur le push
  qui le porte.*

**Docs :** `CLAUDE.md` (branches), mémo Vercel si besoin.

### Étape 13 — Nettoyage du contexte, branche par branche

**Tranchée :** D103.

- [x] Un agent, en effort maximal, relève sur `gestion` et sur `local` tous
  les documents de contexte (`CLAUDE.md`, `README.md`, `docs/**` dont ce
  plan, `docs/tutoriel-demo.md` non suivi, la mémoire de l'agent hors du
  dépôt) et propose, fichier par fichier : garder, réécrire ou supprimer.
  Critère : décrire l'application telle qu'elle est sur la branche, sans les
  traces des directions passées. `main` suit `gestion` par avance rapide :
  pas de nettoyage à part. *Fait le 22 octobre : inventaire présenté,
  validé par le propriétaire (journal).*
- [x] Le propriétaire valide l'inventaire ; l'agent applique, un commit par
  branche ; les liens entre documents vérifiés. *Fait le 22 octobre : appliqué
  sur `gestion` et sur `local` (un worktree), liens vérifiés, suites vertes ;
  validé par le propriétaire ; commits `8fafe56` sur `local` et `docs(contexte)`
  sur `gestion`, mis en production (journal).*

**Docs :** ceux de l'inventaire.

### Étape 14 — Guide utilisateur

L'ancienne étape 10, placée en dernier (D99).

- [ ] Un guide par rôle (utilisateur, gestionnaire, admin), sur le site
  (page d'aide) et en Word. Le guide de l'admin dit où vit la console IA
  (la branche `local`, sur le poste).

**Docs :** README (le guide).

---

## 6. Hors périmètre : la partie IA gelée

Elle vit sur la branche `local` (D100, D101). Ne pas modifier, sauf demande
explicite d'une étape ou du propriétaire :

- `backend/` (FastAPI, pipeline Phase 1 et 2, crowdsourcing, Tavily, Gemini,
  Gemma) ;
- les routes et écrans IA (sur `gestion` : l'inbox) ;
- les règles de dépense de `CLAUDE.md` (règle 7), qui restent en vigueur.

Pour toute question sur la partie IA : [`docs/README.md`](../README.md), partie
« IA gelée », et les documents de la branche `local`.

---

## 7. Récapitulatif des fichiers

Les fichiers touchés par une étape se lisent dans son commit
(`git show --stat <commit>`) ; le journal (§9) donne les commits. Le
récapitulatif étape par étape des étapes 1 à 12 est dans l'historique Git :
`git show b123272:docs/features/gestion-contenu.md` (§7).

---

## 8. Documentation à mettre à jour, étape par étape

Chaque étape nomme ses docs (§5). Dans tous les cas : le journal (§9), le
statut en tête de ce document, la section « Phase en cours » de `CLAUDE.md`, et
[`architecture/gestion-contenu.md`](../architecture/gestion-contenu.md) dès que
le code qu'elle décrit change.

---

## 9. Journal de progression

Une ligne par étape pour les étapes 0 à 12, condensée à l'étape 13 (D103).
Le journal intégral, session par session (relevés, tests vus en échec,
décisions mot pour mot, contrôles), est dans l'historique Git :
`git show b123272:docs/features/gestion-contenu.md` (§9).

| Date | Étape | Fait | Reste / surprises |
|---|---|---|---|
| 2026-10-16 | 0 | **Réorientation** (réunion de l'équipe, doc « Plan d'évolution – School Data Pipeline ») : décisions G1 à G9 du propriétaire ; branche `gestion` depuis `localpython` (`423631e`) ; documentation recentrée, index `docs/README.md`. Commit `52df900`. | Départ : 722 tests Python (+25 sous-tests), 542 TypeScript, lint 109 avertissements. |
| 2026-10-16 | 1 | **Trois rôles, des gardes qui disent vrai, la connexion obligatoire**, tests d'abord (table d'accès `test/helpers/access-policy.ts`, matrice d'accès, analyse statique des gardes) : D1 (rôle relu en base), D2 (`/contribute` retirée), D18, D19 ; migration `20261016120000_three_roles`. Commits `bcc66e2`, `43e7153`. | `npm run smoke` adapté au mur de connexion. |
| 2026-10-16 | 2 | **Liste blanche, première connexion, écran des comptes, « Mon compte »** : D3 à D6, D20 (version de session), D21 (un compte actif se désactive) ; migration `20261016150000_whitelist_accounts`. Commit `073991d`. | Risque accepté (G5) : pas de preuve de possession de l'adresse ; le code d'invitation n'est pas retenu. |
| 2026-10-19 | 3 | **Mise en ligne** : migrations des étapes 1 et 2 sur `main` ; D7 (Hobby gardé), D22 (préversions : base reliée à Production seulement, « Only build production »), D23 (`preload` HSTS gardé) ; l'hébergement déplacé sur les comptes de l'école (dépôt `emnormandie76/veille-concurenciel`, projet Vercel `app-vc`, nouvelle base Neon `noisy-credit-34683167`, données copiées à l'identique) ; Upstash ; mot de passe de `neondb_owner` changé ; vérifications sans session et connectées ; `main` avancée sur `gestion` sans PR (écart à G3, décision du propriétaire). Commits `ecad4a9`, `522d68e`. | L'intégration Upstash pose des `KV_*` que le code ne lit pas : valeurs recopiées sous `UPSTASH_REDIS_REST_*`. Une base gérée par Vercel ne se transfère pas. |
| 2026-10-19 | 4 | **Charte graphique et composants de base** : maquette A « Registre » choisie parmi trois ; D8 (composants maison), D9 (clair) ; Tailwind CSS v4 sans preflight, l'ancien CSS en couche `legacy` ; connexion, première connexion, « Comptes » et « Mon compte » repris. Commit `b501ec4`. | — |
| 2026-10-20 | 5 | **Sources et auteur de chaque modification** : D10 (la dernière modification, sur neuf tables), D11 (une validation de l'inbox a pour auteur l'admin, origine `AI`), D12 (liens source), D24 (`RESTRICT`), D25 (le nom seul ; l'API v1 ne rend que la date), D26 à D30 ; migration `20261019120000_content_provenance`, sur `dev` puis sur `main` avant le code. Commits `ddda332`, `48ca365`, `e2098cc`, `5e66d2d`. | En Hobby, Vercel bloque un commit dont l'auteur n'est pas `emnormandie76` : les commits sont signés à ce nom par la configuration Git locale du dépôt. |
| 2026-10-20 | 6 | **Formulaire de signalement** sans IA : D13 (une table neuve, `ContentReport`, jamais l'inbox), D31 à D39 ; migration `20261020120000_content_reports`. Commits `cabce96`, `cbb238d`, `9cdb155`. | Deux défauts des composants de l'étape 4 corrigés (`Tabs`, `Dialog`). |
| 2026-10-20 | 7 | **Historique des recherches IA** : D14 (un journal `ResearchLaunch` tenu par Next.js, pas de colonne sur `PipelineJob`), D40 à D46 ; migration `20261020150000_research_launches`. Commits `03a150b`, `7e11a85`, `281f318`. | Le client Prisma 7 calcule `@default(now())` côté poste : `CURRENT_TIMESTAMP` en base quand l'heure se compare à celle de la base. |
| 2026-10-20 | 8 | **Admissions** (l'année d'entrée seulement) : D16 (une table fille, `ProgramEntry`), D47 à D53 ; migration `20261020180000_program_entries` ; seize migrations sur `dev` et `main`. Commits `2070247`, `d5d6d59`, `af1db58`. | D15 (les événements) non tranchée : l'équipe ne les a pas confirmés. |
| 2026-10-20 → 21 | 9 | **Reprise graphique des écrans restants**, en six lots (D54), en extra high (D17) : le site public et `/api-docs` (lot 1), la gestion des écoles (lots 2 et 3), l'inbox (lot 4), `/admin/cron` (lot 5), le menu et le cadre du back-office avec le preflight, l'ancien CSS supprimé et Inter retirée (lot 6 : un seul monde) ; D55 à D98, dont le contrôle du propriétaire (D73 à D75). Commits `cdef056`, `36571e3`, `2e809b7`, `80ad424`, `d018fc4`, `3af80f7`, `be0c052`, `9f71567` ; **en production le 21 octobre**. | Lots 1 à 3 faits en conteneur cloud, sur une base Postgres jetable (D55) ; la largeur de téléphone se contrôle dans une fenêtre Edge pilotée (D98). |
| 2026-10-21 | 10 à 14 | **Replanification** (D99 à D103, demande du propriétaire) : ranger avant le guide ; quatre étapes insérées, le guide devient l'étape 14. | — |
| 2026-10-21 | 10 | **Deux corrections d'interface** : le lien « Back-office » dès la connexion (D104 : `BackOfficeLink`, `GET /api/admin/account/back-office`, revient sur D57) ; le type d'une accréditation en français. Commit `e4ba0c5`. | Sur un téléphone, la barre passe sur deux lignes au premier chargement d'un gestionnaire. |
| 2026-10-21 → 22 | 11 | **L'IA séparée** : la branche `local` créée depuis `e4ba0c5` et poussée ; sur `gestion`, la console, ses cinq routes, huit modules de `lib/`, le backend, les tests Python et le job Python de la CI retirés (120 fichiers) ; D105 (`npm test` lance les tests TypeScript), D106 (bandeau `Pending_AI` gardé), D107 (un test TypeScript des listes de l'inbox) ; `test/no-ai-backend.test.ts`. Commit `4b61aca`. 1 184 tests TypeScript, lint 93 avertissements. | Après un retrait de routes, `.next/types` périmés cassent le typecheck local (`npx next typegen`). |
| 2026-10-22 | 12 | **Tri des branches** (D102) : six branches supprimées sur le poste, quatre sur `origin`, aucune n'ayant de commit hors de `gestion` ; la CI ne vise plus `devresearch` (piège 11). Commit `0880308`. **Les étapes 10 à 12 en production** (`b123272`) : en ligne, le menu sans « Monitoring & Cron », `/admin/cron` en 404. | `git branch -d` compare d'abord à l'amont : `newresearch` refusée tant que son amont `anton1p/newresearch` la suivait. |
| 2026-10-22 | 13 | **Point de départ vérifié**, sur le **poste** (Windows) : modèle `claude-opus-5-5` ; l'agent ne voit pas l'effort de la session (D103 demande l'effort maximal), et l'a signalé en ouverture. Le premier prompt collé était celui de l'étape 12, déjà faite : signalé, le propriétaire a collé celui de l'étape 13. `git fetch origin` : `gestion` = `origin/gestion` = `main` = `origin/main` = `b123272`, `local` = `origin/local` = `e4ba0c5` ; trois branches seulement, sur le poste et sur `origin`. Dossier de travail propre, sauf `docs/tutoriel-demo.md` (non suivi). CI verte pour `b123272` sur `gestion` et sur `main` (runs 39 et 40). Suites : 1 184 tests TypeScript, typecheck propre, lint 0 erreur et 93 avertissements. | L'inventaire étant en lecture seule, ce relevé est consigné au début de l'application. |
| 2026-10-22 | 13 | **Inventaire, en lecture seule, puis validation.** Relevés : les 29 documents de `docs/` sur chaque branche (ceux de `local` sont les versions de l'étape 10), `CLAUDE.md`, le README, `.env.example`, `docs/tutoriel-demo.md`, les deux compétences Neon de `.claude/skills/` et les 21 fichiers de la mémoire de l'agent. Constats : le code cite les décisions 769 fois (157 fichiers) et les étapes dans 174 fichiers, d'où les §2, §4 et §5 gardés ; seul `test/charte.test.ts` lit un document (les sections « 2. Couleurs » et « 3. Contrastes » de la charte) ; 27 fichiers de code citaient par leur chemin `architecture.md`, `task.md`, `backend-local.md` ou `implementation_plan.md` ; sur `local`, le code gelé cite `task.md` (21 fichiers) et `cron-rotation-production.md` (6). **Décisions du propriétaire** (deux séries de questions à cocher, les sept recommandations retenues) : sur `gestion`, retirer les documents de l'IA (leur code vit sur `local`) et les historiques, ce qui reste vrai passant dans les docs de `gestion` ; condenser ce plan (§2, §4, §5 gardés ; §3 et §7 renvoyés à l'historique ; journal en une ligne par étape) ; la « Phase en cours » de `CLAUDE.md` en quelques lignes ; sur `local`, le nécessaire (`CLAUDE.md`, README et index réécrits pour la branche, la copie du plan supprimée, les historiques que nul code de `local` ne cite supprimés, ailleurs les en-têtes et les lignes fausses) ; `docs/tutoriel-demo.md` versé sur `local`, réécrit ; la mémoire triée et fusionnée (de 21 à 9 fichiers) ; le reste de l'inventaire validé tel quel (compétences Neon gardées). | Hors périmètre, signalés : `.github/workflows/ci.yml` citait `docs/memory/memorystep2.md`, qui n'existe plus (repointé avec les autres) ; `isPrivateHost` et `urlBelongsToDomain` (`lib/utils.ts`) n'ont plus d'appelant sur `gestion` depuis le retrait de `/api/contribute` (code mort, testé) ; des caches Python (`test/__pycache__/`, ignorés par Git) restent sur le poste. |
| 2026-10-22 | 13 | **Application sur `gestion`.** **Retirés** (`git rm`, 21 documents) : `architecture/architecture.md`, `gemma-python-guide.md` et `task.md` ; `cahier-des-charges-school-pipeline.md` ; neuf plans de `features/` (`admin-cron-manual-research`, `api-key-optimization-plan`, `backend-local`, `close_gate_connexion`, `cron-rotation-production`, `crowdsourcing-program-matching`, `research-pipeline-plan`, `school-content-management`, `visibility_on_crontask`) ; `memory/decision-retention-tickets.md` ; `probleme.md` ; `prompt/` (4) ; `testing/` (2). **Réécrits** : `architecture/gestion-contenu.md` (l'en-tête et les récits d'étapes et de lots retirés ; elle reçoit, tirées d'`architecture.md`, la sécurité (§8) et l'outillage et la CI (§9), et les règles de validation de l'inbox (§4.2)) ; `bdd.md` (en-tête ; au §4, écrire et appliquer une migration, et le lanceur `db:migrate`, tiré de `backend-local.md` §2.2 ; la directive des listes de l'inbox selon D107) ; `API-rest.md` ; `charte-graphique.md` (en-tête, mentions de lots, tons de `/admin/cron`, historique du §9 ; les §2 et §3 intacts) ; le mémo Vercel, devenu « la production sur Vercel » (la bascule du poste entre les branches Neon y arrive, §2.1, tirée de `manual_testing_cron.md` ; numérotation changée : les préversions au §8, la base de CI éphémère au §11, titre gardé pour `ci.yml`) ; `edgecase.md` (les cas 17, 19, 36, 37, 38, 41 et 42) ; `docs/README.md` ; le README ; `.env.example` ; `CLAUDE.md` (« Phase en cours » en quelques lignes) ; ce plan (statut, §0, §3, §4, §6, §7, journal ; G1, G3, D22, D100 ; de 317 à 106 Ko). **Code** : 28 fichiers, commentaires seulement : les chemins vers les documents retirés repointés, les marques « (Étape N) » de `task.md` retirées des en-têtes ; dans `ci.yml`, `memorystep2.md` devient `architecture/gestion-contenu.md` §8.3. Liens vérifiés par un script (liens Markdown relatifs des documents suivis, chemins `docs/…` du code) : 153, aucun cassé. Fins de ligne remises telles qu'avant (39 fichiers, aucun écart). 1 184 tests TypeScript, typecheck propre, lint 0 erreur (93 avertissements). | **Écart, signalé** : les commentaires qui citent « le plan backend-local » par son nom, sans chemin (environ 38 fichiers : ses décisions, ses défauts F1 à F7, ses étapes), restent tels quels, pour ne changer que les chemins validés ; `architecture/gestion-contenu.md` §10 dit où lire ce plan (`git show local:docs/features/backend-local.md`). **Erreur corrigée** : `bdd.md` et la fiche d'architecture disaient que le signalement écrit l'origine `REPORT` ; aucun code ne l'écrit (D32). |
| 2026-10-22 | 13 | **Application sur `local`**, dans un dossier à part (choix du propriétaire : un `git worktree` de `local` dans le scratchpad, `node_modules` relié par une jonction à celui du poste, les dépendances étant identiques ; le dossier du poste reste sur `gestion`, ses changements non commités intacts, aucun backend lancé). **Point de départ** : `local` = `e4ba0c5` ; 722 tests Python (+25 sous-tests), typecheck propre, lint 0 erreur (87 avertissements) ; `test:ts` 1 337 sur 1 338, un échec d'environnement : le checkout neuf sous `core.autocrlf=true` écrit les `migration.sql` en CRLF, et `test/program-entries-migration.test.ts` exige le LF (sur le poste et en CI, ils sont en LF) ; remis en LF dans le worktree pour les suites, sans aucun contenu suivi changé (`git diff` vide), puis rendus à leur état de checkout. **Retirés** (`git rm`, 13) : la copie du plan (`features/gestion-contenu.md`), six plans IA de `features/` (`admin-cron-manual-research`, `api-key-optimization-plan`, `close_gate_connexion`, `crowdsourcing-program-matching`, `research-pipeline-plan`, `visibility_on_crontask`), `school-content-management.md`, `prompt/` (4), `probleme.md`. **Réécrits pour la branche** : `CLAUDE.md` (ce qu'est `local`, ses règles, le plan lu sur `gestion` par `git show`), `docs/README.md`, le README (présentation, documentation, nombre de tests). **Ajouté** : `docs/tutoriel-demo.md`, réécrit (sans `/contribute`, l'endpoint de la nouvelle base, liens vérifiés). **Retouchés** (en-têtes et lignes fausses) : `architecture.md`, `architecture/gestion-contenu.md`, `bdd.md`, `API-rest.md` (l'hébergement), le mémo Vercel (en-tête : copie de l'étape 10, la version à jour sur `gestion`), `backend-local.md` (en-tête : branches et base remplacées), `cron-rotation-production.md`, `manual_testing_cron.md` (la branche `dev` de la nouvelle base), `.env.example` ; les liens vers la copie du plan, dans la charte, le cahier des charges et `edgecase.md`, deviennent du texte. **Code** : `app/api-docs/page.tsx`, un commentaire (`implementation_plan.md`). Gardés tels quels : `task.md` et `cron-rotation-production.md` (cités par le code gelé), `testing/`, `gemma-python-guide.md`, `decision-retention-tickets.md`. Liens : 187 vérifiés, aucun cassé dans les documents. Suites : 722 Python (+25 sous-tests), 1 338 TypeScript, typecheck propre, lint 0 erreur (87 avertissements). | Deux chemins du code de `local` visaient déjà, avant l'étape, des documents absents : `docs/memory/memorystep2.md` (`ci.yml`) et `docs/memory/memorystep6.md` (`test/test_crowdsourcing_processor.py`, code gelé) ; laissés, l'inventaire ne touchant pas le code de `local` hors un commentaire. Sur le poste, l'original non suivi de `docs/tutoriel-demo.md` reste dans le dossier de `gestion` : à supprimer une fois le commit de `local` fait, avec l'accord du propriétaire. |
| 2026-10-22 | 13 | **Mémoire de l'agent** (hors dépôt) : de 21 fichiers à 9, et l'index. Gardés : `questions-as-checkboxes`, `edge-cdp-visual-check` ; corrigés : `admin-credentials-via-windows-env` (la connexion par l'adresse), `hosting-school-accounts` (les trois branches, `-c credential.username=Anton1P`), `neon-dev-branch` (la base de l'école, la bascule au mémo Vercel §2.1) ; réécrits courts : `pivot-gestion-contenu`, `neon-migrations-over-websocket`, `charte-graphique-cohabitation` ; les treize sur l'IA fondus en `ia-gelee-acquis` (adresses des deux rapports publiés comprises), puis supprimés. Renvois `[[…]]` vérifiés. | — |
| 2026-10-22 | 13 | **Validation et livraison.** Le propriétaire valide l'étape et demande les commits, le push et la mise en production. **`local`** : commit `8fafe56`, fait dans le worktree et poussé ; CI verte (run 41) ; Vercel en tire un déploiement aussitôt annulé, sans build. Le worktree est ensuite retiré : sa jonction `node_modules` d'abord (`rmdir` sans `/s`, le dossier du poste intact), puis `git worktree remove`. L'original non suivi de `docs/tutoriel-demo.md` quitte le dossier du poste (sa version réécrite est sur `local`). **`gestion`** : un commit, `docs(contexte)`, poussé, puis `main` avancée sur lui par avance rapide (production), sans migration. Dernière case de l'étape 13 cochée ; statut du plan ; `CLAUDE.md` (phase en cours, sans la phrase sur l'effort de l'étape 13). | Le mémo Vercel (§8) disait qu'un push sur `local` ne donne aucun déploiement. Il en donne un, annulé comme pour `gestion`. À l'étape 11, `local` avait été poussée sur `e4ba0c5`, un commit déjà déployé. Phrase corrigée. |
