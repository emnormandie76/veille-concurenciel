/**
 * app/api-docs/page.tsx — Page de documentation de l'API v1 (Étape 10)
 *
 * - Affiche la documentation interactive des 15 endpoints de l'API v1, réservée
 *   aux personnes connectées comme tout le site (plan gestion-contenu, étape 1).
 * - Mise en page en 3 colonnes de style Stripe (navigation, détails, exemples de code).
 * - Étape 9 (lot 1) : dans la charte (gabarit `SiteShell` sans « Back-office »,
 *   D57) ; exemples de code en clair, onglets de la charte (D59) ; libellé
 *   visible de la recherche (D58) ; émojis des catégories retirés (D56).
 * - Entièrement statique et sans requêtes à la base de données Neon.
 * - Contenu dans endpoints.ts, aligné sur les réponses réelles le 15 octobre
 *   2026 et tenu par test/api-docs.test.ts.
 * - Langue : Français.
 * - Référence : task.md §10, implementation_plan.md
 */

"use client";

import { useState, useMemo, useSyncExternalStore } from "react";
import { SiteShell } from "@/components/layout/SiteShell";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Field, Input } from "@/components/ui/Field";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/Table";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
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

type Language = "curl" | "javascript" | "python";

/** Les onglets des exemples d'appel (D59). */
const LANGUAGES: Array<{ value: Language; label: string }> = [
  { value: "curl", label: "cURL" },
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
];

/** Une entrée de la navigation ; la route affichée porte `aria-current`. */
const NAV_BUTTON =
  "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-compact text-ink-2 " +
  "hover:bg-surface-2 hover:text-ink aria-[current=true]:bg-accent-soft aria-[current=true]:font-medium aria-[current=true]:text-accent-strong " +
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus";

/** L'étiquette de la méthode HTTP. */
const METHOD = "shrink-0 rounded-control px-1.5 font-mono text-[11px] leading-5 font-medium";

/** Un bloc de code : Plex Mono, sur fond `surface-2` (D59). */
const CODE = "overflow-x-auto rounded-control bg-surface-2 p-4 font-mono text-xs leading-relaxed text-ink";

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
    <SiteShell current="api" showBackOffice={false}>
      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_minmax(0,26rem)]">
        {/* Colonne 1 : navigation */}
        <aside className="flex flex-col gap-5 lg:row-span-2 xl:row-span-1">
          {/* Un libellé visible, tiré du texte indicatif (D58). */}
          <Field id="docs-search" label="Rechercher un endpoint">
            {(control) => (
              <Input
                {...control}
                type="text"
                placeholder="Rechercher un endpoint..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            )}
          </Field>

          <nav aria-label="Endpoints de l'API" className="flex flex-col gap-4">
            {categoryOrder.map((category) => {
              const endpointsInCat = groupedEndpoints[category] || [];
              if (endpointsInCat.length === 0) return null;

              return (
                <div key={category} className="flex flex-col gap-1">
                  <div className="px-2 text-xs font-semibold tracking-wider text-ink-2 uppercase">{categoryLabels[category]}</div>
                  <ul className="flex flex-col gap-0.5">
                    {endpointsInCat.map((ep) => {
                      const isActive = selectedEndpoint?.id === ep.id;
                      return (
                        <li key={ep.id}>
                          <button
                            type="button"
                            aria-current={isActive ? "true" : undefined}
                            className={NAV_BUTTON}
                            onClick={() => setSelectedEndpointId(ep.id)}
                          >
                            {ep.path ? (
                              <span className={cx(METHOD, "bg-surface-2 text-ink-2")}>{ep.method}</span>
                            ) : (
                              <span className={cx(METHOD, "bg-accent-soft text-accent-strong")}>INFO</span>
                            )}
                            <span className="truncate">{ep.title}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}

            {filteredEndpoints.length === 0 && <p className="px-2 py-4 text-center text-sm text-ink-2">Aucun endpoint trouvé</p>}
          </nav>
        </aside>

        {/* Colonne 2 : contenu principal */}
        <div className="flex min-w-0 flex-col gap-4">
          {selectedEndpoint ? (
            <>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-balance text-ink">{selectedEndpoint.title}</h1>

              {selectedEndpoint.path && (
                <div className="flex items-center gap-3 overflow-x-auto rounded-control border border-line bg-surface px-3 py-2 font-mono text-compact">
                  <span className="font-semibold text-accent-strong">{selectedEndpoint.method}</span>
                  <span className="whitespace-nowrap text-ink">{selectedEndpoint.path}</span>
                </div>
              )}

              <p className="max-w-[70ch] text-sm leading-relaxed text-ink-2">{selectedEndpoint.description}</p>

              {/* Paramètres de requête */}
              <h2 className="mt-2 border-b border-line pb-2 font-display text-lg font-semibold text-ink">Paramètres de requête</h2>

              {selectedEndpoint.params.length > 0 ? (
                <Table>
                  <THead>
                    <Tr>
                      <Th>Nom</Th>
                      <Th>Type</Th>
                      <Th>Description</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {selectedEndpoint.params.map((param) => (
                      <Tr key={param.name}>
                        <Td className="whitespace-nowrap">
                          <span className="font-mono font-semibold text-ink">{param.name}</span>
                          {param.required && (
                            <span className="ml-0.5 font-semibold text-danger" title="Ce paramètre est obligatoire">
                              *
                            </span>
                          )}
                        </Td>
                        <Td className="whitespace-nowrap">
                          <span className="rounded-control bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink-2">{param.type}</span>
                        </Td>
                        <Td className="leading-relaxed text-ink-2">{param.description}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <p className="text-sm text-ink-2 italic">Cet endpoint ne requiert aucun paramètre.</p>
              )}
            </>
          ) : (
            <div className="py-20 text-center">
              <h2 className="font-display text-lg font-semibold text-ink-2">Sélectionnez un endpoint pour voir les détails</h2>
            </div>
          )}
        </div>

        {/* Colonne 3 : exemples de code, en clair (D59) */}
        <section aria-label="Exemples" className="flex min-w-0 flex-col gap-4 lg:col-start-2 xl:col-start-3">
          {selectedEndpoint ? (
            <>
              {/* Onglets de snippets de code client */}
              <div className="flex flex-col rounded-card border border-line bg-surface p-4">
                <div className="flex items-end justify-between gap-3">
                  <Tabs
                    label="Exemples d'appel"
                    idPrefix="docs-code"
                    value={activeLang}
                    onValueChange={(value) => setActiveLang(value as Language)}
                    items={LANGUAGES}
                    className="min-w-0 flex-1"
                  />
                  <Button size="sm" className="mb-1.5" onClick={handleCopyCode}>
                    {copiedCode ? "Copié !" : "Copier"}
                  </Button>
                </div>
                {LANGUAGES.map((lang) => (
                  <TabPanel key={lang.value} idPrefix="docs-code" value={lang.value} selected={activeLang === lang.value}>
                    <pre className={cx(CODE, "min-h-36")}>
                      <code>{codeSnippets[lang.value]}</code>
                    </pre>
                  </TabPanel>
                ))}
              </div>

              {/* Exemple de réponse JSON */}
              <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xs font-semibold tracking-wider text-ink-2">EXEMPLE DE RÉPONSE (JSON)</h2>
                  <Button size="sm" onClick={handleCopyResponse}>
                    {copiedResponse ? "Copié !" : "Copier"}
                  </Button>
                </div>
                <pre className={cx(CODE, "max-h-100 overflow-y-auto")}>
                  <code>{JSON.stringify(selectedEndpoint.mockResponse, null, 2)}</code>
                </pre>
              </div>
            </>
          ) : (
            <p className="py-10 text-center text-sm text-ink-2">Exemples non disponibles</p>
          )}
        </section>
      </div>
    </SiteShell>
  );
}
