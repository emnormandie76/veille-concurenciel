# La charte graphique

> **Arrêtée le 19 octobre 2026**, étape 4 du plan
> [`features/gestion-contenu.md`](../features/gestion-contenu.md) : maquette
> **A « Registre »** choisie par le propriétaire parmi trois (artefacts privés :
> [A](https://claude.ai/artifact/4jUPQ1b1FXojVDLD6T3p1v),
> [B](https://claude.ai/artifact/Xch8tsLf1Sf9KsAgo2EZGX),
> [C](https://claude.ai/artifact/N4fQJ7decmp3Ei49fKvV4f)) ; **D8** composants
> maison ; **D9** thème clair, jetons prêts pour un sombre.
>
> Le code de référence : [`app/charte.css`](../../app/charte.css) (jetons,
> base), [`components/ui/`](../../components/ui/) (composants),
> [`components/layout/`](../../components/layout/) (gabarits).
> [`test/charte.test.ts`](../../test/charte.test.ts) vérifie que ce document et
> le code disent la même chose : chaque jeton et sa valeur, chaque contraste
> du §3.
>
> **Étape 9, reprise des écrans restants** (D54 : six lots, une session par
> lot) : le lot 1 (site public et `/api-docs`) et le lot 2 (liste des
> écoles, cadre de la gestion, campus, onglets Infos, Accréditations,
> Chiffres clés, Admissions) sont faits le 20 octobre, le lot 3 (onglets
> Campus & Programmes, Tarifs, Classements, Capacités ; l'îlot retiré) le
> 21 octobre ; l'état de la reprise est au §9.

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
| `side` | `#12213a` | menu latéral du back-office (étape 9) |
| `side-ink` | `#e8edf5` | texte du menu latéral |
| `side-ink-2` | `#a3b2c9` | texte secondaire du menu latéral |
| `side-active` | `#22375a` | entrée choisie ou survolée du menu latéral |
| `side-line` | `#22324d` | filets du menu latéral |

Les jetons `side-*` attendent l'étape 9 : le menu latéral actuel reste
l'ancien d'ici là (décision du 19 octobre).

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

## 4. Typographie

Trois familles IBM Plex, servies par `next/font` depuis le site (aucune
requête vers Google au chargement : la CSP `font-src 'self'` tient).

| Rôle | Famille | Utilitaire | Emploi |
|---|---|---|---|
| texte | IBM Plex Sans (variable) | `font-sans` (par défaut) | tout le texte ; seule police préchargée |
| titres | IBM Plex Sans Condensed, 600 | `font-display` | titre d'écran, de carte, de dialogue ; nom de l'application |
| chiffres et codes | IBM Plex Mono, 400 et 500 | `font-mono` + `tabular-nums` | montants, dates, nombres d'un tableau, domaines |

| Taille | Utilitaire | Emploi |
|---|---|---|
| 12 px | `text-xs` | aides, erreurs de champ, badges, en-têtes de colonne (capitales, `tracking-wider`) |
| 13 px | `text-compact` | cellules de tableau, boutons, liens de la barre du site |
| 14 px | `text-sm` | texte courant (taille de base des écrans de la charte), champs |
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

Les arrondis par défaut de Tailwind (`rounded-md`…) sont retirés : ils
portaient les mêmes noms de variables que l'ancien CSS (`--radius-md`…).

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
| Tableau | `Table.tsx` : `Table`, `THead`, `TBody`, `Tr`, `Th`, `Td` | `caption` (lu, pas affiché) ; en-têtes `scope="col"` ; `numeric` aligne à droite en chiffres tabulaires ; défile en largeur dans son cadre ; `id` va au `<table>` (un écran repris garde le sien : `pricing-table`, étape 9). Un texte long ne prend pas une colonne : il passe sur sa propre ligne, sous celle qu'il complète (`colSpan`), les deux dans un `TBody` qui porte le filet (D74 : la note d'un tarif) |
| Carte | `Card.tsx` : `Card`, `CardHeader` | un bloc détaché (formulaire, groupe de faits) ; `CardHeader` donne un titre `h2` et un `titleId` pour `aria-labelledby` |
| Onglets | `Tabs.tsx` : `Tabs`, `TabPanel` ; `tabs-keys.ts` | modèle ARIA : flèches gauche et droite (en boucle), Début, Fin ; un seul onglet dans l'ordre de tabulation ; compteur facultatif. Le filet du bas est une ombre intérieure, que couvre le soulignement de l'onglet choisi : rien ne déborde de la liste, qui défile en largeur sans barre verticale (corrigé à l'étape 6). Un `TabPanel` caché ne prend pas le `className` de l'appelant : sans preflight, un utilitaire d'affichage (`flex`) défaisait l'attribut `hidden` et montrait le panneau (corrigé à l'étape 9) |
| Badge | `Badge.tsx` | `neutral`, `accent`, `solid` (catégories : rôles) ; `success`, `warning`, `danger` (états) ; `wrap` pour un texte long qui passe à la ligne (le concours d'un programme, étape 9) : hauteur minimale, arrondi d'un contrôle |
| Dialogue | `Dialog.tsx` : `Dialog`, `DialogFooter` | `<dialog>` natif ouvert par `showModal()` : focus gardé dans le dialogue, page inerte, focus rendu à la fermeture ; Échap et « Fermer » passent par `onClose`, qui peut refuser ; `data-autofocus` désigne le premier champ. Remplace `confirm()`. Un événement `close` du navigateur arrivé quand le dialogue est de nouveau ouvert est ignoré : sous `next dev`, React rejoue les effets, et le dialogue se refermait aussitôt ouvert (corrigé à l'étape 6) |
| Message | `Alert.tsx` | `danger` (`role="alert"`), `success` et `info` (`role="status"`) ; texte en encre, teinte portée par le fond et l'icône |
| Lien dans un texte | `text-link.ts` : `TEXT_LINK` | souligné, en `accent-strong` |

Rôles et états des comptes : `Utilisateur` neutre, `Gestionnaire` accent,
`Administrateur` plein ; `Invité` avertissement, `Actif` réussite,
`Désactivé` danger.

Sur les fiches (étape 9, lot 1, sur la maquette A) : le type de diplôme en
`accent`, le niveau, le concours et l'expatriation en `neutral`,
« Alternance » en `success` ; une école active en `success` sur l'accueil.

Dans la gestion des écoles (étape 9, lot 2) : le statut d'une école, sur la
liste et dans l'en-tête, ACTIVE en `success`, INACTIVE en `neutral`, DRAFT
en `warning` (D66, `app/admin/schools/school-status.ts`) ; le type d'une
accréditation en catégorie (`international` en `accent`, `state` en
`solid`, `label` en `neutral`), « Actif » en `success`, « Inactif » en
`neutral` ; le niveau requis d'une admission et la ville d'un campus en
`neutral`. Une case à cocher reste native (`accent-accent`), libellée, dans
un `fieldset` dont la légende nomme le groupe (D64 : le statut d'une
accréditation, qui était un interrupteur sans clavier).

Au lot 3 : le rang d'un classement en ton de catégorie par palier (D68,
`manage/ranking-badge.ts`) : le podium (1 à 3) en `solid`, de 4 à 10 en
`accent`, au-delà en `neutral`, textes « 1er », « 2ème », « 3ème », « #N » ;
l'alternance et l'expatriation d'un programme, « Oui » en `success`, « Non »
en `neutral` ; les campus d'un programme en `accent`, avec le repère. Les
deux interrupteurs du formulaire d'un programme deviennent des cases
natives sous la règle de D64 (D69), et ses campus des cases natives dans
un groupe légendé, chacune dans une étiquette bordée qui prend l'accent une
fois cochée (`has-checked:`). La modification rapide des places (D71) : un
bouton natif souligné en tirets, un champ nommé par `aria-label`, deux
boutons d'icône nommés, l'erreur sous le champ en `role="alert"`.

Une carte du gestionnaire dont le titre partage sa ligne avec des boutons
(accréditation, admission, campus) a un en-tête qui passe à la ligne
(`flex flex-wrap`, D73, contrôle du 21 octobre) : un titre court garde ses
boutons à côté, un titre long garde la largeur et les boutons descendent
dessous. Sans cela, « Modifier » et « Supprimer » ne laissaient que 80 px au
titre, coupé au milieu d'un mot.

**Pas d'émoji** (§1, D56) : les émojis décoratifs des anciens écrans partent
à la reprise, leurs textes restent ; une icône SVG cachée aux lecteurs
d'écran les remplace là où elle aide (le repère des campus, le lien
externe : `app/schools/icons.tsx`, repris par les cartes du gestionnaire au
lot 2). `test/charte.test.ts` refuse un émoji
dans un écran de la charte ; les flèches de texte (« → », « ↗ ») n'en sont
pas.

## 7. Gabarits

Dans [`components/layout/`](../../components/layout/). Leur racine porte la
classe `charte` (§9).

| Gabarit | Fichier | Emploi |
|---|---|---|
| Site | `SiteShell.tsx` | la barre du site (Écoles, API, Back-office pour qui y a droit, Mon compte, Se déconnecter), puis une colonne `narrow` (48 rem, formulaires) ou `wide` (72 rem). « Back-office » suit la session relue en base : les pages qui ne la lisent pas (l'accueil, les fiches en cache, `/api-docs`) passent `showBackOffice={false}` (D57). `current` marque l'entrée qui mène à la page affichée (Écoles sur l'accueil, API sur `/api-docs`), aucune sur une fiche |
| Connexion | `AuthShell.tsx` | une colonne de 24 rem au centre : titre, carte du formulaire, lien vers l'autre page ; sans barre. `AuthShellLoading` pendant la lecture de l'adresse |
| Back-office | `AdminPage.tsx` | l'en-tête d'un écran (titre, explication, actions), puis son contenu ; se pose dans le cadre de `app/admin/layout.tsx`, dont le menu reste l'ancien jusqu'à l'étape 9. Deux emplacements facultatifs depuis le lot 2 de l'étape 9, sur la maquette A : `back`, le lien de retour au-dessus du titre (« ← Retour à la liste des écoles »), et `badge`, à côté du titre et hors du `h1` (le statut d'une école) ; sans eux, le rendu est celui de l'étape 4 |

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
  gabarits ; `aria-current="page"` sur l'entrée de la barre qui mène à la page
  affichée ; tableaux avec `caption` et `scope`.
- **Mouvement** : seules des transitions de couleur, brèves.

## 9. Mise en œuvre, jusqu'à la fin de l'étape 9

L'ancien style et la charte cohabitent (plan, G7 et piège 10) jusqu'au lot 6
de l'étape 9 (D54).

| Lot (D54) | Écrans | État |
|---|---|---|
| 1 | accueil, fiche école, fiche programme, `/api-docs` (avec `SourceLine`) | **fait le 20 octobre** |
| 2 | liste des écoles, cadre de la gestion, page des campus, onglets Infos, Accréditations, Chiffres clés, Admissions (avec `LastEdit` et les sélecteurs de programme et d'année) | **fait le 20 octobre** |
| 3 | onglets Campus & Programmes, Tarifs, Classements, Capacités ; l'îlot et `manage/legacy/` retirés | **fait le 21 octobre** (validé) |
| 4 | inbox | à faire |
| 5 | `/admin/cron` | à faire |
| 6 | menu latéral et cadre du back-office ; preflight, nettoyage de `globals.css`, Inter | à faire |

- **Tailwind CSS v4** (`tailwindcss` et `@tailwindcss/postcss`, 4.3.3),
  branché par [`postcss.config.mjs`](../../postcss.config.mjs).
- **Couches** ([`app/globals.css`](../../app/globals.css)) :
  `theme, legacy, base, components, utilities`. L'ancien CSS, inchangé, est
  rangé dans `legacy` : laissé hors couche, il l'emporterait sur toute couche,
  et son `* { margin: 0; padding: 0 }` annulerait les utilitaires d'espacement.
  Les anciens écrans n'ont aucune classe Tailwind et ne changent pas. Les
  styles `styled-jsx` des anciens écrans restent hors couche, donc au-dessus de
  tout.
- **Pas de preflight** : seuls `tailwindcss/theme.css` et
  `tailwindcss/utilities.css` sont importés. À la place, une base limitée au
  sous-arbre `.charte` ([`app/charte.css`](../../app/charte.css)) défait ce que
  l'ancien CSS impose (titres blancs, bordures et polices natives des champs)
  et pose le focus visible.
- **Sources** : Tailwind ne lit que les dossiers nommés par `@source`
  (`components/`, `app/(admin-auth)/admin/`, `app/admin/users/`,
  `app/account/`, depuis l'étape 6 `app/admin/reports/`, depuis le lot 1
  de l'étape 9 `app/schools/` (les fiches, le formulaire de signalement),
  `app/api-docs/` et le seul fichier `app/page.tsx` (l'accueil : lire tout
  `app/` ferait générer les homonymes des classes des écrans pas encore
  repris), et depuis le lot 3 toute la gestion des écoles en une source,
  `app/admin/schools/` (au lot 2, fichier par fichier, sans les onglets du
  lot 3 ; aucun fichier de l'ancien style n'y reste)), avec
  `source(none)` sur l'import des utilitaires : un ancien
  nom de classe qui serait aussi un utilitaire n'en reçoit pas les règles.
  `block` et `fill-accent`, deux classes de `/admin/cron`, ne sont jamais
  générés (`@source not inline`) : un écran de la charte ne s'en sert pas
  (une colonne flex à la place de `block`).
- **Transition du back-office** : `.admin-content-area:has(.charte)` peint
  toute la zone de contenu au fond de la charte quand l'écran est repris.
- **L'îlot sombre des onglets du lot 3** (lot 2, D60, D61), **retiré au
  lot 3** : entre les deux lots, quatre onglets de la gestion d'une école
  gardaient l'ancien style, posés après le gabarit, hors du sous-arbre
  `.charte`, dans `manage/legacy/TabFrame.tsx`, avec des copies à l'ancien
  style de `LastEdit`, `ProgramSelector` et `YearSelector`. Depuis le
  lot 3, les huit onglets sont dans le gabarit et dans la charte ; le
  dossier `manage/legacy/` est supprimé.
- **Polices** : Inter reste pour les anciens écrans (`--font-inter`) ; les
  trois Plex s'y ajoutent (`app/layout.tsx`).

**Reprendre un écran** (étape 9, ou un écran nouveau des étapes 5 à 8) :

1. le poser dans son gabarit (`SiteShell`, `AuthShell`, `AdminPage`) ;
2. n'utiliser que les composants et les utilitaires de la charte, sans
   classe de l'ancien CSS ni `style` en ligne ;
3. ajouter son dossier aux `@source` de `app/globals.css` (un test le
   vérifie) ;
4. garder libellés, identifiants de champ et comportement ;
5. regarder l'écran dans un navigateur, et un écran voisin non repris.

**Restes pour l'étape 9** (lots 4 à 6) : l'inbox (lot 4) et
`/admin/cron` (lot 5) ; puis, au lot 6, le
menu latéral et le cadre du back-office (jetons `side-*`), le preflight à la
place de la base `.charte` (il pose aussi `[hidden] { display: none }`), la
règle de transition `:has()`, les exclusions `block` et `fill-accent`, Inter,
et les classes mortes de l'ancien CSS. Relevé à la fin du lot 1 : 142 des
201 classes de la couche `legacy` ne servent plus à aucun écran, celles des
écrans repris (`public-nav*`, `hero-*`, `search-*`, `stats-bar`,
`school-card*`, `school-detail-*`, `program-card*`, `program-tag`, `tag-*`,
`filter-*`, `docs-*`, `pricing-table*`, `ranking-*`, `stat-card*`,
`accreditation-*`, `breadcrumb*`, `login-*`, `account-*`, `users-actions`,
`badge-user`, `badge-invited`, `user-secondary`, `modal-text`…) et quelques
autres déjà mortes avant l'étape 9 (`campus-accordion`, `forbidden-*`,
`spinner`, `page-loading`…). Le lot 2 en ajoute douze : `manage-header`,
`manage-header-top`, `manage-school-name`, `manage-school-meta`, `tabs-nav`,
`tab-button`, `tab-count`, `tab-content`, `badge-type-international`,
`badge-type-state`, `badge-type-label`, `modal-footer` (relevé par le même
script au début et à la fin du lot). Au lot 3, un script écrit pour le lot
(celui du lot 2 n'est pas conservé), qui lit aussi les chaînes des
expressions conditionnelles (`active`, `checked`, `open`, `badge-inactive`,
`badge-moderator` servaient encore au départ), compte **151 classes mortes
sur 201 au départ, 174 à la fin** ; les 23 de plus : `modal-overlay`,
`modal`, `modal-header`, `modal-title`, `modal-close`, `data-card`,
`data-card-header`, `data-card-title`, `data-card-actions`,
`data-card-meta`, `cards-grid`, `inline-form`, `inline-form-grid`,
`inline-form-actions`, `tab-section-header`, `tab-section-title`,
`toggle-container`, `toggle-switch`, `campus-checkbox`,
`campus-checkbox-group`, `checked`, `badge-inactive`, `year-selector`. Elles
restent jusqu'au lot 6 : la couche `legacy` de `globals.css` ne change pas
avant (seuls ses `@source` changent, lot après lot).
