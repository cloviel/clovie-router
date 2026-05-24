/** Pricing per 1M tokens & context windows for MiMo models */
export const MODEL_PRICING: Record<string, {
  input: number;    // $/1M input tokens
  output: number;   // $/1M output tokens
  context: number;  // context window
  modality: string;
}> = {
  'mimo-v2-flash':              { input: 0.10, output: 0.20, context: 131_072,    modality: 'text→text' },
  'mimo-v2-omni':               { input: 0.30, output: 0.60, context: 262_144,    modality: 'text+image→text' },
  'mimo-v2-pro':                { input: 0.25, output: 0.50, context: 262_144,    modality: 'text→text' },
  'mimo-v2-tts':                { input: 0,    output: 0,    context: 0,          modality: 'text→audio' },
  'mimo-v2.5':                  { input: 0.20, output: 0.40, context: 524_288,    modality: 'text→text' },
  'mimo-v2.5-pro':              { input: 0.35, output: 0.70, context: 1_048_576,  modality: 'text→text' },
  'mimo-v2.5-tts':              { input: 0,    output: 0,    context: 0,          modality: 'text→audio' },
  'mimo-v2.5-tts-voiceclone':   { input: 0,    output: 0,    context: 0,          modality: 'text→audio' },
  'mimo-v2.5-tts-voicedesign':  { input: 0,    output: 0,    context: 0,          modality: 'text→audio' },
};
