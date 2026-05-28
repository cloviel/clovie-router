/** Pricing per 1M tokens & context windows — mimo-v2.5-pro only */
export const MODEL_PRICING: Record<string, {
  input: number;    // $/1M input tokens
  output: number;   // $/1M output tokens
  context: number;  // context window
  modality: string;
}> = {
  'mimo-v2.5-pro': { input: 0.35, output: 0.70, context: 1_048_576, modality: 'text→text' },
};
