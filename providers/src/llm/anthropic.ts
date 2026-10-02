// Anthropic Messages API adapter used by the AI Assistant.
import { postJson } from "../http";
import { requireKey, resolveModel, ProviderError, type LlmProvider } from "../types";

export const anthropicLlm: LlmProvider = {
  id: "anthropic",
  kind: "llm",
  label: "Anthropic Claude",
  envKeys: ["ANTHROPIC_API_KEY"],
  models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"],
  defaultModel: "claude-sonnet-5-5",
  async complete(input, ctx) {
    const key = requireKey(this, ctx.env);
    const model = resolveModel(this, input.model, ctx.env);
    ctx.log(`POST messages model=${model}`);
    const json = await postJson<{ content?: { type: string; text?: string }[] }>(
      this.id,
      ctx,
      "https://api.anthropic.com/v1/messages",
      { model, max_tokens: input.maxTokens ?? 8000, system: input.system, messages: [{ role: "user", content: input.prompt }] },
      { "x-api-key": key, "anthropic-version": "2023-06-01" },
    );
    const text = (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    if (!text) throw new ProviderError(this.id, "empty response");
    return text;
  },
};
