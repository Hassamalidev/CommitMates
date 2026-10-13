import { z } from 'zod';

import { SettingKeys, type SettingKey, type SettingValueType } from './keys';

const weight = z.number();

const modeWeights = z.object({ sim: weight, int: weight, comp: weight });

/** Shapes of the JSON-typed settings. Values are parsed on every read (CLAUDE.md §5.5). */
export const jsonSettingSchemas = {
  'compat.weights': z.object({ skill: weight, interest: weight, rhythm: weight, complement: weight }),
  'compat.bands': z.array(z.object({ min: z.number(), key: z.string().min(1) })).min(1),
  'recruiter.weights': z.record(z.string(), z.number().nonnegative()),
  'graveyard.weights': z.object({ promise: weight, demand: weight, unfinished: weight, freshness: weight }),
  'matching.weights': z.object({ study: modeWeights, teammate: modeWeights, explore: modeWeights }),
  'trust.weights': z.object({ age: weight, verified: weight, acceptRate: weight, reports: weight }),
  'leaderboard.weights': z.object({
    activeRatio: weight,
    medianActiveDays: weight,
    revivals: weight,
    helpfulReviews: weight,
  }),
} satisfies Record<JsonSettingKey, z.ZodType>;

export type JsonSettingKey = {
  [K in SettingKey]: (typeof SettingKeys)[K] extends 'json' ? K : never;
}[SettingKey];

type ScalarValue<T extends SettingValueType> = T extends 'number' | 'integer'
  ? number
  : T extends 'boolean'
    ? boolean
    : T extends 'string'
      ? string
      : T extends 'string[]'
        ? string[]
        : T extends 'number[]'
          ? number[]
          : never;

export type SettingValue<K extends SettingKey> = K extends JsonSettingKey
  ? z.infer<(typeof jsonSettingSchemas)[K]>
  : ScalarValue<(typeof SettingKeys)[K]>;

/** Every scalar type the `settings.value_type` check accepts, whether or not a key uses it yet. */
type ScalarType = 'number' | 'integer' | 'boolean' | 'string' | 'string[]' | 'number[]';

const scalarSchemas: Record<ScalarType, z.ZodType> = {
  number: z.number(),
  integer: z.number().int(),
  boolean: z.boolean(),
  string: z.string(),
  'string[]': z.array(z.string()),
  'number[]': z.array(z.number()),
};

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SettingKeys, key);
}

/** The schema a value of `key` must satisfy, from its declared type or its JSON shape. */
export function schemaForSetting(key: SettingKey): z.ZodType {
  const type = SettingKeys[key];
  if (type === 'json') return jsonSettingSchemas[key as JsonSettingKey];
  return scalarSchemas[type];
}
