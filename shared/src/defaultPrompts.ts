// Seed templates for the Prompt Library (inserted on first start if missing).
import { extractVariables } from "./prompt";

export interface PromptSeed {
  id: string;
  name: string;
  category: string;
  description: string;
  template: string;
}

const SEEDS: PromptSeed[] = [
  {
    id: "CHARACTER_CONSISTENCY_V1",
    name: "Character consistency",
    category: "Character Consistency",
    description: "Keeps the same person across all scenes.",
    template:
      "Maintain the same character identity throughout all scenes: {{character}}.\nPreserve facial identity, hairstyle, body proportions and outfit.",
  },
  {
    id: "PRODUCT_CONSISTENCY_V1",
    name: "Product consistency",
    category: "Product Consistency",
    description: "Keeps packaging, logo and label identical.",
    template:
      "Show {{product}} exactly as in the reference images.\nDo not change the packaging shape, logo, label text or colors.",
  },
  {
    id: "CINEMATIC_PRODUCT_SCENE_V1",
    name: "Cinematic product scene",
    category: "Cinematic",
    description: "General cinematic scene with character and product.",
    template:
      "Create a cinematic product scene featuring {{character}} using {{product}}.\nLocation:\n{{location}}\nAction:\n{{action}}\nCamera:\n{{camera}}",
  },
  {
    id: "BEAUTY_CLOSEUP_V1",
    name: "Beauty close-up",
    category: "Beauty",
    description: "Soft beauty lighting close-up.",
    template: "Beauty close-up of {{character}}, soft diffused key light, glowing skin, shallow depth of field. {{action}}",
  },
  {
    id: "PRODUCT_REVIEW_V1",
    name: "Product review talking head",
    category: "Product Review",
    description: "Authentic review framing.",
    template:
      "{{character}} holds {{product}} toward the camera and talks naturally, like an honest product review. Location: {{location}}.",
  },
  {
    id: "TIKTOK_HOOK_V1",
    name: "TikTok hook",
    category: "TikTok",
    description: "Fast vertical hook for the first 3 seconds.",
    template: "Vertical 9:16 hook shot, energetic, eye contact with the lens, {{action}}. Must grab attention in the first 2 seconds.",
  },
  {
    id: "LIFESTYLE_V1",
    name: "Lifestyle",
    category: "Lifestyle",
    description: "Natural everyday setting.",
    template: "Natural lifestyle moment in {{location}}, candid, warm daylight. {{character}} {{action}}",
  },
  {
    id: "CAMERA_PUSH_IN_V1",
    name: "Slow push-in",
    category: "Camera",
    description: "Slow dolly in.",
    template: "Medium shot, slow push in toward the subject over {{duration}}.",
  },
  {
    id: "LIGHTING_SOFT_V1",
    name: "Soft natural light",
    category: "Lighting",
    description: "Soft window light.",
    template: "Soft natural window light from the side, gentle shadows, clean highlights.",
  },
  {
    id: "VOICE_FRIENDLY_V1",
    name: "Friendly voice-over",
    category: "Voice",
    description: "Warm conversational delivery.",
    template: "Speak in a warm, friendly, conversational tone, like recommending a product to a close friend. Line: {{dialogue}}",
  },
  {
    id: "VIDEO_MOTION_NATURAL_V1",
    name: "Natural motion",
    category: "Video Motion",
    description: "Subtle realistic motion.",
    template: "Subtle, realistic motion. {{action}} Keep the character and {{product}} unchanged during the {{duration}} clip.",
  },
  {
    id: "TRANSITION_MATCH_CUT_V1",
    name: "Match cut",
    category: "Transition",
    description: "Match cut between scenes.",
    template: "End the shot on a framing that can match-cut into the next scene.",
  },
  {
    id: "NEGATIVE_DEFAULT_V1",
    name: "Default negative",
    category: "Negative Prompt",
    description: "Common artifacts to avoid.",
    template: "blurry, distorted hands, extra fingers, warped text, wrong logo, watermark, low resolution",
  },
];

export const DEFAULT_PROMPT_TEMPLATES = SEEDS.map((s) => ({ ...s, variables: extractVariables(s.template) }));
