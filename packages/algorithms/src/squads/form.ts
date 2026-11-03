/**
 * Squad formation.
 * Formula: team count = ⌈participants ÷ team size⌉. Locked groups go first, each into its own team
 *   (largest first; groups beyond the team count join the smallest team). Then, repeatedly, the open
 *   team (below the team size) missing the most roles that someone still unassigned could fill (ties:
 *   fewest members, then order) takes the
 *   unassigned participant who covers one of its missing roles, among those whose weekly hours keep
 *   the team's common free time at `squads.minOverlapHours` or more (everyone when nobody fits);
 *   ties go to whoever brings the team's mean activity closest to the event's mean, then to id order.
 *   Availability is a set of hour slots in the event's first week, so teams compare in one clock.
 * Settings: squads.defaultTeamSize (via the event), squads.minOverlapHours (passed in)
 * Spec: CLAUDE.md §8 F21 "Formation"
 */
import { localClock } from '../time/local';

const MS_PER_HOUR = 60 * 60 * 1000; // allowed-literal: unit conversion
/** Hours in a week. */
export const HOURS_PER_WEEK = 7 * 24; // allowed-literal: unit conversion

/** Free time on one weekday in the member's own clock: hours `from` (inclusive) to `to` (exclusive), 0–24. */
export type AvailabilityBlock = { weekday: number; from: number; to: number };

/**
 * The hour slots (0 = the event's start hour … 167) in which the member is free during the event's
 * first week, reading their blocks in their own timezone (daylight-saving shifts included).
 */
export function availabilitySlots(blocks: readonly AvailabilityBlock[], timeZone: string, weekStart: Date): Set<number> {
  const slots = new Set<number>();
  for (let slot = 0; slot < HOURS_PER_WEEK; slot += 1) {
    const { weekday, hour } = localClock(new Date(weekStart.getTime() + slot * MS_PER_HOUR), timeZone);
    if (blocks.some((block) => block.weekday === weekday && hour >= block.from && hour < block.to)) slots.add(slot);
  }
  return slots;
}

export type SquadCandidate = {
  id: string;
  /** The member's role (cluster index); null without a skill vector. */
  role: number | null;
  /** Activity score in [0, 1]; null when unknown. */
  activity: number | null;
  /** Free hour slots; null when the member gave none. */
  slots: ReadonlySet<number> | null;
  /** Members who locked a group share its key. */
  group: string | null;
};

export type FormationRules = { teamSize: number; roleCount: number; minOverlapHours: number };

const byId = (a: SquadCandidate, b: SquadCandidate) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Hours every member with availability shares; null when nobody gave any. */
function commonSlots(members: readonly SquadCandidate[]): Set<number> | null {
  const given = members.flatMap((member) => (member.slots === null ? [] : [member.slots]));
  const [first, ...rest] = given;
  if (!first) return null;
  return new Set([...first].filter((slot) => rest.every((slots) => slots.has(slot))));
}

/** Teams of participant ids, in team order; empty teams are dropped. */
export function formSquads(candidates: readonly SquadCandidate[], rules: FormationRules): string[][] {
  if (candidates.length === 0) return [];
  const teamSize = Math.max(1, rules.teamSize);
  const teams: SquadCandidate[][] = Array.from({ length: Math.ceil(candidates.length / teamSize) }, () => []);
  const known = candidates.flatMap((candidate) => (candidate.activity === null ? [] : [candidate.activity]));
  const eventMean = known.length === 0 ? 0 : known.reduce((sum, value) => sum + value, 0) / known.length;
  const activityOf = (candidate: SquadCandidate) => candidate.activity ?? eventMean;
  const smallest = () => teams.reduce((best, team, index) => ((teams[best]?.length ?? 0) <= team.length ? best : index), 0);

  const groups = new Map<string, SquadCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.group === null) continue;
    groups.set(candidate.group, [...(groups.get(candidate.group) ?? []), candidate]);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  ordered.forEach(([, members], index) => {
    const target = index < teams.length ? index : smallest();
    teams[target]?.push(...[...members].sort(byId));
  });

  const remaining = candidates.filter((candidate) => candidate.group === null).sort(byId);
  // Only roles someone unassigned can still fill count as missing, so a team never waits for a role
  // nobody left has while another team could still be completed.
  const missing = (team: readonly SquadCandidate[]) => {
    const present = new Set(team.map((member) => member.role));
    const available = new Set(remaining.map((candidate) => candidate.role));
    let count = 0;
    for (let role = 0; role < rules.roleCount; role += 1) if (!present.has(role) && available.has(role)) count += 1;
    return count;
  };
  while (remaining.length > 0) {
    const open = teams.map((team, index) => ({ team, index })).filter(({ team }) => team.length < teamSize);
    const choices = open.length > 0 ? open : [{ team: teams[smallest()] ?? [], index: smallest() }];
    choices.sort((a, b) => missing(b.team) - missing(a.team) || a.team.length - b.team.length || a.index - b.index);
    const team = choices[0]?.team;
    if (!team) break;
    const fits = remaining.filter((candidate) => {
      const common = commonSlots([...team, candidate]);
      return common === null || common.size >= rules.minOverlapHours;
    });
    const pool = fits.length > 0 ? fits : remaining;
    const present = new Set(team.map((member) => member.role));
    const covers = (candidate: SquadCandidate) => (candidate.role !== null && !present.has(candidate.role) ? 1 : 0);
    const meanWith = (candidate: SquadCandidate) => [...team, candidate].reduce((sum, member) => sum + activityOf(member), 0) / (team.length + 1);
    const pick = [...pool].sort((a, b) => covers(b) - covers(a) || Math.abs(meanWith(a) - eventMean) - Math.abs(meanWith(b) - eventMean) || byId(a, b))[0];
    if (!pick) break;
    team.push(pick);
    remaining.splice(remaining.indexOf(pick), 1);
  }
  return teams.filter((team) => team.length > 0).map((team) => team.map((member) => member.id));
}
