import { compatTool } from '../compat/jobs';
import { fairnessTool } from '../fairness/jobs';
import { devCardTool } from '../persona/jobs';
import { recruiterTool } from '../recruiter/jobs';

import { registerTool, type ToolDefinition } from './service';

type Registration = { slug: string; register: () => void };

// Keeps each tool's input type intact until the moment it is registered.
export const defineTool = <I>(tool: ToolDefinition<I>): Registration => ({
  slug: tool.slug,
  register: () => {
    registerTool(tool);
  },
});

/** Every day-one tool behind `/api/tools/<slug>`. A tool adds itself here when its job lands. */
export const toolDefinitions: readonly Registration[] = [defineTool(devCardTool), defineTool(compatTool), defineTool(recruiterTool), defineTool(fairnessTool)];

/** Registers every tool. Safe to call on each request: re-registering replaces the same definition. */
export function registerAllTools(): void {
  for (const tool of toolDefinitions) tool.register();
}
