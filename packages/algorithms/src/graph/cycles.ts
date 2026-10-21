/**
 * Skill swap cycles.
 * Formula: an edge A→B labelled t exists when A offers t and B wants t; its quality is
 *   level_A(t) × priority_B(t), times `selfDeclaredFactor` when A's offer is self-declared.
 *   Between two members only the best edge is kept. Cycles of 2 to `maxLength` members are
 *   found by depth-limited search; a cycle's score is the mean quality of its edges. Cycles are
 *   then picked greedily by score so that no member is in two.
 * Settings: swap.maxCycleLength, swap.selfDeclaredFactor (passed in)
 * Spec: CLAUDE.md §8 F16 "Proposal generation"
 */

export type SwapOffer = { member: string; tag: string; level: number; verified: boolean };
/** `priority` is already normalized to [0, 1]. */
export type SwapWant = { member: string; tag: string; priority: number };
export type SwapEdge = { from: string; to: string; tag: string; quality: number; verified: boolean };
export type SwapCycle = { members: string[]; edges: SwapEdge[]; score: number };

/** Shortest cycle: two members teaching each other. */
const MIN_CYCLE = 2;

/**
 * The best edge from each member to each other member (§8 F16 step 1). `allowed(a, b)` drops pairs
 * that must never be linked, such as a block either way.
 */
export function swapEdges(
  offers: readonly SwapOffer[],
  wants: readonly SwapWant[],
  options: { selfDeclaredFactor: number; allowed?: (a: string, b: string) => boolean },
): SwapEdge[] {
  const wantsByTag = new Map<string, SwapWant[]>();
  for (const want of wants) wantsByTag.set(want.tag, [...(wantsByTag.get(want.tag) ?? []), want]);
  const best = new Map<string, SwapEdge>();
  for (const offer of offers) {
    for (const want of wantsByTag.get(offer.tag) ?? []) {
      if (want.member === offer.member) continue;
      if (options.allowed && !options.allowed(offer.member, want.member)) continue;
      const quality = offer.level * want.priority * (offer.verified ? 1 : options.selfDeclaredFactor);
      if (quality <= 0) continue;
      const key = `${offer.member}\u0000${want.member}`;
      const current = best.get(key);
      // Ties keep the alphabetically first tag, so the result never depends on input order.
      if (!current || quality > current.quality || (quality === current.quality && offer.tag < current.tag)) {
        best.set(key, { from: offer.member, to: want.member, tag: offer.tag, quality, verified: offer.verified });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/**
 * Every simple cycle of 2 to `maxLength` members (§8 F16 step 2). Each cycle is reported once,
 * starting from its alphabetically first member.
 */
export function findSwapCycles(edges: readonly SwapEdge[], maxLength: number): SwapCycle[] {
  const out = new Map<string, SwapEdge[]>();
  for (const edge of edges) out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
  const cycles: SwapCycle[] = [];
  const starts = [...out.keys()].sort();
  for (const start of starts) {
    const path: SwapEdge[] = [];
    const onPath = new Set<string>([start]);
    const walk = (node: string) => {
      for (const edge of out.get(node) ?? []) {
        if (edge.to === start) {
          if (path.length + 1 >= MIN_CYCLE) {
            const cycleEdges = [...path, edge];
            cycles.push({
              members: cycleEdges.map((step) => step.from),
              edges: cycleEdges,
              score: cycleEdges.reduce((sum, step) => sum + step.quality, 0) / cycleEdges.length,
            });
          }
          continue;
        }
        // Only members after the start, so each cycle is found from one place only.
        if (edge.to < start || onPath.has(edge.to) || path.length + 1 >= maxLength) continue;
        onPath.add(edge.to);
        path.push(edge);
        walk(edge.to);
        path.pop();
        onPath.delete(edge.to);
      }
    };
    walk(start);
  }
  return cycles;
}

/**
 * Picks cycles greedily by score, highest first, so that no member is in two (§8 F16 step 4). Ties
 * prefer shorter cycles, then the alphabetically first member list, so the choice is reproducible.
 */
export function selectSwapCycles(cycles: readonly SwapCycle[]): SwapCycle[] {
  const ordered = [...cycles].sort(
    (a, b) => b.score - a.score || a.members.length - b.members.length || a.members.join(',').localeCompare(b.members.join(',')),
  );
  const taken = new Set<string>();
  const picked: SwapCycle[] = [];
  for (const cycle of ordered) {
    if (cycle.members.some((member) => taken.has(member))) continue;
    for (const member of cycle.members) taken.add(member);
    picked.push(cycle);
  }
  return picked;
}
