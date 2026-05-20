"use client";

import { useState, useEffect } from "react";

export default function ContributePage() {
    const [schools, setSchools] = useState<any[]>([]);
    const [selectedSchoolId, setSelectedSchoolId] = useState("");
    const [schoolDetails, setSchoolDetails] = useState<any | null>(null);
    const [selectedCampusId, setSelectedCampusId] = useState("");
    const [selectedProgramId, setSelectedProgramId] = useState("");
    
    const [categories, setCategories] = useState<string[]>([]);
    const [userText, setUserText] = useState("");
    const [urlInput, setUrlInput] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    const categoryOptions = [
        { id: "Pricing", label: "Tarifs" },
        { id: "Ranking", label: "Classement" },
        { id: "Capacity", label: "Capacité (Places)" },
        { id: "SchoolStats", label: "Statistiques de l'école" },
        { id: "Accreditation", label: "Accréditation" }
    ];

    useEffect(() => {
        fetch("/api/schools")
            .then(res => res.json())
            .then(data => setSchools(Array.isArray(data) ? data : []))
            .catch(() => setError("Erreur de chargement des écoles"));
    }, []);

    useEffect(() => {
        if (!selectedSchoolId) {
            setSchoolDetails(null);
            setSelectedCampusId("");
            setSelectedProgramId("");
            return;
        }
        fetch(`/api/schools/${selectedSchoolId}`)
            .then(res => res.json())
            .then(data => setSchoolDetails(data))
            .catch(() => setError("Erreur de chargement des détails"));
    }, [selectedSchoolId]);

    const handleCategoryToggle = (catId: string) => {
        setCategories(prev => 
            prev.includes(catId) ? prev.filter(c => c !== catId) : [...prev, catId]
        );
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setMessage("");

        if (!selectedSchoolId) return setError("Veuillez sélectionner une école.");
        if (categories.length === 0) return setError("Sélectionnez au moins une catégorie.");
        if (!urlInput.startsWith("https://")) return setError("L'URL doit commencer par https://");

        setSubmitting(true);
        try {
            const res = await fetch("/api/contribute", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    schoolId: selectedSchoolId,
                    campusId: selectedCampusId || null,
                    programId: selectedProgramId || null,
                    categories,
                    userText,
                    urls: [urlInput]
                })
            });
            const data = await res.json();
            if (res.ok) {
                setMessage(`Merci ! ${data.ticketsCreated} soumission(s) enregistrée(s).`);
                setCategories([]);
                setUserText("");
                setUrlInput("https://");
            } else {
                setError(data.error || "Une erreur est survenue.");
            }
        } catch (err: any) {
            setError(err.message || "Erreur de connexion.");
        } finally {
            setSubmitting(false);
        }
    };

    const campuses = schoolDetails?.campuses || [];
    const programs = campuses.find((c: any) => c.id === selectedCampusId)?.programs || [];

    return (
        <div className="max-w-2xl mx-auto py-10 px-4">
            <h1 className="text-2xl font-bold mb-6">Soumettre une information</h1>
            
            {error && <div className="bg-red-100 text-red-700 p-3 rounded mb-4">{error}</div>}
            {message && <div className="bg-green-100 text-green-700 p-3 rounded mb-4">{message}</div>}
            
            <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                    <label className="block text-sm font-medium mb-1">École *</label>
                    <select 
                        className="w-full border border-gray-300 rounded p-2"
                        value={selectedSchoolId}
                        onChange={e => setSelectedSchoolId(e.target.value)}
                        required
                    >
                        <option value="">Sélectionnez une école</option>
                        {schools.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>
                </div>

                {campuses.length > 0 && (
                    <div>
                        <label className="block text-sm font-medium mb-1">Campus (Optionnel)</label>
                        <select 
                            className="w-full border border-gray-300 rounded p-2"
                            value={selectedCampusId}
                            onChange={e => {
                                setSelectedCampusId(e.target.value);
                                setSelectedProgramId("");
                            }}
                        >
                            <option value="">Tous les campus / Non spécifié</option>
                            {campuses.map((c: any) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                )}

                {selectedCampusId && programs.length > 0 && (
                    <div>
                        <label className="block text-sm font-medium mb-1">Programme (Optionnel)</label>
                        <select 
                            className="w-full border border-gray-300 rounded p-2"
                            value={selectedProgramId}
                            onChange={e => setSelectedProgramId(e.target.value)}
                        >
                            <option value="">Tous les programmes / Non spécifié</option>
                            {programs.map((p: any) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    </div>
                )}

                <div>
                    <label className="block text-sm font-medium mb-2">Catégories de l'information *</label>
                    <div className="grid grid-cols-2 gap-2">
                        {categoryOptions.map(cat => (
                            <label key={cat.id} className="flex items-center space-x-2">
                                <input 
                                    type="checkbox" 
                                    checked={categories.includes(cat.id)}
                                    onChange={() => handleCategoryToggle(cat.id)}
                                />
                                <span>{cat.label}</span>
                            </label>
                        ))}
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1">Que souhaitez-vous signaler ? (Texte libre)</label>
                    <textarea 
                        className="w-full border border-gray-300 rounded p-2"
                        rows={3}
                        value={userText}
                        onChange={e => setUserText(e.target.value)}
                        placeholder="Ex: Les frais 2025 ont augmenté, ils sont de 8500€..."
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1">URL de la source officielle *</label>
                    <input 
                        type="url" 
                        className="w-full border border-gray-300 rounded p-2"
                        value={urlInput}
                        onChange={e => setUrlInput(e.target.value)}
                        placeholder="https://..."
                        required
                    />
                </div>

                <button 
                    type="submit" 
                    disabled={submitting}
                    className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
                >
                    {submitting ? "Envoi..." : "Soumettre"}
                </button>
            </form>
        </div>
    );
}