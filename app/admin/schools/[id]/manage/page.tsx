"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminPage } from "@/components/layout/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { schoolStatusTone } from "../../school-status";

import SchoolInfoTab from "./tabs/SchoolInfoTab";
import AccreditationsTab from "./tabs/AccreditationsTab";
import StatsTab from "./tabs/StatsTab";
import CampusProgramsTab from "./tabs/CampusProgramsTab";
import PricingTab from "./tabs/PricingTab";
import RankingsTab from "./tabs/RankingsTab";
import CapacitiesTab from "./tabs/CapacitiesTab";
import AdmissionsTab from "./tabs/AdmissionsTab";
import TabFrame from "./legacy/TabFrame";

/**
 * La gestion du contenu d'une école : un en-tête, puis huit onglets.
 *
 * Dans la charte depuis l'étape 9 (lot 2) : gabarit `AdminPage`, onglets
 * `Tabs` au modèle ARIA, une ligne qui défile en largeur sur un écran étroit
 * (D62). Seul l'onglet choisi est monté, comme avant : chacun relit ses
 * données en s'ouvrant.
 *
 * D60 : jusqu'au lot 3, les quatre onglets marqués `legacy` restent à
 * l'ancien style. Leur panneau se pose après le gabarit, hors du sous-arbre
 * `.charte`, dans l'îlot sombre de `legacy/TabFrame.tsx`.
 */

interface SchoolManageData {
  id: string;
  name: string;
  official_domain: string;
  status: string;
  // « Modifié par … le … » (étape 5, D29).
  last_edit: string | null;
  _counts: {
    campuses: number;
    programs: number;
    accreditations: number;
    statsRecords: number;
    pricingRecords: number;
    rankingRecords: number;
    capacityRecords: number;
    // Les admissions des programmes (étape 8, D50).
    programEntries: number;
    statsYears: number[];
  };
}

// `legacy` : l'onglet est encore à l'ancien style, jusqu'au lot 3 (D60).
const TABS = [
  { key: "info", label: "Infos", legacy: false },
  { key: "accreditations", label: "Accréditations", legacy: false },
  { key: "stats", label: "Statistiques", legacy: false },
  { key: "campus-programs", label: "Campus & Programmes", legacy: true },
  { key: "pricing", label: "Tarifs", legacy: true },
  { key: "rankings", label: "Classements", legacy: true },
  { key: "capacities", label: "Capacités", legacy: true },
  // Étape 8 (D50) : l'année d'entrée et le niveau requis de chaque programme.
  { key: "admissions", label: "Admissions", legacy: false },
] as const;

type TabKey = typeof TABS[number]["key"];

const ID_PREFIX = "manage";

/**
 * L'onglet demandé par `?tab=` (plan gestion-contenu, étape 6 : la vue des
 * signalements ouvre l'onglet de la catégorie, lib/content-reports.ts), s'il
 * existe ; sinon « Infos ».
 */
function tabFrom(requested: string | null): TabKey {
  return TABS.find((tab) => tab.key === requested)?.key ?? "info";
}

export default function ManagePage() {
  const { id: schoolId } = useParams() as { id: string };
  const searchParams = useSearchParams();
  const [school, setSchool] = useState<SchoolManageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>(() => tabFrom(searchParams.get("tab")));

  useEffect(() => {
    if (schoolId) {
      fetchSchool();
    }
  }, [schoolId]);

  const fetchSchool = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/schools/${schoolId}/manage`);
      if (!res.ok) throw new Error("Impossible de charger les données de l'école");
      const data = await res.json();
      setSchool(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getTabCount = (key: TabKey): number | null => {
    if (!school) return null;
    switch (key) {
      case "accreditations":
        return school._counts.accreditations;
      case "stats":
        return school._counts.statsRecords;
      case "campus-programs":
        return school._counts.programs;
      case "pricing":
        return school._counts.pricingRecords;
      case "rankings":
        return school._counts.rankingRecords;
      case "capacities":
        return school._counts.capacityRecords;
      case "admissions":
        return school._counts.programEntries;
      default:
        return null;
    }
  };

  const renderTab = (key: TabKey) => {
    if (!school) return null;
    switch (key) {
      case "info":
        return (
          <SchoolInfoTab
            schoolId={schoolId}
            school={school}
            onSchoolUpdate={fetchSchool}
          />
        );
      case "accreditations":
        return <AccreditationsTab schoolId={schoolId} />;
      case "stats":
        return <StatsTab schoolId={schoolId} />;
      case "campus-programs":
        return <CampusProgramsTab schoolId={schoolId} />;
      case "pricing":
        return <PricingTab schoolId={schoolId} />;
      case "rankings":
        return <RankingsTab schoolId={schoolId} />;
      case "capacities":
        return <CapacitiesTab schoolId={schoolId} />;
      case "admissions":
        return <AdmissionsTab schoolId={schoolId} />;
    }
  };

  // Un panneau par onglet, pour que chaque onglet commande le sien ; seul le
  // panneau choisi contient son onglet, dans l'îlot sombre s'il est encore à
  // l'ancien style (D60).
  const panel = ({ key, legacy }: (typeof TABS)[number]) => (
    <TabPanel key={key} idPrefix={ID_PREFIX} value={key} selected={activeTab === key}>
      {activeTab === key && (legacy ? <TabFrame>{renderTab(key)}</TabFrame> : renderTab(key))}
    </TabPanel>
  );

  return (
    <>
      <AdminPage
        back={{ href: "/admin/schools", label: "← Retour à la liste des écoles" }}
        title={school ? school.name : "…"}
        badge={school && <Badge tone={schoolStatusTone(school.status)}>{school.status}</Badge>}
        description={
          school && (
            <>
              Domaine officiel :{" "}
              <code className="rounded-control bg-surface-2 px-1.5 py-0.5 font-mono text-compact text-ink">
                {school.official_domain}
              </code>
            </>
          )
        }
      >
        {loading && !school && (
          <p className="py-10 text-center text-sm text-ink-2">Chargement des informations de l&apos;école...</p>
        )}

        {error && <Alert tone="danger">{error}</Alert>}

        {school && (
          <div>
            <Tabs
              label="Rubriques de l'école"
              idPrefix={ID_PREFIX}
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as TabKey)}
              items={TABS.map((tab) => {
                const count = getTabCount(tab.key);
                return { value: tab.key, label: tab.label, count: count !== null && count > 0 ? count : undefined };
              })}
            />
            {TABS.filter((tab) => !tab.legacy).map(panel)}
          </div>
        )}
      </AdminPage>

      {/* D60 : les onglets du lot 3, hors du sous-arbre .charte. */}
      {school && TABS.filter((tab) => tab.legacy).map(panel)}
    </>
  );
}
