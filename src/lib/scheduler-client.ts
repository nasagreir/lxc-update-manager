/** Client-safe cron helpers (no node-cron import). */

export function describeCron(cronExpr: string): string {
  const map: Record<string, string> = {
    "0 3 * * *": "Every day at 03:00",
    "0 3 * * 0": "Every Sunday at 03:00",
    "0 3 1 * *": "1st of each month at 03:00",
  };
  return map[cronExpr] ?? cronExpr;
}
