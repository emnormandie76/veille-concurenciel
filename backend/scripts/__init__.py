"""
Scripts de simulation et d'outillage du pipeline.

Ils vivaient a la racine de backend/, au milieu des modules de production, et
n'etaient distinguables que par leur nom. Ils ne sont jamais importes par
l'application : ils s'executent a la main, depuis la racine du depot.

    python -m backend.scripts.simulate_phase1_research --help
    python -m backend.scripts.simulate_phase2_research --help
    python -m backend.scripts.simulate_crowdsourcing
"""
