# Design Spec: Public REST API (v1)

## Objective
Provide a fully open, public-facing REST API for partners to consume validated school data (schools, campuses, programs, pricing, capacity, rankings, stats, accreditations). The API must be highly performant and robust against high traffic to protect the underlying Neon PostgreSQL database.

## Architecture & Technology Stack
- **Framework**: Next.js App Router (Route Handlers `app/api/v1/...`)
- **Language**: TypeScript
- **Database Access**: Prisma ORM
- **Hosting**: Vercel
- **Caching**: Vercel Edge Cache (ISR / Route Segment Config)

## Endpoints (15 routes)

All endpoints reside under `/api/v1/`. Versioning ensures backward compatibility.

### 1. Schools (Écoles)

| Method | Endpoint | Description | Query Params |
|---|---|---|---|
| `GET` | `/api/v1/schools` | Liste paginée des écoles actives | `?search=emlv&page=1&limit=20` |
| `GET` | `/api/v1/schools/[id]` | Détail d'une école (infos de base) | — |
| `GET` | `/api/v1/schools/[id]/stats` | Stats de l'école (étudiants, alumni, partenaires…) | `?year=2025` (optionnel, dernier par défaut) |
| `GET` | `/api/v1/schools/[id]/accreditations` | Accréditations de l'école (EQUIS, AACSB…) | — |

### 2. Campuses

| Method | Endpoint | Description | Query Params |
|---|---|---|---|
| `GET` | `/api/v1/schools/[id]/campuses` | Liste des campus d'une école | — |
| `GET` | `/api/v1/campuses/[id]` | Détail d'un campus spécifique + ses programmes | — |

### 3. Programs (Programmes)

| Method | Endpoint | Description | Query Params |
|---|---|---|---|
| `GET` | `/api/v1/schools/[id]/programs` | Tous les programmes de l'école (tous campus) | `?campus_id=xxx` (filtre optionnel) |
| `GET` | `/api/v1/programs/[id]` | Détail d'un programme spécifique | — |
| `GET` | `/api/v1/programs` | Recherche globale de programmes (toutes écoles) | `?search=pge&admission_exam=sesame&alternance=true` |

### 4. Pricing (Tarifs)

| Method | Endpoint | Description | Query Params |
|---|---|---|---|
| `GET` | `/api/v1/programs/[id]/pricing` | Historique tarifaire d'un programme | `?year=2025` |
| `GET` | `/api/v1/schools/[id]/pricing` | Tous les tarifs de l'école (tous programmes) | `?year=2025` |

### 5. Rankings (Classements)

| Method | Endpoint | Description | Query Params |
|---|---|---|---|
| `GET` | `/api/v1/programs/[id]/rankings` | Classements d'un programme | `?year=2025&ranking_name=Figaro` |
| `GET` | `/api/v1/rankings` | Tableau global de classements par média/année | `?ranking_name=Figaro&year=2025&page=1&limit=50` |

### 6. Capacity (Places disponibles)

| Method | Endpoint | Description | Query Params |
|---|---|---|---|
| `GET` | `/api/v1/programs/[id]/capacity` | Historique des places d'un programme | `?year=2025` |

### 7. Comparaison

| Method | Endpoint | Description | Query Params |
|---|---|---|---|
| `GET` | `/api/v1/compare/programs` | Comparer N programmes côte à côte (tarifs, classements, capacité) | `?ids=uuid1,uuid2,uuid3` (max 5) |

## Data Flow & Protection (Caching)
Since the API is entirely open (no API keys), protecting the free-tier Neon database is the top priority.
- **Cache Strategy**: Each Route Handler will enforce a time-based cache using the route segment config: `export const revalidate = 3600;` (1 hour).
- **Mechanism**: The first incoming request will hit the Neon database via Prisma. Subsequent requests within the 1-hour window will be served directly from Vercel's global CDN, resulting in near-zero database load regardless of traffic volume.

## Error Handling & CORS
- **CORS**: Endpoints must return appropriate CORS headers (`Access-Control-Allow-Origin: *`) to allow consumption from client-side web applications (browsers) by partners.
- **Standardized Errors**: JSON error format: `{ "error": "Description of the error" }`. 
  - `400 Bad Request` for invalid query parameters (ex: `ids` with more than 5 UUIDs on compare).
  - `404 Not Found` if an ID does not exist or school is not `ACTIVE`.
  - `500 Internal Server Error` for unexpected backend issues.

## Excluded Tables
The following tables are **strictly excluded** from all API responses to maintain security:
- `ContributionInbox` (zone tampon interne)
- `CronTarget` (tracking pipeline IA)
- `User` (authentification admin)

## Validation Criteria
- API successfully returns JSON data matching the Prisma schema.
- Endpoints only return data for schools where `status == "ACTIVE"`.
- Next.js caching is functional (verified via response times on consecutive requests).
- CORS headers are correctly applied.
- Search/filter parameters work correctly on paginated endpoints.
- Compare endpoint returns side-by-side data for up to 5 programs.
