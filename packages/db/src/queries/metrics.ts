import { sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion

/** postgres.js does not serialize `Date` in raw SQL; bind instants as ISO text. */
const at = (date: Date) => sql`${date.toISOString()}::timestamptz`;

export type ToolUsageRow = { tool: string; recent: number; total: number };

/** Runs per tool in the last `recentDays` and the last `totalDays` (CLAUDE.md §1.7). */
export async function toolUsage(now: Date, recentDays: number, totalDays: number, db: DbOrTx = getDb()): Promise<ToolUsageRow[]> {
  const recentFrom = new Date(now.getTime() - recentDays * MS_PER_DAY);
  const totalFrom = new Date(now.getTime() - totalDays * MS_PER_DAY);
  const rows = await db.execute<{ tool: string; recent: number; total: number }>(sql`
    select tool,
      (count(*) filter (where created_at >= ${at(recentFrom)}))::int as recent,
      count(*)::int as total
    from tool_sessions
    where created_at >= ${at(totalFrom)} and created_at <= ${at(now)}
    group by tool
    order by total desc, tool`);
  return [...rows];
}

export type ToolConversion = { sessions: number; converted: number };

/**
 * Anonymous tool runs between `fromDays` and `untilDays` ago, and how many of them led to a
 * sign-up (CLAUDE.md §1.7 "Tool conversion"). Runs younger than the conversion window are
 * left out by the caller's `untilDays`, so the rate is not diluted by runs still in it.
 */
export async function toolConversion(now: Date, fromDays: number, untilDays: number, db: DbOrTx = getDb()): Promise<ToolConversion> {
  const from = new Date(now.getTime() - fromDays * MS_PER_DAY);
  const until = new Date(now.getTime() - untilDays * MS_PER_DAY);
  const rows = await db.execute<{ sessions: number; converted: number }>(sql`
    select count(*)::int as sessions, count(converted_user_id)::int as converted
    from tool_sessions
    where user_id is null and created_at >= ${at(from)} and created_at < ${at(until)}`);
  return { sessions: rows[0]?.sessions ?? 0, converted: rows[0]?.converted ?? 0 };
}

export type WeeklyCount = { weekStart: string; count: number };

/** Fairness reports generated per ISO week (Monday, UTC) over the last `weeks` weeks (§1.7). */
export async function fairnessReportsPerWeek(now: Date, weeks: number, db: DbOrTx = getDb()): Promise<WeeklyCount[]> {
  const rows = await db.execute<{ week_start: string; count: number }>(sql`
    select to_char(date_trunc('week', computed_at at time zone 'UTC'), 'YYYY-MM-DD') as week_start, count(*)::int as count
    from fairness_reports
    where computed_at >= date_trunc('week', ${at(now)} at time zone 'UTC') at time zone 'UTC' - make_interval(weeks => ${weeks - 1})
      and computed_at <= ${at(now)}
    group by 1
    order by 1`);
  return rows.map((row) => ({ weekStart: row.week_start, count: row.count }));
}
