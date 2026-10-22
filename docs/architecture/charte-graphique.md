# La charte graphique

> Maquette **A « Registre »**, choisie par le propriétaire parmi trois
> (artefacts privés : [A](https://claude.ai/artifact/4jUPQ1b1FXojVDLD6T3p1v),
> [B](https://claude.ai/artifact/Xch8tsLf1Sf9KsAgo2EZGX),
> [C](https://claude.ai/artifact/N4fQJ7decmp3Ei49fKvV4f)) ; **D8** composants
> maison ; **D9** thème clair, jetons prêts pour un sombre (décisions du plan
> [`features/gestion-contenu.md`](../features/gestion-contenu.md)). Tout le
> site est dans la charte.
>
> Le code de référence : [`app/charte.css`](../../app/charte.css) (jetons,
> base), [`components/ui/`](../../components/ui/) (composants),
> [`components/layout/`](../../components/layout/) (gabarits).
> [`test/charte.test.ts`](../../test/charte.test.ts) vérifie que ce document et
> le code disent la même chose : chaque jeton et sa valeur, chaque contraste
> du §3.

---

## 1. Principes

- **Un outil de lecture.** Les collègues comparent des écoles, des tarifs, des
  accréditations : la page sert les chiffres. Tableaux serrés, chiffres alignés
  (Plex Mono, chiffres tabulaires), peu d'ornements.
- **Clair, une seule couleur d'accent** (bleu encre). Les couleurs d'état
  (réussite, avertissement, danger) disent un état, jamais une décoration.
- **Sobre.** Pas de dégradé, pas d'émoji dans l'interface, une ombre seulement
  pour ce qui flotte (dialogue, carte de connexion). Un filet sépare ; une
  carte détache ce qui doit l'être.
- **Les textes ne changent pas avec la forme.** Reprendre un écran change sa
  mise en forme, pas ses libellés.

## 2. Couleurs

Des variables CSS (`--charte-*`, sur `:root`), lues par `@theme inline`
(`--color-*`) : les utilitaires s'écrivent `bg-surface`, `text-ink-2`,
`border-line-strong`… Les palettes par défaut de Tailwind sont retirées : seuls
ces noms existent. Un nom décrit un rôle, jamais une teinte.

| Jeton | Valeur | Rôle |
|---|---|---|
| `page` | `#f3f5f8` | fond de page |
| `surface` | `#ffffff` | cartes, champs, tableaux, dialogues |
| `surface-2` | `#edf0f5` | en-têtes de tableau, survols, badges neutres |
| `line` | `#d3d9e3` | filets et bordures de carte (décoratifs) |
| `line-strong` | `#7d8aa0` | bordure d'un champ ou d'un bouton secondaire (contraste d'élément) |
| `ink` | `#0e1a2b` | texte principal |
| `ink-2` | `#44526a` | texte secondaire : aides, en-têtes de colonne, métadonnées |
| `ink-3` | `#5f6b82` | texte discret : textes indicatifs, valeurs absentes (« — ») |
| `accent` | `#1d4ea3` | bouton principal, onglet choisi, focus |
| `accent-ink` | `#ffffff` | texte sur `accent` |
| `accent-soft` | `#e5ecf8` | fond teinté : badge « Gestionnaire », message d'information, ligne « vous » |
| `accent-strong` | `#173f86` | survol du bouton principal, liens, texte sur `accent-soft` |
| `danger` | `#b42318` | bouton de suppression, texte d'erreur |
| `danger-ink` | `#ffffff` | texte sur `danger` |
| `danger-soft` | `#fdecea` | message d'erreur, badge « Désactivé », bouton « Retirer » |
| `success` | `#11724a` | icône et badge de réussite (« Actif ») |
| `success-soft` | `#e1f3e9` | message de réussite |
| `warning` | `#8a5a00` | badge d'attente (« Invité ») |
| `warning-soft` | `#fbf0d6` | fond du badge d'attente |
| `focus` | `#1d4ea3` | contour du focus clavier |
| `side` | `#12213a` | menu latéral du back-office |
| `side-ink` | `#e8edf5` | texte du menu latéral |
| `side-ink-2` | `#a3b2c9` | texte secondaire du menu latéral |
| `side-active` | `#22375a` | entrée choisie ou survolée du menu latéral |
| `side-line` | `#22324d` | filets du menu latéral |

Les jetons `side-*` servent le menu latéral du back-office, sombre (D92) :
fond `side`, texte `side-ink`, secondaire `side-ink-2`, entrée choisie ou
survolée `side-active`, filets `side-line`.

**Écarts à la maquette A**, pour l'accessibilité : `line-strong` passe de
`#b4bdcc` (1,9:1 sur blanc, sous le seuil d'un contour de champ) à `#7d8aa0` ;
`ink-3` passe de `#66738a` (4,4:1 sur `page`) à `#5f6b82`.

**Un thème sombre, plus tard (D9).** Redéfinir les variables `--charte-*` sous
`:root[data-theme="dark"]` (et sous `prefers-color-scheme: dark` si le réglage
du poste doit suivre), avec `color-scheme: dark`, puis rejouer le §3 sur les
valeurs sombres. Les composants n'ont rien à changer, à une condition : ne
jamais écrire une couleur littérale dans un composant.

## 3. Contrastes

Seuils du WCAG 2.2, niveau AA : **4,5:1** pour un texte, **3:1** pour le
contour d'un élément d'interface et pour le focus. Ratios calculés sur les
valeurs du §2 (`test/charte.test.ts` les recalcule).

| Texte ou élément | Fond | Contraste | Seuil |
|---|---|---|---|
| `ink` | `page` | 16,0 | 4,5 |
| `ink` | `surface` | 17,5 | 4,5 |
| `ink-2` | `surface` | 7,9 | 4,5 |
| `ink-2` | `surface-2` | 6,9 | 4,5 |
| `ink-2` | `page` | 7,2 | 4,5 |
| `ink-3` | `surface` | 5,4 | 4,5 |
| `ink-3` | `surface-2` | 4,7 | 4,5 |
| `ink-3` | `page` | 4,9 | 4,5 |
| `accent-strong` | `surface` | 10,0 | 4,5 |
| `accent-strong` | `accent-soft` | 8,5 | 4,5 |
| `accent-ink` | `accent` | 7,9 | 4,5 |
| `accent-ink` | `accent-strong` | 10,0 | 4,5 |
| `ink` | `accent-soft` | 14,7 | 4,5 |
| `danger` | `surface` | 6,6 | 4,5 |
| `danger` | `danger-soft` | 5,7 | 4,5 |
| `danger-ink` | `danger` | 6,6 | 4,5 |
| `ink` | `danger-soft` | 15,3 | 4,5 |
| `success` | `success-soft` | 5,2 | 4,5 |
| `ink` | `success-soft` | 15,1 | 4,5 |
| `warning` | `warning-soft` | 5,2 | 4,5 |
| `ink` | `warning-soft` | 15,4 | 4,5 |
| `page` | `ink` | 16,0 | 4,5 |
| `side-ink` | `side` | 13,7 | 4,5 |
| `side-ink-2` | `side` | 7,5 | 4,5 |
| `side-ink` | `side-active` | 10,1 | 4,5 |
| `line-strong` | `surface` | 3,5 | 3 |
| `line-strong` | `page` | 3,2 | 3 |
| `focus` | `surface` | 7,9 | 3 |
| `focus` | `page` | 7,2 | 3 |

`line` (1,4:1 sur `surface`) ne délimite jamais seul un élément qu'on manipule : il sépare
des blocs que leur contenu identifie déjà.

Sur le fond sombre du menu (`side`), `focus` ne tiendrait que 2,0:1 : le
focus du menu prend `side-ink` (13,7:1, la ligne `side-ink` sur `side`),
et sur l'entrée choisie 10,1:1 (`side-ink` sur `side-active`) ; D92.

## 4. Typographie

Trois familles IBM Plex, servies par `next/font` depuis le site (aucune
requête vers Google au chargement : la CSP `font-src 'self'` tient). Le
preflight en fait les polices du document (`--default-font-family` : Plex
Sans ; `--default-mono-font-family` : Plex Mono, pour un `<code>` ou un
`<pre>` sans classe).

| Rôle | Famille | Utilitaire | Emploi |
|---|---|---|---|
| texte | IBM Plex Sans (variable) | `font-sans` (par défaut) | tout le texte ; seule police préchargée |
| titres | IBM Plex Sans Condensed, 600 | `font-display` | titre d'écran, de carte, de dialogue ; nom de l'application |
| chiffres et codes | IBM Plex Mono, 400 et 500 | `font-mono` + `tabular-nums` | montants, dates, nombres d'un tableau, domaines |

| Taille | Utilitaire | Emploi |
|---|---|---|
| 12 px | `text-xs` | aides, erreurs de champ, badges, en-têtes de colonne (capitales, `tracking-wider`) |
| 13 px | `text-compact` | cellules de tableau, boutons, liens de la barre du site |
| 14 px | `text-sm` | texte courant (taille de base du document), champs |
| 18 px | `text-lg` | titre de carte ou de dialogue |
| 24 px | `text-2xl` | titre d'écran (`h1`), en `font-display`, `tracking-tight` |

Interlignage 1,5 pour le texte, `leading-relaxed` (1,625) pour les phrases
d'aide et les messages. Les titres prennent `text-balance` quand ils peuvent
passer sur deux lignes. Une phrase d'explication sous un titre ne dépasse pas
70 caractères de large (`max-w-[70ch]`).

## 5. Espacements et formes

L'échelle de Tailwind (pas de 4 px). Les espaces entre éléments frères passent
par `gap`, pas par des marges.

| Espace | Valeur | Emploi |
|---|---|---|
| `gap-1.5` | 6 px | libellé, champ et aide d'un même champ ; badges voisins |
| `gap-4` | 16 px | champs d'un formulaire ; titre et contenu d'une carte |
| `gap-6` | 24 px | blocs d'un écran (en-tête, messages, tableau) |
| `px-5 py-8` | 20 et 32 px | marges d'une page du site |
| `p-5`, `p-6` | 20 et 24 px | intérieur d'une carte ; d'un dialogue ou de la carte de connexion |

| Hauteur | Emploi |
|---|---|
| 28 px (`h-7`) | petit bouton (actions d'une ligne de tableau) |
| 32 px (`h-8`) | bouton, lien de la barre du site |
| 36 px (`h-9`) | champ, liste déroulante |
| 40 px (`h-10`) | onglet |

Toutes les cibles font au moins 24 px (WCAG 2.2, 2.5.8).

| Forme | Valeur | Emploi |
|---|---|---|
| `rounded-control` | 4 px | boutons, champs, messages |
| `rounded-card` | 6 px | cartes, tableaux, dialogues |
| `rounded-full` | | badges, compteurs d'onglet |
| `shadow-sm` | | carte de connexion |
| `shadow-xl` | | dialogue |

Les arrondis par défaut de Tailwind (`rounded-md`…) sont retirés : seuls ces
noms existent.

## 6. Composants

Dans [`components/ui/`](../../components/ui/), sans dépendance hors React et
Tailwind (D8). Le `className` d'un appelant place le composant (marges,
largeur) ; il ne change ni ses couleurs ni sa taille, qui passent par ses
variantes (`cx` ne fusionne pas les classes contradictoires).

| Composant | Fichier | Variantes et règles |
|---|---|---|
| Bouton | `Button.tsx` | `primary` (une action principale par zone), `secondary` (par défaut), `danger` (confirme une suppression), `danger-soft` (ouvre une suppression depuis une ligne), `ghost` (action discrète, bouton d'icône) ; tailles `md`, `sm`, `icon`. `type="button"` par défaut. `buttonClasses()` habille un lien |
| Champ | `Field.tsx` : `Field`, `Input`, `Textarea`, `Label` | `Field` relie libellé, aide (`<id>-hint`) et erreur (`<id>-error`) au contrôle : `htmlFor`, `aria-describedby`, `aria-invalid`. Un libellé visible, toujours ; le texte indicatif ne le remplace jamais |
| Liste déroulante | `Field.tsx` : `Select` | `<select>` natif, avec une flèche ; se place dans un `Field` |
| Tableau | `Table.tsx` : `Table`, `THead`, `TBody`, `Tr`, `Th`, `Td` | `caption` (lu, pas affiché) ; en-têtes `scope="col"` ; `numeric` aligne à droite en chiffres tabulaires ; défile en largeur dans son cadre ; `id` va au `<table>` (`pricing-table`). Un texte long ne prend pas une colonne : il passe sur sa propre ligne, sous celle qu'il complète (`colSpan`), les deux dans un `TBody` qui porte le filet (D74 : la note d'un tarif) |
| Carte | `Card.tsx` : `Card`, `CardHeader` | un bloc détaché (formulaire, groupe de faits) ; `CardHeader` donne un titre `h2` et un `titleId` pour `aria-labelledby` |
| Onglets | `Tabs.tsx` : `Tabs`, `TabPanel` ; `tabs-keys.ts` | modèle ARIA : flèches gauche et droite (en boucle), Début, Fin ; un seul onglet dans l'ordre de tabulation ; compteur facultatif. Le filet du bas est une ombre intérieure, que couvre le soulignement de l'onglet choisi : rien ne déborde de la liste, qui défile en largeur sans barre verticale. Un `TabPanel` caché ne prend pas le `className` de l'appelant : un utilitaire d'affichage (`flex`) déferait l'attribut `hidden` et montrerait le panneau (le preflight tient aussi `[hidden]`) |
| Badge | `Badge.tsx` | `neutral`, `accent`, `solid` (catégories : rôles) ; `success`, `warning`, `danger` (états) ; `wrap` pour un texte long qui passe à la ligne (le concours d'un programme) : hauteur minimale, arrondi d'un contrôle |
| Dialogue | `Dialog.tsx` : `Dialog`, `DialogFooter` | `<dialog>` natif ouvert par `showModal()` : focus gardé dans le dialogue, page inerte, focus rendu à la fermeture ; Échap et « Fermer » passent par `onClose`, qui peut refuser ; `data-autofocus` désigne le premier champ. Remplace `confirm()`. Un événement `close` du navigateur arrivé quand le dialogue est de nouveau ouvert est ignoré : sous `next dev`, React rejoue les effets, et le dialogue se refermerait aussitôt ouvert. Deux options (D76) : `placement="side"`, un panneau collé au bord droit, pleine hauteur, `min(37.5rem, 95vw)`, filet à gauche, sans arrondi (le détail d'un ticket de l'inbox) ; `closeOnBackdrop`, un clic sur le fond voilé, hors du cadre du dialogue, appelle `onClose` (un clic au clavier vise un bouton, jamais le fond) |
| Message | `Alert.tsx` | `danger` (`role="alert"`), `success` et `info` (`role="status"`) ; texte en encre, teinte portée par le fond et l'icône |
| Barre de progression | `ProgressBar.tsx` | l'élément natif `<progress>` (D86 ; aucun écran de cette branche ne l'emploie : la console IA qui s'en sert vit sur `local`) : valeur et maximum, nommée par l'appelant (`aria-label` ou `aria-labelledby`) ; ton de la valeur `accent` (une avancée : la progression d'une tâche), `success`, `warning`, `danger` (un usage : un quota) ; piste en `line`, visible sur `surface` comme sur `surface-2` ; 6 px, sans animation ; les chiffres restent écrits à côté. Jamais de largeur posée par un `style` en ligne |
| Lien dans un texte | `text-link.ts` : `TEXT_LINK` | souligné, en `accent-strong` |

Rôles et états des comptes : `Utilisateur` neutre, `Gestionnaire` accent,
`Administrateur` plein ; `Invité` avertissement, `Actif` réussite,
`Désactivé` danger.

Sur les fiches : le type de diplôme en `accent`, le niveau, le concours et
l'expatriation en `neutral`, « Alternance » en `success` ; une école active
en `success` sur l'accueil.

Dans la gestion des écoles : le statut d'une école, sur la liste et dans
l'en-tête, ACTIVE en `success`, INACTIVE en `neutral`, DRAFT en `warning`
(D66, `app/admin/schools/school-status.ts`) ; le type d'une accréditation en
catégorie (`international` en `accent`, `state` en `solid`, `label` en
`neutral`), écrit en français (« International », « État », « Label »,
`manage/accreditation-type.ts`), « Actif » en `success`, « Inactif » en
`neutral` ; le niveau requis d'une admission et la ville d'un campus en
`neutral`. Une case à cocher reste native (`accent-accent`), libellée, dans
un `fieldset` dont la légende nomme le groupe (D64 : le statut d'une
accréditation).

Dans les autres onglets : le rang d'un classement en ton de catégorie par palier (D68,
`manage/ranking-badge.ts`) : le podium (1 à 3) en `solid`, de 4 à 10 en
`accent`, au-delà en `neutral`, textes « 1er », « 2ème », « 3ème », « #N » ;
l'alternance et l'expatriation d'un programme, « Oui » en `success`, « Non »
en `neutral` ; les campus d'un programme en `accent`, avec le repère.
L'alternance et l'expatriation d'un programme sont des cases natives sous la
règle de D64 (D69), et ses campus des cases natives dans un groupe légendé, chacune dans une étiquette bordée qui prend l'accent une
fois cochée (`has-checked:`). La modification rapide des places (D71) : un
bouton natif souligné en tirets, un champ nommé par `aria-label`, deux
boutons d'icône nommés, l'erreur sous le champ en `role="alert"`.

Dans l'inbox (D77, `app/admin/inbox/ticket-tones.ts`) : un ton par
état, comme les signalements : `Pending_Admin` en `warning` (à l'admin
d'agir), `Pending_AI` en `neutral` (il attend le backend), `Validated` en
`success`, `Rejected` en `neutral`, `Failed` en `danger` ; les alertes
d'un ticket, « Année supposée » et « Nom incohérent » en `warning`,
« Conflit » en `danger` ; la
correspondance d'un programme, exacte en `success`, approximative en
`warning`, absente en `danger`. Le bandeau des contributions en attente est
un message `info` (D80). Pas de symbole ✓, ✕ ni ⚠ en tête d'un texte, pas
plus que d'émoji (D78) ; un « ✕ » seul devient un bouton d'icône
(`danger-soft`, taille `icon`, une croix) nommé par `aria-label`. Un lien tiré d'un
ticket n'est cliquable qu'en `http(s)` (D79) ; l'icône de lien externe ne
suit qu'un texte court (« source ») : à côté d'un intitulé sur plusieurs
lignes, elle restait centrée à droite du bloc.

Le menu du back-office (`app/admin/SidebarClient.tsx`) : sombre sur
les jetons `side-*` (D92), texte seul (D93) ; une entrée en `side-ink-2`,
survolée en `side-active` ; l'entrée choisie en `side-active`, `side-ink`,
graisse moyenne et un filet de 3 px à gauche (une ombre intérieure : rien ne
bouge), `aria-current="page"` ; le focus en `side-ink` (§3) ; sous le nom,
le rôle en texte `side-ink-2` (D95), les initiales de l'avatar cachées aux
lecteurs d'écran. Sous 1 024 px, une barre sombre et un bouton « Menu »
(`aria-expanded`, `aria-controls`) qui ouvre le menu sous elle, dans le
flux, sans calque (D94).

Une carte du gestionnaire dont le titre partage sa ligne avec des boutons
(accréditation, admission, campus) a un en-tête qui passe à la ligne
(`flex flex-wrap`, D73) : un titre court garde ses boutons à côté, un titre
long garde la largeur et les boutons descendent dessous. Sans cela,
« Modifier » et « Supprimer » ne laisseraient que 80 px au titre, coupé au
milieu d'un mot.

**Pas d'émoji** (§1, D56) : une icône SVG cachée aux lecteurs d'écran en
tient lieu là où elle aide (le repère des campus, le lien externe :
`app/schools/icons.tsx`, repris par les cartes du gestionnaire).
`test/charte.test.ts` refuse un émoji dans un écran ; les flèches de texte
(« → », « ↗ ») n'en sont pas.

## 7. Gabarits

Dans [`components/layout/`](../../components/layout/). La base de la charte
est posée sur le document (§9, D96) : un gabarit ne porte pas de classe à
lui.

| Gabarit | Fichier | Emploi |
|---|---|---|
| Site | `SiteShell.tsx` | la barre du site (Écoles, API, Back-office pour qui y a droit, Mon compte, Se déconnecter), puis une colonne `narrow` (48 rem, formulaires) ou `wide` (72 rem). Les entrées sont des `SiteNavLink` (`SiteNavLink.tsx`). « Back-office » suit la session relue en base, sur toutes les pages (D104) : une page qui la lit passe `showBackOffice` (le lien est dans son HTML) ; une page qui ne la lit pas (l'accueil, les fiches en cache, `/api-docs`) ne passe rien, et la barre pose `BackOfficeLink`, composant client qui demande l'accès à une route et n'affiche le lien que sur un « oui » (jamais dans le HTML du serveur : rien n'apparaît puis disparaît pour un `USER`). Sur un téléphone, la barre passe sur deux lignes avec le lien. `current` marque l'entrée qui mène à la page affichée (Écoles sur l'accueil, API sur `/api-docs`), aucune sur une fiche |
| Connexion | `AuthShell.tsx` | une colonne de 24 rem au centre : titre, carte du formulaire, lien vers l'autre page ; sans barre. `AuthShellLoading` pendant la lecture de l'adresse |
| Back-office | `AdminPage.tsx` | l'en-tête d'un écran (titre, explication, actions), puis son contenu ; se pose dans le cadre de `app/admin/layout.tsx` (ligne suivante). Deux emplacements facultatifs, sur la maquette A : `back`, le lien de retour au-dessus du titre (« ← Retour à la liste des écoles »), et `badge`, à côté du titre et hors du `h1` (le statut d'une école) ; sans eux, l'en-tête ne change pas |
| Cadre du back-office | `app/admin/layout.tsx`, `app/admin/SidebarClient.tsx` | le menu (§6), puis un `main` (`min-w-0` : un tableau large défile dans son cadre) ; sur grand écran, des marges de 40 px (1 200 px au plus) à côté d'une colonne de 240 px collée en haut de la fenêtre ; sous 1 024 px, la barre et le menu repliable au-dessus, 16 px de gouttière (24 px dès 640 px). `requirePage("manager")` y reste |

## 8. Accessibilité

- **Contrastes** : §3, vérifiés par test à chaque changement de jeton.
- **Focus visible** partout : contour de 2 px en `focus`, décalé de 2 px
  (règle de base, et sur chaque composant) ; un champ montre le focus par sa
  bordure et un anneau, et garde un contour transparent pour le mode à
  contraste élevé de Windows.
- **Libellés** : chaque champ a un libellé visible relié par `htmlFor` ; aide
  et erreur sont reliées par `aria-describedby` ; un champ en erreur porte
  `aria-invalid`. Un bouton d'icône porte `aria-label` (« Fermer »).
- **Messages** : une erreur est annoncée (`role="alert"`), une réussite
  attend (`role="status"`).
- **Couleur jamais seule** : un badge dit son état en toutes lettres ; un lien
  est souligné.
- **Clavier** : onglets aux flèches, dialogue fermé par Échap, focus rendu à
  l'élément d'origine.
- **Structure** : un `h1` par écran ; `main` et une `nav` nommée dans les
  gabarits et le cadre du back-office (« Navigation du site », « Navigation
  du back-office ») ; `aria-current="page"` sur l'entrée de la barre ou du
  menu qui mène à la page affichée ; aucun titre dans le menu (le nom de
  l'application n'y est plus un `h2` avant le `h1` de l'écran) ; tableaux
  avec `caption` et `scope`.
- **Menu replié** (sous 1 024 px) : un bouton natif « Menu » qui dit son état
  (`aria-expanded`) et ce qu'il commande (`aria-controls`) ; le menu s'ouvre
  juste après lui dans l'ordre du clavier, sans calque ni piège à focus, et
  se referme quand la page change.
- **Mouvement** : seules des transitions de couleur, brèves.

## 9. Mise en œuvre

Tout le site est dans la charte (D96, D97).

- **Tailwind CSS v4** (`tailwindcss` et `@tailwindcss/postcss`, 4.3.3),
  branché par [`postcss.config.mjs`](../../postcss.config.mjs), importé
  **entier** par [`app/globals.css`](../../app/globals.css) : thème,
  **preflight** et utilitaires (`@import "tailwindcss" source(none)`), puis
  [`app/charte.css`](../../app/charte.css). Couches : `theme, base,
  components, utilities`, celles de Tailwind ; aucune règle hors couche (une
  règle hors couche l'emporterait sur toutes les couches).
- **La base** (`app/charte.css`, couche `base`, après le preflight) : la
  page sur le document (`body` : fond `page`, encre, 14 px, lissage ;
  `html` : `color-scheme: light`), les bordures au filet, le curseur des
  boutons, le focus visible, le fond voilé des dialogues, le gras des
  intitulés de groupe d'une liste (`optgroup`, que le preflight fait
  hériter). Le preflight pose la police du document (Plex Sans) et celle des
  `<code>` (Plex Mono), et tient `[hidden]` face à un utilitaire
  d'affichage.
- **Sources** : `app/` et `components/` seulement (`@source`) ; ni `docs/`,
  ni `test/`. Aucune exclusion : `block`, `table` et `filter` sont générés,
  tirés de mots du code (un commentaire de `ProgressBar`, des routes de
  `app/api/`) ; aucun élément ne les porte, et le test « chaque classe écrite
  en clair est un utilitaire » l'assure.
- **Polices** : les trois Plex par `next/font` (`app/layout.tsx`) ; le `body`
  n'a pas de `style` en ligne.
- **Ce qui garde la règle** (`test/charte.test.ts`) : aucune autre feuille de
  style dans `app/` ni `components/`, aucun bloc `styled-jsx` ni `<style>`,
  aucun `style` en ligne ni émoji dans `app/`, chaque écran dans son
  gabarit, chaque classe écrite en clair (`className="…"`) qui soit un
  utilitaire généré ; les jetons et les contrastes du §2 et du §3.

**Ajouter un écran** : le poser dans son gabarit (`SiteShell`, `AuthShell`,
`AdminPage`) ; n'utiliser que les composants et les utilitaires de la charte,
sans `style` en ligne, sans couleur littérale, sans émoji ; regarder l'écran
à 1 440 et à 390 px.

**Prouver qu'un changement global ne bouge rien** : relever les styles
calculés des écrans avant et après (à 1 440 et 390 px), et comparer le CSS
compilé règle à règle.
