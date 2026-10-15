/**
 * lib/ai-models.ts — Les modèles d'IA que le backend appelle, prêts à afficher
 *
 * `GET /internal/pipeline-status` porte un bloc `ai_models`
 * (`describe_model_chain()` dans backend/ai/model_chain.py) : la cascade Gemini,
 * du plus fort au plus faible, et les deux modèles Gemma du dernier recours.
 * Trois champs `ai_model_*` écrits en dur annonçaient Gemma 31B « principal »,
 * ce qui est faux depuis que le crowdsourcing passe par la cascade (C4).
 */

export interface AiModelsBlock {
  /** Du plus fort au plus faible. */
  cascade: { model: string; tier: "high" | "mid" | "low" }[];
  /** Gemma : appelé seulement quand la cascade est épuisée au-dessus du plancher. */
  last_resort: { compatibility: string; extraction: string };
}

export interface AiModelsView {
  headline: string;
  cascade: string;
  lastResort: string;
}

/** `models/gemini-3.8-flash` → `gemini-3.8-flash`. */
const shortName = (model: string) => model.replace(/^models\//, "");

/** `null` : un backend qui ne remonte pas le bloc. Mieux vaut rien qu'un modèle faux. */
export function describeAiModels(block: AiModelsBlock | undefined): AiModelsView | null {
  if (!block) return null;
  return {
    headline: "Cascade Gemini, Gemma en dernier recours",
    cascade: block.cascade.map((entry) => shortName(entry.model)).join(" → "),
    lastResort:
      `${shortName(block.last_resort.extraction)} (extraction), ` +
      `${shortName(block.last_resort.compatibility)} (compatibilité)`,
  };
}
