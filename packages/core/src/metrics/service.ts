import { fairnessReportsPerWeek, markToolConversions, toolConversion, toolUsage, type ToolUsageRow, type WeeklyCount } from '@commitmates/db';

/** Display windows of the admin metrics page; they change what is shown, not how anything behaves. */
export const METRIC_WINDOWS = {
  /** Short and long usage windows, in days. */
  recentDays: 7,
  totalDays: 30,
  /** Sign-ups count as conversions within a day of the tool run (CLAUDE.md §1.7). */
  conversionDays: 1,
  /** Weeks of fairness reports shown. */
  fairnessWeeks: 8,
} as const;

export type ToolMetrics = {
  usage: ToolUsageRow[];
  conversion: { sessions: number; converted: number; rate: number | null };
  fairnessWeekly: WeeklyCount[];
};

/**
 * The Phase 2 success metrics for `/admin/metrics` (CLAUDE.md §1.7): runs per tool, tool
 * conversion, and fairness reports per week. Every number comes from our own tables.
 */
export async function getToolMetrics(now: Date = new Date()): Promise<ToolMetrics> {
  const { recentDays, totalDays, conversionDays, fairnessWeeks } = METRIC_WINDOWS;
  const [usage, conversion, fairnessWeekly] = await Promise.all([
    toolUsage(now, recentDays, totalDays),
    // Runs from the last day are still inside their conversion window, so they are left out.
    toolConversion(now, totalDays, conversionDays),
    fairnessReportsPerWeek(now, fairnessWeeks),
  ]);
  return {
    usage,
    conversion: { ...conversion, rate: conversion.sessions === 0 ? null : conversion.converted / conversion.sessions },
    fairnessWeekly,
  };
}

/** Credits a new member's sign-up to their anonymous tool runs of the past day (§1.7). */
export function recordSignUpConversion(userId: string, ipHashDay: string, now: Date = new Date()): Promise<number> {
  return markToolConversions(userId, ipHashDay, now);
}
