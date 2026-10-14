import type * as Core from '@commitmates/core';
import { ForbiddenError } from '@commitmates/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above imports, so the mocks they use must be hoisted too.
const { requireRole, toggleSchedule, retryJob, overrideSetting, revalidatePath } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  toggleSchedule: vi.fn(),
  retryJob: vi.fn(),
  overrideSetting: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/server/guards', () => ({ requireRole }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => undefined }));
vi.mock('@commitmates/core', async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  toggleSchedule,
  retryJob,
  overrideSetting,
  getLogger: () => ({ error: vi.fn() }),
}));

const { overrideSettingAction, retryJobAction, toggleScheduleAction } = await import('./admin');

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const JOB_ID = '3d0c1b1e-1111-4111-8111-000000000001';

beforeEach(() => {
  for (const mock of [requireRole, toggleSchedule, retryJob, overrideSetting, revalidatePath]) mock.mockReset();
});

describe('admin actions require the admin role', () => {
  it.each([
    ['toggleScheduleAction', () => toggleScheduleAction(null, form({ name: 'sync-linguist', enabled: 'false' }))],
    ['retryJobAction', () => retryJobAction(null, form({ jobId: JOB_ID }))],
    ['overrideSettingAction', () => overrideSettingAction(null, form({ key: 'gap.maxGaps', value: '5' }))],
  ])('%s refuses a member without the role and does nothing', async (_name, call) => {
    requireRole.mockRejectedValue(new ForbiddenError('auth.forbidden', "You don't have access to that."));
    expect(await call()).toEqual({
      ok: false,
      error: { code: 'auth.forbidden', message: "You don't have access to that." },
    });
    expect(requireRole).toHaveBeenCalledWith('admin');
    expect(toggleSchedule).not.toHaveBeenCalled();
    expect(retryJob).not.toHaveBeenCalled();
    expect(overrideSetting).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('admin actions for an admin', () => {
  beforeEach(() => {
    requireRole.mockResolvedValue({ id: 'admin-1' });
  });

  it('toggles a schedule as the acting admin', async () => {
    expect(await toggleScheduleAction(null, form({ name: 'sync-linguist', enabled: 'true' }))).toEqual({ ok: true, data: null });
    expect(toggleSchedule).toHaveBeenCalledWith('admin-1', 'sync-linguist', true);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/jobs');
  });

  it('retries a job', async () => {
    await retryJobAction(null, form({ jobId: JOB_ID }));
    expect(retryJob).toHaveBeenCalledWith('admin-1', JOB_ID);
  });

  it('rejects a malformed job id before calling the service', async () => {
    const result = await retryJobAction(null, form({ jobId: 'not-a-uuid' }));
    expect(result).toMatchObject({ ok: false, error: { code: 'validation.invalid_input', field: 'jobId' } });
    expect(retryJob).not.toHaveBeenCalled();
  });

  it('passes the raw override text to the service, including an empty value', async () => {
    await overrideSettingAction(null, form({ key: 'gap.maxGaps', value: '5' }));
    await overrideSettingAction(null, form({ key: 'gap.maxGaps', value: '' }));
    expect(overrideSetting.mock.calls).toEqual([
      ['admin-1', 'gap.maxGaps', '5'],
      ['admin-1', 'gap.maxGaps', ''],
    ]);
  });
});
