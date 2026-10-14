import type { ToolSlug } from '@/copy/landing';

/**
 * Tools whose pages are live. A tool is added here by the task that ships its page, so
 * the landing page never links to something that does not exist yet.
 */
export const AVAILABLE_TOOLS: ReadonlySet<ToolSlug> = new Set<ToolSlug>(['dev-card', 'compat', 'recruiter', 'fairness', 'graveyard']);

export const toolPath = (slug: ToolSlug) => `/tools/${slug}`;
