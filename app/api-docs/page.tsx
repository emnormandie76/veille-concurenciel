/**
 * app/api-docs/page.tsx — Page de documentation de l'API v1 (Étape 10)
 *
 * - Affiche la documentation interactive des 15 endpoints de l'API v1, réservée
 *   aux personnes connectées comme tout le site (plan gestion-contenu, étape 1).
 * - Mise en page en 3 colonnes de style Stripe (navigation, détails, exemples de code).
 * - Entièrement statique et sans requêtes à la base de données Neon.
 * - Contenu dans endpoints.ts, aligné sur les réponses réelles le 15 octobre
 *   2026 et tenu par test/api-docs.test.ts.
 * - Langue : Français.
 * - Référence : task.md §10, implementation_plan.md
 */

"use client";

import { useState, useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import SignOutButton from "../SignOutButton";
import { buildSampleUrl, endpoints, Endpoint } from "./endpoints";

// L'adresse du site ne change pas pendant la vie de la page.
const subscribeToNothing = () => () => {};
const readOrigin = () => window.location.origin;

const categoryOrder = [
  "introduction",
  "schools",
  "campuses",
  "programs",
  "pricing",
  "rankings",
  "capacity",
  "compare"
] as const;

const categoryLabels: Record<typeof categoryOrder[number], string> = {
  introduction: "Introduction",
  schools: "Écoles",
  campuses: "Campus",
  programs: "Programmes",
  pricing: "Tarifs",
  rankings: "Classements",
  capacity: "Capacités",
  compare: "Comparateurs"
};

const categoryIcons: Record<typeof categoryOrder[number], string> = {
  introduction: "⚡",
  schools: "🏛️",
  campuses: "🏢",
  programs: "🎓",
  pricing: "💰",
  rankings: "🏆",
  capacity: "👥",
  compare: "⚖️"
};

type Language = "curl" | "javascript" | "python";

export default function ApiDocsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEndpointId, setSelectedEndpointId] = useState<string>("intro-auth");
  const [activeLang, setActiveLang] = useState<Language>("curl");
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedResponse, setCopiedResponse] = useState(false);

  // Filtrage des endpoints par recherche (titre, chemin, description)
  const filteredEndpoints = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return endpoints;
    return endpoints.filter(
      (ep) =>
        ep.title.toLowerCase().includes(query) ||
        ep.path.toLowerCase().includes(query) ||
        ep.description.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  // Si l'endpoint sélectionné n'est pas dans le filtre, on sélectionne le premier disponible
  const selectedEndpoint = useMemo(() => {
    const found = filteredEndpoints.find((ep) => ep.id === selectedEndpointId);
    if (found) return found;
    return filteredEndpoints[0] || null;
  }, [filteredEndpoints, selectedEndpointId]);

  // L'adresse du site qui sert la page : en ligne, le domaine public ; en
  // local, localhost. Vide pendant le rendu serveur (page statique), puis lue
  // dans le navigateur, sans écart d'hydratation.
  const origin = useSyncExternalStore(subscribeToNothing, readOrigin, () => "");

  // L'URL de l'exemple d'appel (endpoints.ts, testée par test/api-docs.test.ts)
  const sampleUrl = useMemo(
    () => (selectedEndpoint ? buildSampleUrl(selectedEndpoint, origin) : ""),
    [selectedEndpoint, origin]
  );

  // Génération des snippets de code client
  const codeSnippets = useMemo(() => {
    if (!selectedEndpoint) return { curl: "", javascript: "", python: "" };

    const curl = `curl -X GET "${sampleUrl}" \\\n  -H "Accept: application/json"`;

    const javascript = `fetch("${sampleUrl}")\n  .then(response => {\n    if (!response.ok) {\n      throw new Error(\`Erreur HTTP ! Statut: \${response.status}\`);\n    }\n    return response.json();\n  })\n  .then(data => {\n    console.log(data);\n  })\n  .catch(error => {\n    console.error("Erreur lors de la récupération :", error);\n  });`;

    const python = `import urllib.request\nimport json\n\nurl = "${sampleUrl}"\n\ntry:\n    with urllib.request.urlopen(url) as response:\n        if response.status == 200:\n            data = json.loads(response.read().decode())\n            print(json.dumps(data, indent=2, ensure_ascii=False))\n        else:\n            print(f"Erreur HTTP: {response.status}")\nexcept Exception as e:\n    print(f"Erreur de connexion: {e}")`;

    return { curl, javascript, python };
  }, [selectedEndpoint, sampleUrl]);

  // Copie de code
  const handleCopyCode = () => {
    if (!selectedEndpoint) return;
    const textToCopy = codeSnippets[activeLang];
    navigator.clipboard.writeText(textToCopy);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Copie de réponse JSON
  const handleCopyResponse = () => {
    if (!selectedEndpoint) return;
    const textToCopy = JSON.stringify(selectedEndpoint.mockResponse, null, 2);
    navigator.clipboard.writeText(textToCopy);
    setCopiedResponse(true);
    setTimeout(() => setCopiedResponse(false), 2000);
  };

  // Groupement des endpoints filtrés par catégorie
  const groupedEndpoints = useMemo(() => {
    const groups: Record<string, Endpoint[]> = {};
    categoryOrder.forEach((cat) => {
      groups[cat] = [];
    });

    filteredEndpoints.forEach((ep) => {
      if (groups[ep.category]) {
        groups[ep.category].push(ep);
      }
    });

    return groups;
  }, [filteredEndpoints]);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {/* Navbar publique */}
      <nav className="public-nav" id="main-nav">
        <Link href="/" className="public-nav-logo">
          <span className="public-nav-logo-icon">🎓</span>
          EduData France
        </Link>
        <div className="public-nav-links">
          <Link href="/" className="public-nav-link">
            Écoles
          </Link>
          <Link href="/api-docs" className="public-nav-link active">
            API
          </Link>
          <SignOutButton className="public-nav-cta" />
        </div>
      </nav>

      {/* Grid de documentation en 3 colonnes */}
      <div className="docs-layout">
        {/* Colonne 1: Navigation Sidebar */}
        <aside className="docs-sidebar">
          <div className="docs-search-wrapper">
            <input
              type="text"
              placeholder="Rechercher un endpoint..."
              className="docs-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <nav>
            {categoryOrder.map((category) => {
              const endpointsInCat = groupedEndpoints[category] || [];
              if (endpointsInCat.length === 0) return null;

              return (
                <div key={category} className="docs-nav-group">
                  <div className="docs-nav-group-title">
                    {categoryIcons[category]} {categoryLabels[category]}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    {endpointsInCat.map((ep) => {
                      const isActive = selectedEndpoint?.id === ep.id;
                      return (
                        <button
                          key={ep.id}
                          className={`docs-nav-link ${isActive ? "active" : ""}`}
                          onClick={() => setSelectedEndpointId(ep.id)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            background: "none",
                            border: "none"
                          }}
                        >
                          {ep.path ? (
                            <span className="docs-method">{ep.method}</span>
                          ) : (
                            <span className="docs-method" style={{ color: "#3b82f6", background: "rgba(59, 130, 246, 0.1)" }}>INFO</span>
                          )}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {ep.title}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {filteredEndpoints.length === 0 && (
              <div style={{ padding: "20px 0", textAlign: "center", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                Aucun endpoint trouvé
              </div>
            )}
          </nav>
        </aside>

        {/* Colonne 2: Contenu principal */}
        <main className="docs-content">
          {selectedEndpoint ? (
            <div>
              <h1 style={{ fontSize: "2rem", marginBottom: "8px", fontWeight: "700" }}>
                {selectedEndpoint.title}
              </h1>

              {selectedEndpoint.path ? (
                <div className="docs-endpoint-url">
                  <span className="docs-url-method">{selectedEndpoint.method}</span>
                  <span className="docs-url-path">{selectedEndpoint.path}</span>
                </div>
              ) : (
                <div style={{ margin: "16px 0 24px" }} />
              )}

              <p className="docs-description">{selectedEndpoint.description}</p>

              {/* Paramètres de requête */}
              <h3 style={{ fontSize: "1.1rem", borderBottom: "1px solid var(--border-color)", paddingBottom: "8px", marginBottom: "12px" }}>
                Paramètres de requête
              </h3>

              {selectedEndpoint.params.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <table className="docs-params-table">
                    <thead>
                      <tr>
                        <th>Nom</th>
                        <th>Type</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedEndpoint.params.map((param) => (
                        <tr key={param.name}>
                          <td style={{ fontWeight: "600", whiteSpace: "nowrap" }}>
                            <span className="docs-param-name">{param.name}</span>
                            {param.required && (
                              <span className="docs-param-required" title="Ce paramètre est obligatoire">*</span>
                            )}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <span className="docs-param-type">{param.type}</span>
                          </td>
                          <td style={{ color: "var(--text-secondary)", lineHeight: "1.4" }}>
                            {param.description}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ color: "var(--text-secondary)", fontSize: "0.88rem", fontStyle: "italic", margin: "12px 0 30px" }}>
                  Cet endpoint ne requiert aucun paramètre.
                </p>
              )}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "80px 0" }}>
              <h2 style={{ fontSize: "1.5rem", color: "var(--text-secondary)" }}>Sélectionnez un endpoint pour voir les détails</h2>
            </div>
          )}
        </main>

        {/* Colonne 3: Panneau d'exemples de code (Noir) */}
        <section className="docs-code-panel">
          {selectedEndpoint ? (
            <>
              {/* Onglet de snippets de code client */}
              <div className="docs-block-container">
                <div className="docs-block-tabs">
                  <button
                    className={`docs-block-tab ${activeLang === "curl" ? "active" : ""}`}
                    onClick={() => setActiveLang("curl")}
                  >
                    cURL
                  </button>
                  <button
                    className={`docs-block-tab ${activeLang === "javascript" ? "active" : ""}`}
                    onClick={() => setActiveLang("javascript")}
                  >
                    JavaScript
                  </button>
                  <button
                    className={`docs-block-tab ${activeLang === "python" ? "active" : ""}`}
                    onClick={() => setActiveLang("python")}
                  >
                    Python
                  </button>
                </div>
                <div className="docs-code-body" style={{ minHeight: "150px" }}>
                  <button className="docs-copy-btn" onClick={handleCopyCode}>
                    {copiedCode ? "Copié !" : "Copier"}
                  </button>
                  <pre style={{ overflowX: "auto", margin: 0 }}>
                    <code>{codeSnippets[activeLang]}</code>
                  </pre>
                </div>
              </div>

              {/* Exemple de réponse JSON */}
              <div className="docs-block-container">
                <div className="docs-block-tabs" style={{ padding: "12px 20px", fontSize: "0.8rem", color: "var(--text-secondary)", fontWeight: "600" }}>
                  EXEMPLE DE RÉPONSE (JSON)
                </div>
                <div className="docs-code-body" style={{ maxHeight: "400px", overflowY: "auto" }}>
                  <button className="docs-copy-btn" onClick={handleCopyResponse}>
                    {copiedResponse ? "Copié !" : "Copier"}
                  </button>
                  <pre style={{ overflowX: "auto", margin: 0 }}>
                    <code>{JSON.stringify(selectedEndpoint.mockResponse, null, 2)}</code>
                  </pre>
                </div>
              </div>
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-secondary)" }}>
              Exemples non disponibles
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
