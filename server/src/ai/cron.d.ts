export interface Cron { minute: Set<number>; hour: Set<number>; day: Set<number>; month: Set<number>; dow: Set<number> }
export function parseCron(expr: string): Cron;
export function cronMatches(expr: string | Cron, date: Date, tz?: string): boolean;
export function nextFire(expr: string, from?: Date, tz?: string): Date | null;
