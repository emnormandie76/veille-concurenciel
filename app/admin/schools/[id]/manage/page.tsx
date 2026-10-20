"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import SchoolInfoTab from "./tabs/SchoolInfoTab";
import AccreditationsTab from "./tabs/AccreditationsTab";
import StatsTab from "./tabs/StatsTab";
import CampusProgramsTab from "./tabs/CampusProgramsTab";
import PricingTab from "./tabs/PricingTab";
import RankingsTab from "./tabs/RankingsTab";
import CapacitiesTab from "./tabs/CapacitiesTab";
import AdmissionsTab from "./tabs/AdmissionsTab";

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

const TABS = [
  { key: "info", label: "Infos", icon: "📋" },
  { key: "accreditations", label: "Accréditations", icon: "🏅" },
  { key: "stats", label: "Statistiques", icon: "📊" },
  { key: "campus-programs", label: "Campus & Programmes", icon: "🏫" },
  { key: "pricing", label: "Tarifs", icon: "💰" },
  { key: "rankings", label: "Classements", icon: "🏆" },
  { key: "capacities", label: "Capacités", icon: "📈" },
  // Étape 8 (D50) : l'année d'entrée et le niveau requis de chaque programme.
  { key: "admissions", label: "Admissions", icon: "🎓" },
] as const;

type TabKey = typeof TABS[number]["key"];

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

  const renderTab = () => {
    if (!school) return null;
    switch (activeTab) {
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

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ marginBottom: "20px" }}>
        <Link href="/admin/schools" className="back-link">
          ← Retour à la liste des écoles
        </Link>
      </div>

      {loading && !school && (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-secondary)" }}>
          Chargement des informations de l'école...
        </div>
      )}

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: "24px" }}>
          {error}
        </div>
      )}

      {school && (
        <>
          <div className="manage-header">
            <div className="manage-header-top">
              <h1 className="manage-school-name">{school.name}</h1>
              <span
                className={`badge ${
                  school.status === "ACTIVE"
                    ? "badge-active"
                    : school.status === "INACTIVE"
                    ? "badge-inactive"
                    : "badge-moderator"
                }`}
              >
                {school.status}
              </span>
            </div>
            <div className="manage-school-meta">
              <span>Domaine officiel :</span>
              <code>{school.official_domain}</code>
            </div>
          </div>

          <div className="tabs-nav">
            {TABS.map((tab) => {
              const count = getTabCount(tab.key);
              return (
                <button
                  key={tab.key}
                  className={`tab-button ${activeTab === tab.key ? "active" : ""}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                  {count !== null && count > 0 && <span className="tab-count">{count}</span>}
                </button>
              );
            })}
          </div>

          <div className="tab-content">{renderTab()}</div>
        </>
      )}
    </div>
  );
}
