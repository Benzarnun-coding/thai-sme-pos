import type { Knowledge } from './context.js';

export interface DemoAgent {
  slug: string;
  name: string;
  instructions: string;
  autonomy: 'propose' | 'auto';
  addons: { knowledge?: string[]; actions?: string[] };
}

export function demoReply(agent: DemoAgent, knowledge: Knowledge, message: string): string;
