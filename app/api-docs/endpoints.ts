export interface EndpointParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface Endpoint {
  id: string;
  method: "GET";
  path: string;
  title: string;
  description: string;
  category: "schools" | "campuses" | "programs" | "pricing" | "rankings" | "capacity" | "compare" | "introduction";
  params: EndpointParam[];
  mockResponse: Record<string, any> | any[];
}

export const endpoints: Endpoint[] = [
  {
    id: "intro-auth",
    method: "GET",
    path: "",
    title: "Authentification & CORS",
    description: "L'API publique v1 d'EduData France est entièrement ouverte et ne nécessite pas de clé d'authentification. Le partage des ressources cross-origin (CORS) est activé sur tous les endpoints avec le header `Access-Control-Allow-Origin: *`, vous permettant d'appeler l'API directement depuis des applications côté client dans le navigateur.",
    category: "introduction",
    params: [],
    mockResponse: { message: "Bienvenue sur l'API publique d'EduData France." }
  },
  {
    id: "get-schools",
    method: "GET",
    path: "/api/v1/schools",
    title: "Liste des écoles actives",
    description: "Retourne la liste paginée de toutes les écoles avec le statut ACTIVE.",
    category: "schools",
    params: [
      { name: "search", type: "string", required: false, description: "Recherche par nom ou domaine de l'école (ex: emlv)" },
      { name: "page", type: "number", required: false, description: "Numéro de la page de résultats (défaut: 1)" },
      { name: "limit", type: "number", required: false, description: "Nombre de résultats par page (défaut: 20, max: 100)" }
    ],
    mockResponse: {
      data: [
        {
          id: "clt123abc-school-emlv",
          name: "EMLV - École de Management Léonard de Vinci",
          official_domain: "emlv.fr",
          status: "ACTIVE"
        }
      ],
      pagination: {
        total: 1,
        total_pages: 1,
        page: 1,
        limit: 20
      }
    }
  },
  {
    id: "get-school-detail",
    method: "GET",
    path: "/api/v1/schools/[id]",
    title: "Détail d'une école",
    description: "Retourne les informations de base d'une école spécifique à partir de son ID.",
    category: "schools",
    params: [
      { name: "id", type: "string (path)", required: true, description: "ID unique de l'école" }
    ],
    mockResponse: {
      id: "clt123abc-school-emlv",
      name: "EMLV - École de Management Léonard de Vinci",
      official_domain: "emlv.fr",
      status: "ACTIVE"
    }
  },
  {
    id: "get-school-stats",
    method: "GET",
    path: "/api/v1/schools/[id]/stats",
    title: "Statistiques d'une école",
    description: "Retourne les statistiques (nombre d'étudiants, diplômés, universités partenaires) d'une école.",
    category: "schools",
    params: [
      { name: "id", type: "string (path)", required: true, description: "ID unique de l'école" },
      { name: "year", type: "number", required: false, description: "Année des statistiques (ex: 2025, dernière disponible par défaut)" }
    ],
    mockResponse: {
      id: "clt234def-stats",
      school_id: "clt123abc-school-emlv",
      students_count: 3200,
      alumni_count: 12000,
      partners_count: 150,
      year: 2025
    }
  },
  {
    id: "get-school-accreditations",
    method: "GET",
    path: "/api/v1/schools/[id]/accreditations",
    title: "Accréditations d'une école",
    description: "Retourne les accréditations officielles (EQUIS, AACSB, AMBA, CGE, etc.) d'une école.",
    category: "schools",
    params: [
      { name: "id", type: "string (path)", required: true, description: "ID unique de l'école" }
    ],
    mockResponse: [
      {
        id: "clt345ghi-acc1",
        school_id: "clt123abc-school-emlv",
        accreditation_name: "AACSB",
        start_date: "2021-01-01T00:00:00.000Z",
        end_date: "2026-01-01T00:00:00.000Z"
      },
      {
        id: "clt345ghi-acc2",
        school_id: "clt123abc-school-emlv",
        accreditation_name: "EFMD_BACHELOR",
        start_date: "2020-09-01T00:00:00.000Z",
        end_date: "2025-09-01T00:00:00.000Z"
      }
    ]
  },
  {
    id: "get-school-campuses",
    method: "GET",
    path: "/api/v1/schools/[id]/campuses",
    title: "Campus d'une école",
    description: "Retourne la liste des campus associés à une école.",
    category: "campuses",
    params: [
      { name: "id", type: "string (path)", required: true, description: "ID unique de l'école" }
    ],
    mockResponse: [
      {
        id: "clt456jkl-campus-ldf",
        name: "Paris La Défense",
        city: "Courbevoie",
        address: "Pôle Universitaire Léonard de Vinci",
        school_id: "clt123abc-school-emlv"
      }
    ]
  },
  {
    id: "get-campus-detail",
    method: "GET",
    path: "/api/v1/campuses/[id]",
    title: "Détail d'un campus",
    description: "Retourne les détails d'un campus spécifique ainsi que ses programmes associés.",
    category: "campuses",
    params: [
      { name: "id", type: "string (path)", required: true, description: "ID unique du campus" }
    ],
    mockResponse: {
      id: "clt456jkl-campus-ldf",
      name: "Paris La Défense",
      city: "Courbevoie",
      address: "Pôle Universitaire Léonard de Vinci",
      school_id: "clt123abc-school-emlv",
      programs: [
        {
          id: "clt567mno-prog-pge",
          name: "Programme Grande École",
          degree: "Master",
          duration: 5
        }
      ]
    }
  },
  {
    id: "get-school-programs",
    method: "GET",
    path: "/api/v1/schools/[id]/programs",
    title: "Programmes d'une école",
    description: "Retourne tous les programmes offerts par une école.",
    category: "programs",
    params: [
      { name: "id", type: "string (path)", required: true, description: "ID unique de l'école" },
      { name: "campus_id", type: "string", required: false, description: "Filtre par ID de campus spécifique" }
    ],
    mockResponse: [
      {
        id: "clt567mno-prog-pge",
        name: "Programme Grande École",
        degree: "Master",
        duration: 5,
        admission_exam: "SESAME",
        alternance: true,
        school_id: "clt123abc-school-emlv"
      }
    ]
  },
  {
    id: "get-program-detail",
    method: "GET",
    path: "/api/v1/programs/[id]",
    title: "Détail d'un programme",
    description: "Retourne les informations détaillées d'un programme d'études spécifique.",
    category: "programs",
    params: [
      { name: "id", type: "string (path)", required: true, description: "ID unique du programme" }
    ],
    mockResponse: {
      id: "clt567mno-prog-pge",
      name: "Programme Grande École",
      degree: "Master",
      duration: 5,
      admission_exam: "SESAME",
      alternance: true,
      school_id: "clt123abc-school-emlv"
    }
  },
  {
    id: "get-programs-search",
    method: "GET",
    path: "/api/v1/programs",
    title: "Recherche globale de programmes",
    description: "Recherche des programmes d'études sur l'ensemble des écoles selon des critères de filtrage.",
    category: "programs",
    params: [
      { name: "search", type: "string", required: false, description: "Recherche par nom de programme (ex: pge)" },
      { name: "admission_exam", type: "string", required: false, description: "Recherche par concours d'admission (ex: sesame)" },
      { name: "alternance", type: "boolean", required: false, description: "Filtre pour l'alternance (true/false)" }
    ],
    mockResponse: {
      data: [
        {
          id: "clt567mno-prog-pge",
          name: "Programme Grande École",
          degree: "Master",
          duration: 5,
          admission_exam: "SESAME",
          alternance: true,
          school: {
            id: "clt123abc-school-emlv",
            name: "EMLV - École de Management Léonard de Vinci"
          }
        }
      ],
      pagination: {
        total: 1,
        total_pages: 1,
        page: 1,
        limit: 20
      }
    }
  },
  {
    id: "get-program-pricing",
    method: "GET",
    path: "/api/v1/programs/[id]/pricing",
    title: "Tarifs d'un programme",
    description: "Retourne les historiques de frais de scolarité pour un programme.",
    category: "pricing",
    params: [
      { name: "id", type: "string (path)", required: true, description: "ID unique du programme" },
      { name: "year", type: "number", required: false, description: "Filtre pour une année spécifique (ex: 2025)" }
    ],
    mockResponse: [
      {
        id: "clt678pqr-price1",
        program_id: "clt567mno-prog-pge",
        amount: 11200,
        currency: "EUR",
        year: 2025,
        data_conflict_warning: false
      },
      {
        id: "clt678pqr-price2",
        program_id: "clt567mno-prog-pge",
        amount: 10800,
        currency: "EUR",
        year: 2024,
        data_conflict_warning: false
      }
    ]
  },
  {
    id: "get-school-pricing",
    method: "GET",
    path: "/api/v1/schools/[id]/pricing",
    title: "Tous les tarifs d'une école",
    description: "Retourne l'ensemble des grilles tarifaires de tous les programmes d'une école.",
    category: "pricing",
    params: [
      { name: "id", type: "string (path)", required: true, description: "ID unique de l'école" },
      { name: "year", type: "number", required: false, description: "Filtre pour une année spécifique (ex: 2025)" }
    ],
    mockResponse: [
      {
        program_id: "clt567mno-prog-pge",
        program_name: "Programme Grande École",
        pricing: [
          {
            amount: 11200,
            currency: "EUR",
            year: 2025
          }
        ]
      }
    ]
  },
  {
    id: "get-program-rankings",
    method: "GET",
    path: "/api/v1/programs/[id]/rankings",
    title: "Classements d'un programme",
    description: "Retourne tous les classements recensés pour un programme.",
    category: "rankings",
    params: [
      { name: "id", type: "string (path)", required: true, description: "ID unique du programme" },
      { name: "year", type: "number", required: false, description: "Filtre pour une année spécifique (ex: 2025)" },
      { name: "ranking_name", type: "string", required: false, description: "Filtre par journal (ex: Figaro, L'Etudiant)" }
    ],
    mockResponse: [
      {
        id: "clt789stu-rank1",
        program_id: "clt567mno-prog-pge",
        ranking_name: "Figaro",
        category: "Général",
        rank: 12,
        max_rank: 38,
        year: 2025
      }
    ]
  },
  {
    id: "get-rankings-global",
    method: "GET",
    path: "/api/v1/rankings",
    title: "Tableau global de classements",
    description: "Retourne le classement global par publication et par année pour l'ensemble des programmes.",
    category: "rankings",
    params: [
      { name: "ranking_name", type: "string", required: true, description: "Nom de la publication (ex: Figaro)" },
      { name: "year", type: "number", required: true, description: "Année du classement (ex: 2025)" },
      { name: "page", type: "number", required: false, description: "Numéro de page (défaut: 1)" },
      { name: "limit", type: "number", required: false, description: "Résultats par page (défaut: 50)" }
    ],
    mockResponse: {
      ranking_name: "Figaro",
      year: 2025,
      data: [
        {
          rank: 12,
          program_name: "Programme Grande École",
          school_name: "EMLV - École de Management Léonard de Vinci",
          program_id: "clt567mno-prog-pge"
        }
      ],
      pagination: {
        total: 1,
        total_pages: 1,
        page: 1,
        limit: 50
      }
    }
  },
  {
    id: "get-program-capacity",
    method: "GET",
    path: "/api/v1/programs/[id]/capacity",
    title: "Places d'un programme (Capacity)",
    description: "Retourne le nombre historique de places disponibles à l'admission pour un programme.",
    category: "capacity",
    params: [
      { name: "id", type: "string (path)", required: true, description: "ID unique du programme" },
      { name: "year", type: "number", required: false, description: "Filtre pour une année spécifique (ex: 2025)" }
    ],
    mockResponse: [
      {
        id: "clt890vwx-cap1",
        program_id: "clt567mno-prog-pge",
        places: 450,
        year: 2025
      }
    ]
  },
  {
    id: "get-compare-programs",
    method: "GET",
    path: "/api/v1/compare/programs",
    title: "Comparaison de programmes",
    description: "Compare côte à côte plusieurs programmes (tarifs, classements, capacités) jusqu'à 5 IDs.",
    category: "compare",
    params: [
      { name: "ids", type: "string", required: true, description: "IDs des programmes séparés par des virgules (ex: id1,id2,id3)" }
    ],
    mockResponse: [
      {
        program_id: "clt567mno-prog-pge",
        name: "Programme Grande École",
        school_name: "EMLV",
        pricing_2025: 11200,
        capacity_2025: 450,
        rankings_2025: [
          {
            ranking_name: "Figaro",
            rank: 12
          }
        ]
      }
    ]
  }
];
