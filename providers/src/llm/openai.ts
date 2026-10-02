// OpenAI Chat Completions adapter used by the AI Assistant.
import { postJson } from "../http";
import { requireKey, resolveModel, ProviderError, type LlmProvider } from "../types";

export const openaiLlm: LlmProvider = {
  id: "openai-llm",
  kind: "llm",
  label: "OpenAI (chat)",
  envKeys: ["OPENAI_API_KEY"],
  models: ["gpt-4.1-mini", "gpt-4.1"],
  defaultModel: "gpt-4.1-mini",
  notes: "Override the model with OPENAI_LLM_MODEL.",
  async complete(input, ctx) {
    const key = requireKey(this, ctx.env);
    const model = resolveModel(this, input.model, ctx.env);
    const base = ctx.env.OPENAI_BASE_URL?.replace(/\/$/, "") || "https://api.openai.com/v1";
    ctx.log(`POST chat/completions model=${model}`);
    const json = await postJson<{ choices?: { message?: { content?: string } }[] }>(
      this.id,
      ctx,
      `${base}/chat/completions`,
      { model, messages: [{ role: "system", content: input.system }, { role: "user", content: input.prompt }] },
      { authorization: `Bearer ${key}` },
    );
    const text = json.choices?.[0]?.message?.content ?? "";
    if (!text) throw new ProviderError(this.id, "empty response");
    return text;
  },
};
