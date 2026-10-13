import { z } from 'zod';

/** What the auth callback learned from Supabase and GitHub about the person signing in. */
export const signInSchema = z.object({
  userId: z.uuid(),
  githubId: z.number().int().positive(),
  login: z.string().min(1),
  name: z.string().nullable(),
  avatarUrl: z.url().nullable(),
  /** The member's GitHub OAuth token; absent when Supabase restores a session without one. */
  providerToken: z.string().min(1).nullable(),
  scopes: z.array(z.string()),
});

export type SignInInput = z.infer<typeof signInSchema>;

export type MemberRole = { role: 'admin' | 'uni_moderator'; universityId: string | null };

export type Member = {
  id: string;
  status: 'active' | 'suspended' | 'hidden_pending_review';
  githubId: number | null;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  /** False when the stored GitHub token is missing or was rejected; the member must sign in again. */
  hasValidToken: boolean;
  universityId: string | null;
  verified: boolean;
  onboarded: boolean;
  timezone: string;
  roles: MemberRole[];
};
