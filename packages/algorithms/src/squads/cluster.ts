/**
 * Event roles from skill clusters.
 * Formula: skill vectors become dense points over the union of their tags; k-means (Lloyd's
 *   iterations, Euclidean distance) starts from k-means++ seeding with a seeded RNG, for every k in
 *   [2, min(kMax, ⌊n ÷ 2⌋)]; the k with the best mean silhouette wins (ties: the smaller k).
 *   Silhouette s(i) = (b − a) ÷ max(a, b), with a the mean distance to the own cluster and b the
 *   lowest mean distance to another cluster; points alone in their cluster score 0. Each role is
 *   named by the top tags of its centroid.
 * Settings: squads.kMax, squads.maxIterations (passed in)
 * Spec: CLAUDE.md §8 F21 "Roles"
 */
import { mulberry32 } from '../stats/random';

export type Point = readonly number[];

/** Dense points over the sorted union of the vectors' tags. */
export function densify(vectors: readonly Readonly<Record<string, number>>[]): { tags: string[]; points: number[][] } {
  const tags = [...new Set(vectors.flatMap((vector) => Object.keys(vector)))].sort();
  return { tags, points: vectors.map((vector) => tags.map((tag) => vector[tag] ?? 0)) };
}

export function squaredDistance(a: Point, b: Point): number {
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    sum += delta * delta;
  }
  return sum;
}

const distance = (a: Point, b: Point) => Math.sqrt(squaredDistance(a, b));

function nearest(point: Point, centroids: readonly Point[]): number {
  let best = 0;
  let bestDistance = Infinity;
  centroids.forEach((centroid, index) => {
    const d = squaredDistance(point, centroid);
    if (d < bestDistance) {
      best = index;
      bestDistance = d;
    }
  });
  return best;
}

/** k-means++ seeding: each next centroid is drawn with probability proportional to its squared distance. */
function seedCentroids(points: readonly Point[], k: number, random: () => number): number[][] {
  const first = points[Math.floor(random() * points.length)] ?? [];
  const centroids: number[][] = [[...first]];
  while (centroids.length < k) {
    const weights = points.map((point) => Math.min(...centroids.map((centroid) => squaredDistance(point, centroid))));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let pick = 0;
    if (total === 0) {
      pick = Math.floor(random() * points.length);
    } else {
      let target = random() * total;
      for (; pick < points.length - 1; pick += 1) {
        target -= weights[pick] ?? 0;
        if (target < 0) break;
      }
    }
    centroids.push([...(points[pick] ?? first)]);
  }
  return centroids;
}

export type Clustering = { k: number; assignments: number[]; centroids: number[][] };

/** Lloyd's k-means from k-means++ seeds, until assignments settle or `maxIterations`. */
export function kMeans(points: readonly Point[], k: number, seed: number, maxIterations: number): Clustering {
  const random = mulberry32(seed);
  const centroids = seedCentroids(points, k, random);
  let assignments = points.map((point) => nearest(point, centroids));
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    centroids.forEach((centroid, cluster) => {
      const members = points.filter((_, index) => assignments[index] === cluster);
      // An emptied cluster keeps its centroid.
      if (members.length === 0) return;
      for (let dim = 0; dim < centroid.length; dim += 1) centroid[dim] = members.reduce((sum, point) => sum + (point[dim] ?? 0), 0) / members.length;
    });
    const next = points.map((point) => nearest(point, centroids));
    const changed = next.some((cluster, index) => cluster !== assignments[index]);
    assignments = next;
    if (!changed) break;
  }
  return { k, assignments, centroids };
}

/** Mean silhouette of a clustering. */
export function silhouette(points: readonly Point[], assignments: readonly number[]): number {
  if (points.length === 0) return 0;
  const clusters = [...new Set(assignments)];
  let total = 0;
  points.forEach((point, index) => {
    const own = assignments[index];
    const meanTo = (cluster: number) => {
      const others = points.filter((_, other) => other !== index && assignments[other] === cluster);
      return others.length === 0 ? null : others.reduce((sum, other) => sum + distance(point, other), 0) / others.length;
    };
    const a = own === undefined ? null : meanTo(own);
    // A point alone in its cluster scores 0.
    if (a === null) return;
    const b = Math.min(...clusters.filter((cluster) => cluster !== own).map((cluster) => meanTo(cluster) ?? Infinity));
    const scale = Math.max(a, b);
    if (Number.isFinite(b) && scale > 0) total += (b - a) / scale;
  });
  return total / points.length;
}

/** The fewest clusters tried (§8 F21 "Roles" step 2). */
export const MIN_CLUSTERS = 2;
/** Points per cluster the range of k allows at least: k ≤ ⌊n ÷ 2⌋ (§8 F21 "Roles" step 2). */
export const POINTS_PER_CLUSTER = 2;

/** The clustering with the best silhouette for k in [2, min(kMax, ⌊n ÷ 2⌋)]; one cluster when that range is empty. */
export function chooseClusters(points: readonly Point[], kMax: number, seed: number, maxIterations: number): Clustering & { silhouette: number } {
  const upper = Math.min(kMax, Math.floor(points.length / POINTS_PER_CLUSTER));
  if (upper < MIN_CLUSTERS) {
    const dims = points[0]?.length ?? 0;
    const centroid = Array.from({ length: dims }, (_, dim) => points.reduce((sum, point) => sum + (point[dim] ?? 0), 0) / Math.max(1, points.length));
    return { k: 1, assignments: points.map(() => 0), centroids: [centroid], silhouette: 0 };
  }
  let best: (Clustering & { silhouette: number }) | null = null;
  for (let k = MIN_CLUSTERS; k <= upper; k += 1) {
    const clustering = kMeans(points, k, seed, maxIterations);
    const score = silhouette(points, clustering.assignments);
    if (best === null || score > best.silhouette) best = { ...clustering, silhouette: score };
  }
  // upper ≥ 2 guarantees one run.
  return best ?? { k: 1, assignments: [], centroids: [], silhouette: 0 };
}

/** The `count` heaviest tags of a centroid, heaviest first; zero weights are left out. */
export function centroidTags(centroid: Point, tags: readonly string[], count: number): string[] {
  return tags
    .map((tag, index) => ({ tag, weight: centroid[index] ?? 0 }))
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || (a.tag < b.tag ? -1 : 1))
    .slice(0, count)
    .map((entry) => entry.tag);
}
