'use server';

import {
  applySupervisor,
  checkIdea,
  confirmDetectedProject,
  decideSupervisor,
  dismissDetectedProject,
  expressInterest,
  pickTeam,
  postIdea,
  removePastProject,
  setIdeaStatus,
  submitPastProject,
  withdrawInterest,
  type IdeaCheck,
} from '@commitmates/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { withAction, type ActionResult } from '@/server/action';
import { requireUser, requireVerified } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};
const list = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

type FormAction = (previous: ActionResult<null> | null, formData: FormData) => Promise<ActionResult<null>>;

/** What the author sees before posting: keyphrases and the closest past projects (CLAUDE.md §8 F22 "Ideas"). */
export async function checkIdeaAction(input: {
  title: string;
  description: string;
}): Promise<ActionResult<IdeaCheck>> {
  return withAction('fyp.check', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    return checkIdea(member, input);
  })();
}

/** Posts an idea and opens it. */
export async function postIdeaAction(input: {
  title: string;
  description: string;
  supervisorIdea: boolean;
}): Promise<ActionResult<null>> {
  return withAction('fyp.post', async (): Promise<null> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    const id = await postIdea(member, input);
    revalidatePath('/fyp');
    redirect(`/fyp/ideas/${id}`);
  })();
}

/** Runs one FYP Board form action and refreshes the board and the idea. */
function boardAction(
  name: string,
  run: (member: Awaited<ReturnType<typeof requireVerified>>, formData: FormData) => Promise<unknown>,
): FormAction {
  return async (_previous, formData) =>
    withAction(`fyp.${name}`, async () => {
      const member = await requireVerified();
      await guardWriteRate(member.id);
      await run(member, formData);
      revalidatePath('/fyp');
      const ideaId = field(formData, 'ideaId');
      if (ideaId !== '') revalidatePath(`/fyp/ideas/${ideaId}`);
      revalidatePath('/settings/projects');
      return null;
    })();
}

export const applySupervisorAction: FormAction = boardAction('supervisor.apply', (member, formData) =>
  applySupervisor(member, { areas: list(field(formData, 'areas')) }),
);
export const expressInterestAction: FormAction = boardAction('interest', (member, formData) =>
  expressInterest(member, { ideaId: field(formData, 'ideaId'), message: field(formData, 'message') }),
);
export const withdrawInterestAction: FormAction = boardAction('interest.withdraw', (member, formData) =>
  withdrawInterest(member, { ideaId: field(formData, 'ideaId') }),
);
export const setIdeaStatusAction: FormAction = boardAction('status', (member, formData) =>
  setIdeaStatus(member, { ideaId: field(formData, 'ideaId'), status: field(formData, 'status') }),
);
export const submitPastProjectAction: FormAction = boardAction('project.submit', (member, formData) =>
  submitPastProject(member, { repoGithubId: field(formData, 'repoGithubId'), year: field(formData, 'year') }),
);
export const confirmDetectedProjectAction: FormAction = boardAction('project.confirm', (member, formData) =>
  confirmDetectedProject(member, { projectId: field(formData, 'projectId'), year: field(formData, 'year') }),
);
export const dismissDetectedProjectAction: FormAction = boardAction('project.dismiss', (member, formData) =>
  dismissDetectedProject(member, { projectId: field(formData, 'projectId') }),
);
export const removePastProjectAction: FormAction = boardAction('project.remove', (member, formData) =>
  removePastProject(member, { projectId: field(formData, 'projectId') }),
);

/** The author picks teammates among the interested and opens the team conversation. */
export const pickTeamAction: FormAction = async (_previous, formData) =>
  withAction('fyp.team', async (): Promise<null> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    const ideaId = field(formData, 'ideaId');
    const userIds = formData.getAll('userId').filter((value): value is string => typeof value === 'string');
    const threadId = await pickTeam(member, { ideaId, userIds });
    revalidatePath(`/fyp/ideas/${ideaId}`);
    revalidatePath('/inbox');
    redirect(`/inbox/${threadId}`);
  })();

/** An admin, or a moderator of that university, approves or turns down a supervisor application. */
export const decideSupervisorAction: FormAction = async (_previous, formData) =>
  withAction('fyp.supervisor.decide', async () => {
    const member = await requireUser();
    await decideSupervisor(member, {
      userId: field(formData, 'userId'),
      universityId: field(formData, 'universityId'),
      approve: field(formData, 'approve') === 'true',
    });
    revalidatePath('/admin/moderation');
    return null;
  })();
