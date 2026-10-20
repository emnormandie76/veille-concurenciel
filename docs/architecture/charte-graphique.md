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
| Tableau | `Table.tsx` : `Table`, `THead`, `TBody`, `Tr`, `Th`, `Td` | `caption` (lu, pas affiché) ; en-têtes `scope="col"` ; `numeric` aligne à droite en chiffres tabulaires ; défile en largeur dans son cadre |
| Carte | `Card.tsx` : `Card`, `CardHeader` | un bloc détaché (formulaire, groupe de faits) ; `CardHeader` donne un titre `h2` et un `titleId` pour `aria-labelledby` |
| Onglets | `Tabs.tsx` : `Tabs`, `TabPanel` ; `tabs-keys.ts` | modèle ARIA : flèches gauche et droite (en boucle), Début, Fin ; un seul onglet dans l'ordre de tabulation ; compteur facultatif. Le filet du bas est une ombre intérieure, que couvre le soulignement de l'onglet choisi : rien ne déborde de la liste, qui défile en largeur sans barre verticale (corrigé à l'étape 6) |
| Badge | `Badge.tsx` | `neutral`, `accent`, `solid` (catégories : rôles) ; `success`, `warning`, `danger` (états) |
| Dialogue | `Dialog.tsx` : `Dialog`, `DialogFooter` | `<dialog>` natif ouvert par `showModal()` : focus gardé dans le dialogue, page inerte, focus rendu à la fermeture ; Échap et « Fermer » passent par `onClose`, qui peut refuser ; `data-autofocus` désigne le premier champ. Remplace `confirm()`. Un événement `close` du navigateur arrivé quand le dialogue est de nouveau ouvert est ignoré : sous `next dev`, React rejoue les effets, et le dialogue se refermait aussitôt ouvert (corrigé à l'étape 6) |
| Message | `Alert.tsx` | `danger` (`role="alert"`), `success` et `info` (`role="status"`) ; texte en encre, teinte portée par le fond et l'icône |
| Lien dans un texte | `text-link.ts` : `TEXT_LINK` | souligné, en `accent-strong` |

Rôles et états des comptes : `Utilisateur` neutre, `Gestionnaire` accent,
`Administrateur` plein ; `Invité` avertissement, `Actif` réussite,
`Désactivé` danger.

## 7. Gabarits

Dans [`components/layout/`](../../components/layout/). Leur racine porte la
classe `charte` (§9).

| Gabarit | Fichier | Emploi |
|---|---|---|
| Site | `SiteShell.tsx` | la barre du site (Écoles, API, Back-office pour qui y a droit, Mon compte, Se déconnecter), puis une colonne `narrow` (48 rem, formulaires) ou `wide` (72 rem) |
| Connexion | `AuthShell.tsx` | une colonne de 24 rem au centre : titre, carte du formulaire, lien vers l'autre page ; sans barre. `AuthShellLoading` pendant la lecture de l'adresse |
| Back-office | `AdminPage.tsx` | l'en-tête d'un écran (titre, explication, actions), puis son contenu ; se pose dans le cadre de `app/admin/layout.tsx`, dont le menu reste l'ancien jusqu'à l'étape 9 |

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

## 9. Mise en œuvre, jusqu'à l'étape 9

L'ancien style et la charte cohabitent (plan, G7 et piège 10).

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
  `app/account/`, et depuis l'étape 6 `app/schools/[id]/report/` et
  `app/admin/reports/` : un chemin qui existe est lu à la lettre, crochets
  compris), avec `source(none)` sur l'import des utilitaires : un ancien
  nom de classe qui serait aussi un utilitaire n'en reçoit pas les règles.
  `block` et `fill-accent`, deux classes de `/admin/cron`, ne sont jamais
  générés (`@source not inline`) : un écran de la charte ne s'en sert pas
  (une colonne flex à la place de `block`).
- **Transition du back-office** : `.admin-content-area:has(.charte)` peint
  toute la zone de contenu au fond de la charte quand l'écran est repris.
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

**Restes pour l'étape 9** : le menu latéral et le cadre du back-office (jetons
`side-*`), le preflight à la place de la base `.charte`, les classes mortes de
l'ancien CSS (celles des écrans repris : `login-*`, `account-*`,
`users-actions`, `badge-user`, `badge-invited`, `user-secondary`,
`modal-text`…), la règle de transition `:has()`, Inter.
