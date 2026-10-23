# Documentation — index

Le projet, **Veille concurrentielle**, est un **gestionnaire de contenu** en
ligne sur les écoles françaises, derrière une connexion obligatoire. Ces documents décrivent la
branche `gestion` et `main` (la production, qui la suit par avance rapide).

| Document | Rôle |
|---|---|
| [`features/gestion-contenu.md`](features/gestion-contenu.md) | **le plan** : décisions (§2), pièges (§4), étapes (§5), journal (§9). Les décisions (G1 à G9, D1 à D123) que cite le code y sont expliquées |
| [`architecture/gestion-contenu.md`](architecture/gestion-contenu.md) | **l'état réel du code** : rôles, gardes, écrans, routes, tables, styles, tests, sécurité, outillage et CI |
| [`architecture/charte-graphique.md`](architecture/charte-graphique.md) | **la charte graphique** : couleurs, contrastes, polices, espacements, composants, gabarits, accessibilité, mise en œuvre |
| [`architecture/bdd.md`](architecture/bdd.md) | le schéma de la base, les migrations et leur lanceur, le cycle de vie d'un ticket de l'inbox |
| [`architecture/API-rest.md`](architecture/API-rest.md) | l'API v1 (15 routes) |
| [`memory/memory-deploiement-vercel.md`](memory/memory-deploiement-vercel.md) | la production sur Vercel : ce qui est en ligne, variables, base et bascule du poste, livrer une version, en-têtes et CSP à nonce, vérifications, dette connue, la base de CI éphémère |
| [`edgecase.md`](edgecase.md) | les cas limites du site et leurs parades |
| [`guide/`](guide/) | **les guides Word**, un par rôle (utilisateur, gestionnaire, administrateur), pour les collègues ; le même guide, sur le site : « Aide » (`/help`) |

Le contenu stocké, présenté pour l'équipe : le doc « Données stockées sur les
écoles » du propriétaire
(<https://claude.ai/code/artifact/c898ac5d-5263-419c-af99-7932267be8b6>).

## La partie IA, gelée

La recherche IA (backend FastAPI, pipeline Tavily + Gemini, console
`/admin/cron`) est gelée depuis le 16 octobre 2026 et vit sur la branche
**`local`**, lancée sur le poste de l'admin seulement ; sur cette branche, il
n'en reste que l'inbox, où l'admin valide les tickets. Ses documents
(référence technique, plan gelé et son journal, fiches de test, cas limites
de l'IA) sont sur `local` : `git ls-tree -r --name-only local -- docs`, puis
`git show local:<chemin>`, sans changer de branche.
