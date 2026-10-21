/**
 * app/page.tsx — Page d'accueil publique (Étape 8.1)
 *
 * - Liste des écoles ACTIVE avec recherche en temps réel
 * - ISR 1h (export revalidate)
 * - Données depuis /api/schools côté client (recherche dynamique)
 * - Un échec de l'API s'affiche avec « Réessayer » : il ne passe plus pour
 *   « aucune école » (défaut F6, lib/public-schools.ts)
 * - Plan gestion-contenu, étape 9 (lot 1) : dans la charte (gabarit
 *   `SiteShell`, sans le lien « Back-office », la page ne lisant pas la
 *   session, D57) ; émojis retirés (D56) ; libellé visible de la recherche
 *   (D58). Textes, identifiants et comportement inchangés.
 * - D75 (contrôle du 21 octobre) : les programmes de chaque école, comme sa
 *   fiche (`programs_count` de /api/schools), au bandeau comme sur les
 *   cartes, et non plus la somme par campus.
 * - Référence : task.md §8.1, architecture.md §7.1
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { SiteShell } from "@/components/layout/SiteShell";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import {
  readSchoolsResponse,
  summarizeSchools,
  SCHOOLS_LOAD_ERROR,
  type PublicSchool as School,
} from "@/lib/public-schools";

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || name.slice(0, 2).toUpperCase();
}

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [schools, setSchools] = useState<School[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // Un échec de l'API n'est jamais une liste vide : il s'affiche à la place.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stats, setStats] = useState({ schools: 0, campuses: 0, programs: 0 });

  const fetchSchools = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (search) params.set("search", search);
      const res = await fetch(`/api/schools?${params}`);
      const result = readSchoolsResponse(res.status, await res.json().catch(() => null));
      if (result.ok) {
        setSchools(result.schools);
        setTotal(result.total);
        setLoadError(null);
      } else {
        setSchools([]);
        setTotal(0);
        setLoadError(result.error);
      }
    } catch {
      // Réseau coupé : même message qu'une réponse en erreur.
      setSchools([]);
      setTotal(0);
      setLoadError(SCHOOLS_LOAD_ERROR);
    } finally {
      setLoading(false);
    }
  }, []);

  // Chargement initial + stats globales
  useEffect(() => {
    fetchSchools("");
    fetch("/api/schools?limit=200")
      .then(async (r) => readSchoolsResponse(r.status, await r.json().catch(() => null)))
      .then((result) => {
        // Sans chiffres sûrs, le bandeau reste masqué plutôt que d'afficher des
        // zéros ; l'échec de la liste, lui, s'affiche dans la page.
        if (result.ok) setStats(summarizeSchools(result.schools, result.total));
        else console.error(`[accueil] statistiques indisponibles : ${result.error}`);
      })
      .catch((error: unknown) => {
        console.error("[accueil] statistiques indisponibles :", error);
      });
  }, [fetchSchools]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => fetchSchools(query), 280);
    return () => clearTimeout(t);
  }, [query, fetchSchools]);

  return (
    <SiteShell current="schools" showBackOffice={false}>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="text-xs font-semibold tracking-wider text-accent-strong uppercase">Données vérifiées par des humains</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-balance text-ink">
            Toutes les données de l&apos;enseignement supérieur
          </h1>
          <p className="max-w-[70ch] text-sm leading-relaxed text-ink-2">
            Grilles tarifaires, classements, capacités d&apos;accueil et accréditations de toutes les grandes écoles françaises, centralisées et vérifiées.
          </p>
        </header>

        {/* Recherche : un libellé visible, tiré du texte indicatif (D58). */}
        <Field
          id="school-search-input"
          label="Rechercher une école"
          className="max-w-xl"
          hint={
            loading
              ? "Chargement…"
              : loadError
                ? "Liste indisponible pour le moment"
                : `${total} école${total > 1 ? "s" : ""} disponible${total > 1 ? "s" : ""}`
          }
        >
          {(control) => (
            <Input
              {...control}
              type="text"
              placeholder="Rechercher une école (ex: EMLV, HEC, Dauphine…)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          )}
        </Field>

        {/* Chiffres d'ensemble */}
        {!query && stats.schools > 0 && (
          <dl className="grid max-w-xl grid-cols-3 gap-3">
            {[
              { label: "Écoles", value: stats.schools },
              { label: "Campus", value: stats.campuses },
              { label: "Programmes", value: stats.programs },
            ].map((item) => (
              <div key={item.label} className="flex flex-col-reverse gap-1 rounded-card border border-line bg-surface p-4">
                <dt className="text-sm text-ink-2">{item.label}</dt>
                <dd className="font-mono text-2xl font-medium text-ink tabular-nums">{formatNumber(item.value)}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* Liste des écoles */}
        <section id="schools-list" aria-labelledby="schools-list-title" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="schools-list-title" className="font-display text-lg font-semibold text-ink">
              {query ? `Résultats pour « ${query} »` : "Toutes les écoles"}
            </h2>
            {!loading && !loadError && (
              <span className="text-sm text-ink-2" id="results-count">
                {schools.length} résultat{schools.length > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {loading ? (
            // Des cartes vides, immobiles (charte §8 : pas d'autre mouvement que la couleur).
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
                  <div className="size-12 rounded-card bg-surface-2" />
                  <div className="h-4 w-3/4 rounded-control bg-surface-2" />
                  <div className="h-3.5 w-2/5 rounded-control bg-surface-2" />
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div
              className="flex flex-col items-start gap-3 rounded-card border border-danger/30 bg-danger-soft p-5"
              id="schools-load-error"
              role="alert"
            >
              <p className="font-display text-lg font-semibold text-ink">Chargement impossible</p>
              <p className="text-sm leading-relaxed text-ink">{loadError}</p>
              <Button variant="primary" onClick={() => fetchSchools(query)}>
                Réessayer
              </Button>
            </div>
          ) : schools.length === 0 ? (
            <div className="flex flex-col items-center gap-1 rounded-card border border-line bg-surface p-8 text-center">
              <p className="font-display text-lg font-semibold text-ink">Aucune école trouvée</p>
              <p className="text-sm text-ink-2">Essayez un autre terme de recherche.</p>
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {schools.map((school) => {
                const campusCount = school.campuses.length;
                const programCount = school.programs_count;
                return (
                  <li key={school.id}>
                    <Link
                      href={`/schools/${school.id}`}
                      className="group flex h-full flex-col gap-3 rounded-card border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      id={`school-card-${school.id}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div
                          aria-hidden="true"
                          className="grid size-12 place-items-center rounded-card bg-accent font-display text-lg font-semibold text-accent-ink"
                        >
                          {getInitials(school.name)}
                        </div>
                        <Badge tone="success">Actif</Badge>
                      </div>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="font-display text-lg leading-snug font-semibold text-ink group-hover:text-accent-strong">
                          {school.name}
                        </span>
                        <span className="truncate font-mono text-xs text-ink-2">{school.official_domain}</span>
                      </div>
                      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-compact text-ink-2">
                        <span>{campusCount} campus</span>
                        <span>
                          {programCount} programme{programCount > 1 ? "s" : ""}
                        </span>
                        <span aria-hidden="true" className="ml-auto text-ink-3 group-hover:text-accent-strong">
                          →
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </SiteShell>
  );
}
