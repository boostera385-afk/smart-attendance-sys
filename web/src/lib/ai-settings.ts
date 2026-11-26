export type ReviewMode = "manual" | "policy_auto" | "ai_assist" | "ai_auto";

export type AiSettings = {
  reviewMode: ReviewMode;
  model: string;
  minConfidence: number; // 0–1
  rejectAllowed: boolean;
  keyLast4: string | null;
  keyUpdatedAt: string | null;
};

export const DEFAULT_MODEL = "gpt-4.1-mini";
export const MODEL_SUGGESTIONS = ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"];

export const DEFAULT_AI_SETTINGS: AiSettings = {
  reviewMode: "ai_assist",
  model: DEFAULT_MODEL,
  minConfidence: 0.85,
  rejectAllowed: false,
  keyLast4: null,
  keyUpdatedAt: null,
};

export const isAiMode = (m: ReviewMode) => m === "ai_assist" || m === "ai_auto";

export type ActionResult = { ok: boolean; message: string };
