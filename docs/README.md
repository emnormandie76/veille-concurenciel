# Documentation — index (branche `local`)

Cette branche est celle de l'IA, gelée depuis le 16 octobre 2026 : un
instantané de `gestion` à la fin de l'étape 10 du plan (`e4ba0c5`), qui garde
le backend FastAPI, ses tests et la console `/admin/cron`. Elle se lance sur
le poste de l'admin ; Vercel ne la construit pas. Le chantier du gestionnaire
de contenu et la production se suivent sur `gestion` :
`git show gestion:docs/README.md`.

## La recherche IA

À lire pour **répondre à une question** sur la partie IA ou la lancer, pas
pour la faire évoluer (gel).

| Document | Rôle |
|---|---|
| [`architecture/architecture.md`](architecture/architecture.md) | **la référence technique** : pipeline Tavily + Gemini, Phases 1 et 2, crowdsourcing, sécurité (§10), outillage (§10 bis) |
| [`features/backend-local.md`](features/backend-local.md) | le dernier chantier IA, **gelé** : backend lancé sur le poste, réseau, tests ; son journal (§11) tient tout l'historique jusqu'au 16 octobre |
| [`testing/manual_testing_cron.md`](testing/manual_testing_cron.md) | tester `/admin/cron` et le backend ; §1.3 : basculer le poste entre les branches Neon |
| [`testing/pipeline_simulation.md`](testing/pipeline_simulation.md) | simulations sans crédit |
| [`tutoriel-demo.md`](tutoriel-demo.md) | préparer et dérouler une démonstration |
| [`memory/decision-retention-tickets.md`](memory/decision-retention-tickets.md) | rétention des tickets en échec |
| [`architecture/gemma-python-guide.md`](architecture/gemma-python-guide.md) | appeler Gemma et la cascade Gemini depuis Python |
| [`features/cron-rotation-production.md`](features/cron-rotation-production.md) | la rotation des recherches, remplacée par les passes dues ; historique et chiffrage, cité par les tests |
| [`architecture/task.md`](architecture/task.md) | le plan de construction initial, terminé ; historique, cité par le code |
| [`cahier-des-charges-school-pipeline.md`](cahier-des-charges-school-pipeline.md) | les exigences d'origine |
| [`edgecase.md`](edgecase.md) | les cas limites et leurs parades, IA comprise |

## Le gestionnaire de contenu, tel qu'il est sur cette branche

| Document | Rôle |
|---|---|
| [`architecture/gestion-contenu.md`](architecture/gestion-contenu.md) | l'état du code à l'étape 10 : rôles, gardes, écrans (console comprise), routes, tables, styles, tests |
| [`architecture/charte-graphique.md`](architecture/charte-graphique.md) | la charte graphique |
| [`architecture/bdd.md`](architecture/bdd.md) | le schéma de la base et les migrations |
| [`architecture/API-rest.md`](architecture/API-rest.md) | l'API v1 (15 routes) |
| [`memory/memory-deploiement-vercel.md`](memory/memory-deploiement-vercel.md) | la mise en ligne, telle qu'à l'étape 10 ; la version à jour est sur `gestion` |
