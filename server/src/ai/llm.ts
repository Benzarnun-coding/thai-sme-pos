/**
 * The one place that talks to a model.
 *
 * With Anthropic credentials configured the assistant runs on Claude; without
 * them it runs on the demo brain, clearly labelled, so the Studio can be shown
 * and taught before an API key exists. Either way the caller gets the same
 * shape back and the same rows are written.
 */
import Anthropic from '@anthropic-ai/sdk';
import { demoReply, type DemoAgent } from './demo-brain.js';
import type { Knowledge } from './context.js';

export type LlmMode = 'claude' | 'demo';
export interface LlmResult { text: string; mode: LlmMode; tokensIn?: number; tokensOut?: number; refused?: boolean }
export interface Turn { role: 'user' | 'assistant'; content: string }

export const DEFAULT_MODEL = 'claude-opus-5';
export const FALLBACK_MODEL = 'claude-opus-4-8';

export function aiMode(): LlmMode {
  if (process.env.LOOPDESK_AI === 'demo') return 'demo';
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? 'claude' : 'demo';
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // Zero-arg: the SDK resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN itself.
  return (client ??= new Anthropic());
}

export async function askClaude(o: {
  model: string; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  system: string; history: Turn[]; message: string;
}): Promise<LlmResult> {
  const c = getClient();
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...o.history.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: o.message },
  ];
  const res = await c.beta.messages.create({
    model: o.model,
    max_tokens: 4096,
    // Chat replies are short and routine; effort is the owner's per-assistant dial.
    output_config: { effort: o.effort },
    // The prompt is stable per assistant per day (teaching + today's data), so
    // cache it: every turn after the first reads the prefix at ~10% of the cost.
    system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }],
    messages,
    // A policy decline re-runs on the fallback model inside the same call.
    betas: ['server-side-fallback-2026-06-01'],
    fallbacks: [{ model: FALLBACK_MODEL }],
  });
  if (res.stop_reason === 'refusal') {
    return { text: 'ผู้ช่วยขอไม่ตอบคำถามนี้ ลองถามใหม่อีกแบบหรือให้แอดมินคนดูแทน', mode: 'claude', refused: true,
      tokensIn: res.usage.input_tokens, tokensOut: res.usage.output_tokens };
  }
  const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
  return { text, mode: 'claude', tokensIn: res.usage.input_tokens, tokensOut: res.usage.output_tokens };
}

export async function answer(o: {
  agent: DemoAgent & { model: string; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' };
  system: string; knowledge: Knowledge; history: Turn[]; message: string;
}): Promise<LlmResult> {
  if (aiMode() === 'claude') {
    return askClaude({ model: o.agent.model, effort: o.agent.effort, system: o.system, history: o.history, message: o.message });
  }
  return { text: demoReply(o.agent, o.knowledge, o.message), mode: 'demo' };
}
