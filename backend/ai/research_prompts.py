"""
backend/ai/research_prompts.py — Briefs de recherche pour Tavily Research

Ce module construit les questions posées à l'agent Tavily Research. Ce ne sont
plus des spécifications de champs, ce sont des BRIEFS : on commande un rapport,
avec un plan.

## Pourquoi ce changement

Les prompts de la Phase 2 étaient écrits comme des formulaires — « INFORMATIONS
RECHERCHÉES : 1. year_1_fee, 2. year_2_fee… ». Ils parlaient à un extracteur.
L'interlocuteur est un agent de recherche : la structure est désormais garantie
en aval par Gemini (backend/ai/extraction_schemas.py), et ce module n'a plus
qu'à obtenir un rapport riche et sourcé.

Quatre ingrédients, mesurés sur les briefs qui ont donné 14 sources et 10
classements là où le pipeline en rendait 1 :
  - énumérer les sources attendues, comme une check-list — c'est ce qui empêche
    l'agent de s'arrêter au premier résultat ;
  - demander explicitement l'exhaustivité (« TOUS », « chaque année ») ;
  - nommer les distinctions qui comptent — programme contre école, UE contre
    hors UE, initial contre alternance ;
  - réclamer les URL sources, qui alimentent `source_url` et la colonne `urls`
    du ticket.
Plus un plan de rapport imposé, dont les sections « Conflits et incertitudes »
et « Evidence gaps » alimentent `data_conflict_warning`.

## L'exception : build_phase1_research_input

Ce builder est INCHANGÉ, et il doit le rester. Il a été comparé à un brief en
langage naturel sur la même école : le prompt du dépôt sort des intitulés plus
propres, tandis que le brief naturel produit trois entrées pour un même
programme (« Master in Management », « Programme Grande École / Master in
Management », « Programme Grande École »). Le réécrire ferait régresser la
Phase 1. La seule ligne à supprimer côté Phase 1 était `output_schema`.

## include_domains n'est plus uniforme

Le paramètre est une préférence molle, pas un filtre — 16 sources hors domaine
sont revenues avec le filtre actif. Il reste posé pour Pricing, SchoolStats,
Accreditation et Program_Discovery, où il oriente vers la bonne source ; il est
retiré pour Ranking et Capacity, dont la donnée vit chez des tiers. Les bonnes
sources y sont nommées dans le texte du brief à la place. Le réglage est appliqué
par les appelants (backend/pipeline/phase2_research.py) ; les docstrings ci-dessous
rappellent lequel s'applique à chaque brief.

Référence : dossier « Le rapport avant le schéma », sections 03, 04 et 09.
"""

def build_phase1_research_input(school_name: str, domain: str) -> str:
    """
    Construit le prompt de recherche pour la Phase 1 (Program Discovery).
    """
    return f"""Effectue une recherche exhaustive sur l'établissement d'enseignement supérieur français "{school_name}" (site officiel : https://{domain}).

OBJECTIF : Identifier TOUS les campus et programmes/formations proposés par cette école.

INFORMATIONS RECHERCHÉES PAR CAMPUS :
1. Nom exact du campus (tel qu'écrit sur le site officiel de l'école)
2. Ville du campus

INFORMATIONS RECHERCHÉES PAR PROGRAMME/FORMATION :
1. Nom exact du programme (tel qu'affiché sur le site officiel)
2. Concours d'admission requis (ex: "Concours Sésame", "Concours Accès", "Parcoursup") — ou null si non trouvé
3. L'alternance est-elle possible ? (true/false/null si inconnu)
4. Un séjour à l'étranger est-il obligatoire ? (true/false/null si inconnu)

RÈGLES STRICTES :
- Ne lister que les formations diplômantes principales (Bachelor, Master, PGE, MBA, MSc, BBA, IBBA, etc.)
- NE PAS lister les formations continues, les DU, les certificats courts ou les modules individuels
- Utiliser les NOMS EXACTS tels qu'écrits sur le site officiel (pas de traduction, pas de simplification)
- Si un campus n'a pas de nom distinct, utiliser "Campus [Ville]"
- Si l'information n'est pas trouvable, mettre null plutôt qu'inventer
- Privilégier les informations du site officiel https://{domain}"""



# ── Le plan de rapport imposé aux briefs de la Phase 2 ────────────
#
# Les deux dernières sections ne sont pas décoratives. Le rapport C les a
# produites spontanément, et c'est là que se lisent les contradictions entre
# sources — celles qui alimentent data_conflict_warning à l'extraction. Sur le
# Pricing, un rapport a signalé de lui-même deux totaux divergents publiés par
# la presse, 68 750 € contre 69 750 €.
_REPORT_PLAN = """
PLAN DU RAPPORT ATTENDU :
1. Les données trouvées, une section par élément, chacune avec son URL source.
2. « Conflits et incertitudes » : les points sur lesquels les sources se
   contredisent, avec les valeurs de chacune.
3. « Evidence gaps » : ce que tu as cherché sans le trouver, et où tu as cherché."""


def build_pricing_research_input(
    school_name: str, program_name: str,
    academic_year_str: str, domain: str
) -> str:
    """
    Brief de recherche Phase 2 — Pricing.

    Le tarif est identique quel que soit le campus (niveau programme-école).
    include_domains est CONSERVÉ pour cette catégorie : le site officiel est la
    source de vérité d'un tarif.
    """
    return f"""Quels sont TOUS les frais de scolarité du programme "{program_name}" de l'école "{school_name}" pour l'année scolaire {academic_year_str} ?

Rédige un rapport de recherche documenté. Pour chaque montant trouvé, donne la
somme exacte, ce qu'elle couvre, l'année concernée et l'URL de la page source.

CE QU'IL FAUT COUVRIR :
- Le tarif de CHAQUE année du cursus, année par année — pas seulement la
  première. Précise combien d'années compte le cursus.
- Le coût total du cursus, uniquement s'il est publié tel quel.
- Les tarifs pour étudiants hors Union européenne. Dis explicitement s'il n'en
  existe pas de distinct : c'est une information en soi.
- Tous les frais annexes, même en petits caractères : frais de dossier, CVEC,
  frais de concours, cotisation à l'association des étudiants, arrhes,
  Parcoursup, cotisation alumni, année optionnelle à l'étranger.
- La devise, si elle n'est pas l'euro.

DISTINCTIONS À NE PAS ÉCRASER :
- Tarif UE contre tarif hors UE.
- Formation initiale contre alternance : le coût n'est pas le même, et en
  alternance il est souvent pris en charge.
- Tarif par année contre coût total du cursus.

OÙ CHERCHER : d'abord le site officiel https://{domain} (pages « frais de
scolarité », « tarifs », « admissions », « financer ses études »), puis les
sites de concours et la presse spécialisée pour recouper.

Si {academic_year_str} n'est pas encore publiée, prends la dernière année
disponible et dis-le explicitement.
{_REPORT_PLAN}"""


def build_ranking_research_input(
    school_name: str, program_names: list[str], academic_year_str: str, domain: str
) -> str:
    """
    Brief de recherche Phase 2 — Ranking, au NIVEAU ÉCOLE.

    Ranking tournait par programme : dix appels `pro` facturés pour une
    information qui tient en un. Un même rapport ramène les classements de
    programme ET les classements d'école ; l'extraction ventile ensuite par
    programme via `program_hint`. Économie mesurée : 20 → 11 appels pro pour une
    école de dix programmes.

    include_domains est RETIRÉ pour cette catégorie : les classements vivent
    chez Le Figaro et Challenges, pas sur le site de l'école. Une école ne
    publie chez elle que le palmarès qui l'arrange — c'est exactement ce qui
    faisait tomber le pipeline à un seul classement, tiré d'un communiqué de
    presse de l'établissement.

    Args:
        program_names: Programmes de l'école, énumérés dans le brief pour que
            l'agent sache quoi distinguer.
    """
    programs_block = "\n".join(f"- {name}" for name in program_names) or "- (aucun programme enregistré)"

    return f"""Quels sont TOUS les classements de l'école "{school_name}" et de ses programmes, pour les palmarès {academic_year_str} et les deux années précédentes ?

Rédige un rapport de recherche documenté. Ne t'arrête pas au premier classement
trouvé : un établissement de ce type figure dans huit à quinze palmarès.

CLASSEMENTS À VÉRIFIER UN PAR UN — traite cette liste comme une check-list, et
dis explicitement pour chacun s'il classe cette école ou non :
- Le Figaro Étudiant
- L'Étudiant
- Le Parisien Étudiant
- Le Point
- Challenges
- SIGEM (classement issu des choix des étudiants)
- Financial Times (Masters in Management, European Business Schools)
- QS World University Rankings
- Tout autre palmarès national ou international qui cite l'école

POUR CHAQUE CLASSEMENT TROUVÉ :
- Le nom du média et l'intitulé exact du palmarès.
- Le rang précis obtenu.
- L'année du palmarès telle que le média l'annonce.
- Le nombre d'établissements classés.
- L'URL de la page du classement.

DISTINCTION CAPITALE — classement d'école ou de programme :
Certains palmarès classent l'établissement dans son ensemble, d'autres une
formation précise. Dis systématiquement lequel des deux, et quand c'est une
formation, laquelle. Les programmes de cette école sont :
{programs_block}

OÙ CHERCHER : chez les médias eux-mêmes (lefigaro.fr, letudiant.fr,
leparisien.fr, lepoint.fr, challenges.fr, rankings.ft.com, topuniversities.com),
et chez les agrégateurs spécialisés (thotismedia.com, campusfrance.org,
prepa-hec, forums de concours). Le site {domain} ne publie que les palmarès qui
l'avantagent : ne t'y limite pas.

Couvre plusieurs années : un palmarès 2025 et un palmarès 2026 sont deux
résultats distincts, tous les deux à rapporter.
{_REPORT_PLAN}"""


def build_capacity_research_input(
    school_name: str, campus_name: str, program_name: str,
    academic_year_str: str, domain: str
) -> str:
    """
    Brief de recherche Phase 2 — Capacity.

    include_domains est RETIRÉ pour cette catégorie : les places se publient
    chez les concours et sur Parcoursup, pas sur les pages de l'école. Les
    sources utiles sont nommées dans le texte du brief.
    """
    return f"""Combien de places sont ouvertes à l'admission dans le programme "{program_name}" au campus "{campus_name}" de l'école "{school_name}" pour la rentrée {academic_year_str} ?

Rédige un rapport de recherche documenté. Donne les chiffres exacts, jamais des
ordres de grandeur, et l'URL de la page source pour chacun.

CE QU'IL FAUT COUVRIR :
- Le nombre de places par VOIE D'ADMISSION : concours SESAME, concours ACCÈS,
  Parcoursup, admissions parallèles, admissions internationales. Chaque voie est
  un chiffre distinct.
- Le total toutes voies confondues s'il est publié tel quel. Ne l'additionne pas
  toi-même.
- Les places propres à ce campus, si la répartition par campus est publiée.

DISTINCTIONS À NE PAS ÉCRASER :
- Places ouvertes au concours contre effectif total de la promotion : seule la
  première est une capacité d'admission.
- Places de cette rentrée contre places de la rentrée précédente : donne
  l'année pour chaque chiffre.
- Places de ce campus contre places de l'école entière.

OÙ CHERCHER : concours-sesame.net, concours-acces.com, Parcoursup et ses
statistiques publiques, les notes des jurys de concours, la presse spécialisée,
et le site {domain} en complément.

Si le chiffre n'est pas publié pour cette rentrée, dis-le clairement et donne le
dernier connu avec son année.
{_REPORT_PLAN}"""


def build_school_stats_research_input(
    school_name: str, academic_year_str: str, domain: str
) -> str:
    """
    Brief de recherche Phase 2 — SchoolStats.

    include_domains est CONSERVÉ : les chiffres clés d'une école sont publiés
    par l'école.
    """
    return f"""Quels sont les chiffres clés de l'école "{school_name}" pour l'année {academic_year_str}, ou la plus récente publiée ?

Rédige un rapport de recherche documenté. Pour chaque chiffre, donne la valeur
exacte, l'année à laquelle il se rapporte et l'URL de la page source.

CHIFFRES À CHERCHER, un par un :
- Nombre total d'étudiants inscrits.
- Nombre de diplômés (alumni) depuis la création.
- Nombre d'entreprises partenaires.
- Nombre d'offres de stage reçues chaque année.
- Nombre de campus à l'étranger.
- Nombre d'universités partenaires à l'international.
- Nombre d'enseignants-chercheurs permanents.
- Part de professeurs internationaux, en pourcentage.
- Part d'intervenants extérieurs, en pourcentage.

DISTINCTIONS À NE PAS ÉCRASER :
- Étudiants de l'année en cours contre alumni cumulés depuis l'origine.
- Professeurs permanents contre vacataires et intervenants extérieurs.
- Campus à l'étranger contre universités partenaires : ce ne sont pas les
  mêmes objets.
- Chiffres de l'école entière contre chiffres d'un campus.

OÙ CHERCHER : d'abord https://{domain} — pages « chiffres clés », « en bref »,
« key figures », « l'école en chiffres », rapport annuel, media-kit — puis
Campus France, la Conférence des Grandes Écoles et la presse spécialisée pour
recouper.

Un chiffre qui varie d'une source à l'autre doit être signalé, pas moyenné.
{_REPORT_PLAN}"""


def build_accreditation_research_input(
    school_name: str, domain: str
) -> str:
    """
    Brief de recherche Phase 2 — Accreditation.

    include_domains est CONSERVÉ : une école publie ses propres accréditations,
    et les organismes accréditeurs confirment.
    """
    return f"""Quelles sont TOUTES les accréditations, labels et reconnaissances de l'école "{school_name}" ?

Rédige un rapport de recherche documenté. Pour chacune, donne son nom exact,
l'organisme qui la délivre, l'année d'obtention ou du dernier renouvellement, sa
validité actuelle, et l'URL de la page source.

À VÉRIFIER UN PAR UN — traite cette liste comme une check-list, et dis
explicitement si l'école la détient ou non :
- Accréditations internationales : EQUIS, AACSB, AMBA, EPAS, BSIS, ABET, FIBAA.
- Reconnaissances d'État françaises : Grade de Licence, Grade de Master, visa du
  ministère, CTI, CEFDG, HCERES.
- Labels : CGE (Conférence des Grandes Écoles), EESPIG, Qualiopi, DD&RS, SD&RS,
  « Bienvenue en France », et tout autre label affiché par l'école.

DISTINCTIONS À NE PAS ÉCRASER :
- Accréditation de l'établissement contre accréditation d'un programme précis :
  EQUIS accrédite l'école, EPAS accrédite un programme.
- Accréditation en cours de validité contre accréditation expirée, perdue ou
  simplement candidate. Une école « en cours d'accréditation » ne l'a pas.
- Année de première obtention contre année du dernier renouvellement : donne les
  deux quand elles sont publiées.

OÙ CHERCHER : https://{domain} (pages « accréditations », « labels »,
« reconnaissances »), puis les annuaires des organismes eux-mêmes — efmd.org
pour EQUIS et EPAS, aacsb.edu, associationofmbas.com, cge.asso.fr — qui font
foi sur la validité.

Si l'année d'obtention n'est publiée nulle part, dis-le : c'est mieux qu'une
année approximative.
{_REPORT_PLAN}"""
