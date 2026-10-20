/**
 * app/api-docs/endpoints.ts — Contenu de la page /api-docs
 *
 * Une fiche par route de `app/api/v1`. Les paramètres sont ceux que la route
 * lit, et chaque exemple de réponse a la forme exacte de la réponse réelle :
 * `test/api-docs.test.ts` le vérifie route par route. Jusqu'au 15 octobre
 * 2026, cette page décrivait une API imaginaire (champs inventés, paramètres
 * obligatoires qui ne l'étaient pas).
 *
 * Les données des exemples sont fictives : une école inventée, des
 * identifiants au format des vrais (UUID).
 *
 * Plan gestion-contenu, étape 5 : chaque donnée porte la date de sa dernière
 * modification (`updated_at`) et, pour les chiffres clés, les accréditations
 * et les programmes, son lien source (`source_url`). Ni l'auteur ni l'origine :
 * une donnée lue par l'API est tenue pour vérifiée (D25, revue le
 * 20 octobre). Les simples renvois (l'école d'un programme, le programme d'un
 * campus) n'en portent pas.
 *
 * Étape 8 (D53) : le détail d'un programme et la comparaison portent ses
 * admissions (`entries`), avec leur lien source et leur date.
 */

export interface EndpointParam {
  name: string;
  /** `path` : segment `[id]` du chemin ; `query` : paramètre de requête. */
  in: "path" | "query";
  type: string;
  required: boolean;
  description: string;
  /** Valeur mise dans l'URL d'exemple (paramètres de requête). */
  example?: string;
}

export interface Endpoint {
  id: string;
  method: "GET";
  path: string;
  title: string;
  description: string;
  category: "schools" | "campuses" | "programs" | "pricing" | "rankings" | "capacity" | "compare" | "introduction";
  params: EndpointParam[];
  mockResponse: Record<string, unknown> | unknown[];
}

/** Identifiants des exemples : fictifs, au format des vrais. */
export const EXAMPLE_IDS = {
  school: "6f1c2a9e-3b4d-4e8f-9a7b-0c1d2e3f4a5b",
  campus: "2d8e4f6a-7b9c-4d1e-8f2a-3b4c5d6e7f80",
  program: "9a3b5c7d-1e2f-4a6b-8c9d-0e1f2a3b4c5d",
  otherProgram: "4c6e8a0b-2d4f-4b6d-9e8f-1a2b3c4d5e6f",
} as const;

const PROGRAM_CAMPUS_ID = "7e9f1a3b-5c7d-4e9f-8a1b-2c3d4e5f6a7b";
const OTHER_PROGRAM_CAMPUS_ID = "1b3d5f7a-9c1e-4a3b-8d5f-6a7b8c9d0e1f";

// ── Briques des exemples ────────────────────────────────────────────────

// La date de la dernière modification d'une donnée ; `null` pour une donnée
// d'avant le suivi.
const EDITED = { updated_at: "2026-10-19T08:30:00.000Z" };
const EDITED_EARLIER = { updated_at: "2026-10-12T14:05:00.000Z" };
const UNTRACKED = { updated_at: null };

const SCHOOL = {
  id: EXAMPLE_IDS.school,
  name: "École de Commerce Exemple",
  official_domain: "ecole-exemple.fr",
};

const CAMPUS = { id: EXAMPLE_IDS.campus, name: "Lyon", city: "Lyon" };

const PROGRAM = {
  id: EXAMPLE_IDS.program,
  schoolId: EXAMPLE_IDS.school,
  name: "Programme Grande École",
  admission_exam: "Passerelle",
  is_alternance_possible: true,
  is_expatriation_mandatory: true,
  min_expatriation_months: 6,
  max_internship_months: 12,
};

const OTHER_PROGRAM = {
  id: EXAMPLE_IDS.otherProgram,
  schoolId: EXAMPLE_IDS.school,
  name: "Bachelor in Management",
  admission_exam: "Concours Sésame",
  is_alternance_possible: false,
  is_expatriation_mandatory: false,
  min_expatriation_months: null,
  max_internship_months: 6,
};

/** Un programme quand il est la donnée rendue, et non un simple renvoi. */
const PROGRAM_DATA = { ...PROGRAM, source_url: "https://www.ecole-exemple.fr/programme-grande-ecole", ...EDITED_EARLIER };
const OTHER_PROGRAM_DATA = { ...OTHER_PROGRAM, source_url: null, ...UNTRACKED };

const CAPACITY = {
  id: "3f5a7c9e-1b3d-4f5a-8c7e-9b1d3f5a7c9e",
  academic_year: 2026,
  spots_available: 420,
  source_url: "https://www.ecole-exemple.fr/programme-grande-ecole/admissions",
  ...EDITED,
};

// Tarifs et classements sans `programId` : la comparaison les lit sous leur
// programme et ne sélectionne pas ce champ.
const PRICING_FIELDS = {
  academic_year: 2026,
  currency: "EUR",
  year_1_fee: 15200,
  year_2_fee: 15200,
  year_3_fee: 15600,
  year_4_fee: null,
  year_5_fee: null,
  total_fee: 46000,
  intl_year_1_fee: 17500,
  intl_total_fee: 52500,
  intl_currency: "EUR",
  additional_fees_notes: "Frais de concours en sus.",
  source_url: "https://www.ecole-exemple.fr/programme-grande-ecole/frais-de-scolarite",
  ...EDITED,
};
const PRICING_ID = "8d0f2b4c-6e8a-4c0e-9b2d-4f6a8c0e2b4d";
const PRICING = { id: PRICING_ID, programId: EXAMPLE_IDS.program, ...PRICING_FIELDS };

const RANKING_FIELDS = {
  academic_year: 2026,
  ranking_name: "Le Figaro Étudiant",
  rank: 14,
  source_url: "https://etudiant.lefigaro.fr/classement-ecoles-de-commerce",
  ...EDITED_EARLIER,
};
const RANKING_ID = "5b7d9f1a-3c5e-4a7b-9d1f-3a5c7e9b1d3f";
const RANKING = { id: RANKING_ID, programId: EXAMPLE_IDS.program, ...RANKING_FIELDS };

const PROGRAM_CAMPUS = { id: PROGRAM_CAMPUS_ID, campus: CAMPUS };

// Les admissions d'un programme (plan gestion-contenu, étape 8, D53), dans
// l'ordre de l'année d'entrée, puis du niveau requis.
const ENTRIES = [
  {
    id: "6a8c0e2b-4d6f-4a8c-9e0b-2d4f6a8c0e2b",
    entry_year: 1,
    required_level: 2,
    route: "EXAM",
    note: "Concours BCE, après une classe préparatoire.",
    source_url: "https://www.ecole-exemple.fr/programme-grande-ecole/admissions",
    ...EDITED,
  },
  {
    id: "b2d4f6a8-0c2e-4b4d-8f6a-8c0e2b4d6f8a",
    entry_year: 2,
    required_level: 4,
    route: "TITLE",
    note: null,
    source_url: null,
    ...UNTRACKED,
  },
];

const PAGINATION = (limit: number) => ({
  page: 1,
  limit,
  total: 1,
  total_pages: 1,
  has_next: false,
  has_prev: false,
});

// ── Paramètres communs ──────────────────────────────────────────────────

const pathId = (what: string): EndpointParam => ({
  name: "id",
  in: "path",
  type: "uuid",
  required: true,
  description: `Identifiant ${what}.`,
});

const year = (what: string): EndpointParam => ({
  name: "year",
  in: "query",
  type: "integer",
  required: false,
  description: `Ne garder que l'année académique indiquée ${what} (ex : 2026). Une valeur non numérique donne 400.`,
  example: "2026",
});

const page: EndpointParam = {
  name: "page",
  in: "query",
  type: "integer",
  required: false,
  description: "Numéro de page, à partir de 1 (défaut : 1).",
  example: "1",
};

const limit = (byDefault: number): EndpointParam => ({
  name: "limit",
  in: "query",
  type: "integer",
  required: false,
  description: `Résultats par page, de 1 à 100 (défaut : ${byDefault}). Une valeur hors bornes est ramenée dans les bornes.`,
  example: String(byDefault),
});

// ── Les fiches ──────────────────────────────────────────────────────────

export const endpoints: Endpoint[] = [
  {
    id: "intro-auth",
    method: "GET",
    path: "",
    title: "Authentification, limites et erreurs",
    description:
      "L'API v1 d'EduData France est en lecture seule et réservée aux personnes connectées : elle lit la session du site. " +
      "Depuis ce navigateur, une fois connecté, les appels passent ; sans session, la réponse est 401. " +
      "Les exemples curl et Python ne passent donc pas tels quels, et un autre site ne peut pas l'appeler : des clés d'API pourront s'ajouter si un usage externe apparaît. " +
      "Seules les écoles actives sont exposées ; les identifiants sont des UUID. " +
      "Limite : 60 requêtes par minute et par adresse IP, au-delà la réponse est 429 avec un en-tête `Retry-After`. " +
      "Les listes paginées rendent `{ data, pagination }` ; les autres listes, un tableau. " +
      "Une erreur rend `{ \"error\": \"…\" }` : 401 sans session, 400 pour un paramètre invalide, 404 pour une ressource introuvable ou inactive, 500 pour une erreur interne. " +
      "Chaque donnée dit d'où elle vient et de quand elle date : `source_url` (le lien de sa source, quand il est connu) et `updated_at` (sa dernière modification, " +
      "`null` pour une donnée d'avant le suivi des modifications). Une donnée rendue par l'API a été vérifiée par l'équipe. " +
      "Exemple ci-contre : une école introuvable.",
    category: "introduction",
    params: [],
    mockResponse: { error: "École introuvable" },
  },
  {
    id: "get-schools",
    method: "GET",
    path: "/api/v1/schools",
    title: "Liste des écoles actives",
    description: "Retourne la liste paginée des écoles actives, triée par nom.",
    category: "schools",
    params: [
      {
        name: "search",
        in: "query",
        type: "string",
        required: false,
        description: "Recherche dans le nom de l'école, sans tenir compte de la casse (ex : exemple).",
        example: "exemple",
      },
      page,
      limit(20),
    ],
    mockResponse: {
      data: [{ ...SCHOOL, status: "ACTIVE", ...EDITED }],
      pagination: PAGINATION(20),
    },
  },
  {
    id: "get-school-detail",
    method: "GET",
    path: "/api/v1/schools/[id]",
    title: "Détail d'une école",
    description: "Retourne une école active. Une école inconnue ou inactive donne 404.",
    category: "schools",
    params: [pathId("de l'école")],
    mockResponse: { ...SCHOOL, status: "ACTIVE", ...EDITED },
  },
  {
    id: "get-school-stats",
    method: "GET",
    path: "/api/v1/schools/[id]/stats",
    title: "Statistiques d'une école",
    description:
      "Retourne les statistiques d'une école pour une année : effectifs, diplômés, entreprises et universités partenaires, corps professoral. " +
      "Sans `year`, l'année la plus récente. Une école sans statistiques pour cette année donne 404 « Statistiques introuvables ».",
    category: "schools",
    params: [pathId("de l'école"), year("(défaut : la plus récente)")],
    mockResponse: {
      id: "0e2a4c6e-8b0d-4f2a-9c4e-6b8d0f2a4c6e",
      schoolId: EXAMPLE_IDS.school,
      academic_year: 2026,
      total_students: 7200,
      total_alumni: 31000,
      partner_companies: 1200,
      annual_internship_offers: 3500,
      abroad_campuses: 2,
      partner_universities: 210,
      permanent_professors: 140,
      international_professors_pct: 42.5,
      external_speakers_pct: 30,
      source_url: "https://www.ecole-exemple.fr/l-ecole/chiffres-cles",
      ...EDITED_EARLIER,
    },
  },
  {
    id: "get-school-accreditations",
    method: "GET",
    path: "/api/v1/schools/[id]/accreditations",
    title: "Accréditations d'une école",
    description:
      "Retourne les accréditations en vigueur d'une école, de la plus récente à la plus ancienne. " +
      "`accreditation_type` vaut `international` (EQUIS, AACSB, AMBA…), `label` (CGE…) ou `state` (grade de master, CTI…). " +
      "`year_obtained` vaut `null` quand l'année n'est pas publiée.",
    category: "schools",
    params: [pathId("de l'école")],
    mockResponse: [
      {
        id: "a1c3e5f7-9b1d-4f3a-8c5e-7a9b1c3d5e7f",
        schoolId: EXAMPLE_IDS.school,
        accreditation_name: "EQUIS",
        accreditation_type: "international",
        year_obtained: 2021,
        is_active: true,
        source_url: "https://www.ecole-exemple.fr/l-ecole/accreditations",
        ...EDITED,
      },
      {
        id: "c3e5a7b9-1d3f-4b5c-9e7a-9c1d3e5f7a9b",
        schoolId: EXAMPLE_IDS.school,
        accreditation_name: "Grade de Master",
        accreditation_type: "state",
        year_obtained: null,
        is_active: true,
        source_url: null,
        ...UNTRACKED,
      },
    ],
  },
  {
    id: "get-school-campuses",
    method: "GET",
    path: "/api/v1/schools/[id]/campuses",
    title: "Campus d'une école",
    description: "Retourne les campus d'une école active, triés par nom.",
    category: "campuses",
    params: [pathId("de l'école")],
    mockResponse: [
      { id: EXAMPLE_IDS.campus, schoolId: EXAMPLE_IDS.school, name: "Lyon", city: "Lyon", ...EDITED },
      { id: "e5a7c9d1-3f5b-4d7e-8a9c-1e3f5a7b9c1d", schoolId: EXAMPLE_IDS.school, name: "Paris", city: "Paris", ...UNTRACKED },
    ],
  },
  {
    id: "get-campus-detail",
    method: "GET",
    path: "/api/v1/campuses/[id]",
    title: "Détail d'un campus",
    description:
      "Retourne un campus et les programmes qui y sont ouverts. Chaque élément de `programCampuses` est l'association " +
      "entre le programme et ce campus ; son `id` est celui qu'utilisent les capacités.",
    category: "campuses",
    params: [pathId("du campus")],
    mockResponse: {
      id: CAMPUS.id,
      schoolId: EXAMPLE_IDS.school,
      name: CAMPUS.name,
      city: CAMPUS.city,
      ...EDITED,
      programCampuses: [
        { id: PROGRAM_CAMPUS_ID, program: PROGRAM },
        { id: OTHER_PROGRAM_CAMPUS_ID, program: OTHER_PROGRAM },
      ],
    },
  },
  {
    id: "get-school-programs",
    method: "GET",
    path: "/api/v1/schools/[id]/programs",
    title: "Programmes d'une école",
    description:
      "Retourne les programmes d'une école active, triés par nom, avec les campus où chacun est ouvert. " +
      "Un programme appartient à l'école ; il peut être ouvert sur plusieurs campus.",
    category: "programs",
    params: [
      pathId("de l'école"),
      {
        name: "campus_id",
        in: "query",
        type: "uuid",
        required: false,
        description: "Ne garder que les programmes ouverts sur ce campus.",
        example: EXAMPLE_IDS.campus,
      },
    ],
    mockResponse: [{ ...PROGRAM_DATA, campuses: [PROGRAM_CAMPUS] }],
  },
  {
    id: "get-program-detail",
    method: "GET",
    path: "/api/v1/programs/[id]",
    title: "Détail d'un programme",
    description:
      "Retourne un programme, son école et ses campus. Pour chaque campus, `capacityRecords` porte les trois années " +
      "de places disponibles les plus récentes. Les admissions (`entries`) disent en quelle année du programme on entre " +
      "(`entry_year`, de 1 à 5), avec quel niveau (`required_level` : 0 pour le Bac, de 1 à 5 pour Bac+1 à Bac+5) et par " +
      "quelle voie (`route` : `PARCOURSUP`, `EXAM` pour un concours, `TITLE` pour une admission sur titre, `INTERNATIONAL` " +
      "pour les candidats internationaux, `UNSPECIFIED` si elle n'est pas précisée) ; `note` nomme le concours ou les diplômes acceptés.",
    category: "programs",
    params: [pathId("du programme")],
    mockResponse: {
      ...PROGRAM_DATA,
      school: { ...SCHOOL, status: "ACTIVE" },
      campuses: [{ ...PROGRAM_CAMPUS, capacityRecords: [CAPACITY] }],
      entries: ENTRIES,
    },
  },
  {
    id: "get-programs-search",
    method: "GET",
    path: "/api/v1/programs",
    title: "Recherche globale de programmes",
    description: "Recherche des programmes dans toutes les écoles actives, avec filtres et pagination, triés par nom.",
    category: "programs",
    params: [
      {
        name: "search",
        in: "query",
        type: "string",
        required: false,
        description: "Recherche dans le nom du programme ou dans celui de son école, sans tenir compte de la casse.",
        example: "grande",
      },
      {
        name: "admission_exam",
        in: "query",
        type: "string",
        required: false,
        description: "Recherche dans le concours d'admission, sans tenir compte de la casse (ex : passerelle).",
        example: "passerelle",
      },
      {
        name: "alternance",
        in: "query",
        type: "boolean",
        required: false,
        description: "`true` : programmes ouverts à l'alternance ; toute autre valeur : programmes qui ne le sont pas. Absent : pas de filtre.",
        example: "true",
      },
      page,
      limit(20),
    ],
    mockResponse: {
      data: [{ ...PROGRAM_DATA, school: SCHOOL, campuses: [PROGRAM_CAMPUS] }],
      pagination: PAGINATION(20),
    },
  },
  {
    id: "get-program-pricing",
    method: "GET",
    path: "/api/v1/programs/[id]/pricing",
    title: "Tarifs d'un programme",
    description:
      "Retourne les frais de scolarité d'un programme, année par année, de la plus récente à la plus ancienne. " +
      "Les montants sont des entiers, dans `currency` ; une année du cursus sans frais publiés vaut `null`. " +
      "`intl_*` : tarif des étudiants internationaux, quand l'école le distingue.",
    category: "pricing",
    params: [pathId("du programme"), year("")],
    mockResponse: [PRICING],
  },
  {
    id: "get-school-pricing",
    method: "GET",
    path: "/api/v1/schools/[id]/pricing",
    title: "Tous les tarifs d'une école",
    description:
      "Retourne les frais de scolarité de tous les programmes d'une école, de la plus récente année à la plus ancienne. " +
      "Une ligne par programme et par année ; chaque ligne porte son programme et les campus où il est ouvert.",
    category: "pricing",
    params: [pathId("de l'école"), year("")],
    mockResponse: [
      {
        ...PRICING,
        program: { id: PROGRAM.id, name: PROGRAM.name, campuses: [PROGRAM_CAMPUS] },
      },
    ],
  },
  {
    id: "get-program-rankings",
    method: "GET",
    path: "/api/v1/programs/[id]/rankings",
    title: "Classements d'un programme",
    description: "Retourne les classements d'un programme, de la plus récente année à la plus ancienne, puis par rang.",
    category: "rankings",
    params: [
      pathId("du programme"),
      year(""),
      {
        name: "ranking_name",
        in: "query",
        type: "string",
        required: false,
        description: "Recherche dans le nom du classement, sans tenir compte de la casse (ex : figaro).",
        example: "figaro",
      },
    ],
    mockResponse: [RANKING],
  },
  {
    id: "get-rankings-global",
    method: "GET",
    path: "/api/v1/rankings",
    title: "Tous les classements",
    description:
      "Retourne les classements de tous les programmes des écoles actives, paginés : par année décroissante, puis par " +
      "nom de classement et par rang. Chaque ligne porte son programme, l'école et les campus du programme.",
    category: "rankings",
    params: [
      {
        name: "ranking_name",
        in: "query",
        type: "string",
        required: false,
        description: "Recherche dans le nom du classement, sans tenir compte de la casse (ex : figaro).",
        example: "figaro",
      },
      year(""),
      page,
      limit(50),
    ],
    mockResponse: {
      data: [
        {
          ...RANKING,
          program: {
            id: PROGRAM.id,
            name: PROGRAM.name,
            school: { id: SCHOOL.id, name: SCHOOL.name },
            campuses: [PROGRAM_CAMPUS],
          },
        },
      ],
      pagination: PAGINATION(50),
    },
  },
  {
    id: "get-program-capacity",
    method: "GET",
    path: "/api/v1/programs/[id]/capacity",
    title: "Places d'un programme",
    description:
      "Retourne les places disponibles d'un programme, campus par campus : la capacité appartient au couple " +
      "(programme, campus). Chaque élément porte son campus et ses relevés, de la plus récente année à la plus ancienne.",
    category: "capacity",
    params: [pathId("du programme"), year("")],
    mockResponse: [{ ...PROGRAM_CAMPUS, capacityRecords: [CAPACITY] }],
  },
  {
    id: "get-compare-programs",
    method: "GET",
    path: "/api/v1/compare/programs",
    title: "Comparaison de programmes",
    description:
      "Compare jusqu'à 5 programmes : chacun avec son école, ses campus et leurs places, ses tarifs, ses classements " +
      "et ses admissions (`entries`, décrites dans le détail d'un programme). " +
      "Les programmes reviennent dans l'ordre de `ids`, et un identifiant répété ne compte qu'une fois. " +
      "Plus de 5 identifiants donnent 400 ; un programme inconnu ou d'une école inactive, 404.",
    category: "compare",
    params: [
      {
        name: "ids",
        in: "query",
        type: "string",
        required: true,
        description: "Identifiants des programmes, séparés par des virgules (5 au plus).",
        example: `${EXAMPLE_IDS.program},${EXAMPLE_IDS.otherProgram}`,
      },
    ],
    mockResponse: [
      {
        ...PROGRAM_DATA,
        school: SCHOOL,
        campuses: [{ ...PROGRAM_CAMPUS, capacityRecords: [CAPACITY] }],
        pricingRecords: [{ id: PRICING_ID, ...PRICING_FIELDS }],
        rankingRecords: [{ id: RANKING_ID, ...RANKING_FIELDS }],
        entries: ENTRIES,
      },
      {
        ...OTHER_PROGRAM_DATA,
        school: SCHOOL,
        campuses: [{ id: OTHER_PROGRAM_CAMPUS_ID, campus: CAMPUS, capacityRecords: [] }],
        pricingRecords: [],
        rankingRecords: [],
        entries: [],
      },
    ],
  },
];

/**
 * L'URL de l'exemple d'appel : l'adresse du site, l'identifiant d'exemple qui
 * correspond au segment (`/schools/…`, `/campuses/…`, `/programs/…`), et
 * chaque paramètre de requête de la fiche avec sa valeur d'exemple.
 */
export function buildSampleUrl(endpoint: Endpoint, origin: string): string {
  if (!endpoint.path) return origin;

  const idBySegment: Record<string, string> = {
    schools: EXAMPLE_IDS.school,
    campuses: EXAMPLE_IDS.campus,
    programs: EXAMPLE_IDS.program,
  };
  const path = endpoint.path.replace(/\/(\w+)\/\[id\]/, (_match, segment: string) => `/${segment}/${idBySegment[segment]}`);

  const query = endpoint.params
    .filter((param) => param.in === "query")
    // La virgule est permise dans une requête : `ids=a,b` reste lisible.
    .map((param) => `${param.name}=${encodeURIComponent(param.example ?? "").replace(/%2C/g, ",")}`)
    .join("&");

  return `${origin}${path}${query ? `?${query}` : ""}`;
}
