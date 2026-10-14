/**
 * Coding-rhythm metrics behind the Dev Card.
 * Formula: hourHist[h] = Σ weight(event at local hour h) / Σ weight, weight = commits of a push
 *            (capped) or 1;
 *          nightShare = Σ hourHist[22, 23, 0–3]; morningShare = Σ hourHist[5–8];
 *          weekendShare = Σ counts on Sat + Sun / Σ counts;
 *          activeDayShare = days with count > 0 / days; cv = σ / mean of daily counts;
 *          longestStreak = longest run of consecutive days with count > 0
 * Settings: none (thresholds are applied in labels.ts)
 * Spec: CLAUDE.md §8 F1 steps 2–4
 */

import { coefficientOfVariation, sum } from '../stats/basic';
import { localClock, weekdayOfDate } from '../time/local';

/** Hours in a day: the length of an hour histogram. */
export const HOURS_PER_DAY = 24;
/** A single push counts for at most this many commits, so one bulk import cannot define a rhythm (§8 F1 step 2). */
export const MAX_PUSH_WEIGHT = 20;
/** Local hours that count as night: 22:00–04:00 (§8 F1 step 3). */
export const NIGHT_HOURS: readonly number[] = [22, 23, 0, 1, 2, 3];
/** Local hours that count as early morning: 05:00–09:00 (§8 F1 step 3). */
export const MORNING_HOURS: readonly number[] = [5, 6, 7, 8];
/** `Date#getUTCDay` value of Saturday. */
const SATURDAY = 6;
const SUNDAY = 0;

export type TimedEvent = {
  /** ISO timestamp. */
  createdAt: string;
  /** Commits in a push; 0 or absent for other kinds of activity. */
  commits?: number;
};

export type DayCount = { date: string; count: number };

/** How much one event counts: a push by its commits (capped), anything else once. */
export function eventWeight(event: TimedEvent): number {
  const commits = event.commits ?? 0;
  return commits > 0 ? Math.min(commits, MAX_PUSH_WEIGHT) : 1;
}

/**
 * Shares of activity per local hour of the day. All zeros when there are no events.
 * Events with an unreadable timestamp are ignored.
 */
export function hourHistogram(events: readonly TimedEvent[], timeZone: string): number[] {
  const weights = new Array<number>(HOURS_PER_DAY).fill(0);
  for (const event of events) {
    const instant = new Date(event.createdAt);
    if (Number.isNaN(instant.getTime())) continue;
    const { hour } = localClock(instant, timeZone);
    weights[hour] = (weights[hour] ?? 0) + eventWeight(event);
  }
  const total = sum(weights);
  return total === 0 ? weights : weights.map((weight) => weight / total);
}

/** Sum of a histogram over the given hours. */
export function hourShare(histogram: readonly number[], hours: readonly number[]): number {
  let share = 0;
  for (const hour of hours) share += histogram[hour] ?? 0;
  return share;
}

export const nightShare = (histogram: readonly number[]) => hourShare(histogram, NIGHT_HOURS);
export const morningShare = (histogram: readonly number[]) => hourShare(histogram, MORNING_HOURS);

/** Share of contributions made on Saturdays and Sundays. 0 when there are none. */
export function weekendShare(days: readonly DayCount[]): number {
  let weekend = 0;
  let total = 0;
  for (const day of days) {
    total += day.count;
    const weekday = weekdayOfDate(day.date);
    if (weekday === SATURDAY || weekday === SUNDAY) weekend += day.count;
  }
  return total === 0 ? 0 : weekend / total;
}

/** Share of days with at least one contribution. 0 for an empty window. */
export function activeDayShare(days: readonly DayCount[]): number {
  if (days.length === 0) return 0;
  return days.filter((day) => day.count > 0).length / days.length;
}

/** Coefficient of variation of the daily counts: high when work comes in bursts. */
export function dailyCv(days: readonly DayCount[]): number {
  return coefficientOfVariation(days.map((day) => day.count));
}

/** Longest run of consecutive days with at least one contribution. Days must be in date order. */
export function longestStreak(days: readonly DayCount[]): number {
  let longest = 0;
  let current = 0;
  for (const day of days) {
    current = day.count > 0 ? current + 1 : 0;
    if (current > longest) longest = current;
  }
  return longest;
}

/** The most recent `count` days of a calendar, in date order. */
export function lastDays(days: readonly DayCount[], count: number): DayCount[] {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return count <= 0 ? [] : sorted.slice(-count);
}

export type RhythmMetrics = {
  nightShare: number;
  morningShare: number;
  weekendShare: number;
  cv: number;
  activeDayShare: number;
};

/** The five label metrics from an hour histogram and a window of daily counts. */
export function rhythmMetrics(histogram: readonly number[], windowDays: readonly DayCount[]): RhythmMetrics {
  return {
    nightShare: nightShare(histogram),
    morningShare: morningShare(histogram),
    weekendShare: weekendShare(windowDays),
    cv: dailyCv(windowDays),
    activeDayShare: activeDayShare(windowDays),
  };
}
