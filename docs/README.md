# Documentation — index

> **Depuis le 16 octobre 2026, le projet est d'abord un gestionnaire de
> contenu.** La recherche IA est gelée : code conservé tel quel, réservé à
> l'admin, sans nouveau développement. Plan en cours :
> [`features/gestion-contenu.md`](features/gestion-contenu.md).

Aucun document n'a été déplacé : les liens entre eux restent valables. Cet
index les range selon la partie du projet qu'ils servent.

---

## 1. Gestion de contenu — la partie vivante

| Document | Rôle |
|---|---|
| [`features/gestion-contenu.md`](features/gestion-contenu.md) | **le plan en cours** : décisions, étapes, journal (§9) |
| [`architecture/gestion-contenu.md`](architecture/gestion-contenu.md) | **l'état réel du code** : rôles, gardes, écrans, routes, tables, styles, tests |
| [`architecture/charte-graphique.md`](architecture/charte-graphique.md) | **la charte graphique** (étape 4) : couleurs, contrastes, polices, espacements, composants, gabarits, accessibilité, cohabitation avec l'ancien style |
| [`architecture/bdd.md`](architecture/bdd.md) | schéma de la base et migrations |
| [`architecture/API-rest.md`](architecture/API-rest.md) | l'API v1 (15 routes) |
| [`memory/memory-deploiement-vercel.md`](memory/memory-deploiement-vercel.md) | mettre le site en ligne : variables, base, Upstash, ordre des opérations |
| [`edgecase.md`](edgecase.md) | cas limites et parades (IA et contenu mêlés) |
| [`features/school-content-management.md`](features/school-content-management.md) | historique : le chantier qui a construit les onglets de gestion |
| [`cahier-des-charges-school-pipeline.md`](cahier-des-charges-school-pipeline.md) | exigences d'origine ; l'en-tête renvoie au plan d'évolution |

Le contenu stocké, présenté pour l'équipe : le doc « Données stockées sur les
écoles » du propriétaire
(<https://claude.ai/code/artifact/c898ac5d-5263-419c-af99-7932267be8b6>).

---

## 2. Recherche IA — gelée le 16 octobre 2026

À lire pour **répondre à une question** sur la partie IA, pas pour la faire
évoluer (plan `gestion-contenu.md` §6).

**Depuis l'étape 11 du plan (21 octobre 2026), son code vit sur la branche
`local`** du dépôt : le backend FastAPI, ses tests Python, la console
`/admin/cron` et ses routes, `npm run local` (D100, D101). Ces documents la
décrivent telle qu'elle y est. Sur `gestion` et `main` (la production), il
n'en reste que l'inbox, où l'admin valide les tickets de l'IA.

| Document | Rôle |
|---|---|
| [`architecture/architecture.md`](architecture/architecture.md) | référence technique v2.1 : pipeline Tavily + Gemini, Phases 1 et 2, crowdsourcing, sécurité (§10), outillage (§10 bis) |
| [`features/backend-local.md`](features/backend-local.md) | dernier chantier IA, **gelé** : backend lancé sur le poste, réseau, tests ; son journal (§11) tient tout l'historique jusqu'au 15 octobre |
| [`testing/manual_testing_cron.md`](testing/manual_testing_cron.md) | tester `/admin/cron` et le backend ; §1.3 : basculer le poste entre les branches Neon |
| [`testing/pipeline_simulation.md`](testing/pipeline_simulation.md) | simulations sans crédit |
| [`memory/decision-retention-tickets.md`](memory/decision-retention-tickets.md) | rétention des tickets en échec |
| [`architecture/gemma-python-guide.md`](architecture/gemma-python-guide.md) | appeler Gemma depuis Python |
| `features/` : `research-pipeline-plan.md`, `admin-cron-manual-research.md`, `api-key-optimization-plan.md`, `crowdsourcing-program-matching.md`, `cron-rotation-production.md`, `visibility_on_crontask.md`, `close_gate_connexion.md` | chantiers IA terminés ou remplacés, historiques |

---

## 3. Archives

`architecture/task.md`, `prompt/` (anciens prompts d'agent et plans
d'implémentation), `probleme.md` (vide). Historiques, non tenus à jour.
