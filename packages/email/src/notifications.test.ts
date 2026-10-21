import { describe, expect, it } from 'vitest';

import { MUTABLE_NOTIFICATIONS, describeNotification } from './notifications';

describe('notification words', () => {
  it('describes each kind from its stored data, with a place to act', () => {
    expect(describeNotification('chat_request', { login: 'sam' })).toEqual({
      title: 'New message request',
      line: '@sam sent you a message request.',
      path: '/inbox',
    });
    expect(describeNotification('chat_request_accepted', { login: 'kim', threadId: '9b2e8f9e-3c1a-4d6b-9f0e-1a2b3c4d5e6f' })?.path).toBe(
      '/inbox/9b2e8f9e-3c1a-4d6b-9f0e-1a2b3c4d5e6f',
    );
    expect(describeNotification('university_request_approved', { domain: 'uni.edu', universityName: 'Uni' })?.line).toBe(
      'Your request for uni.edu was approved as Uni.',
    );
    expect(describeNotification('moderation_warning', { note: 'Be kind.' })?.line).toBe('A moderator sent you a warning: Be kind.');
  });

  it('never puts anything but a thread id into a link, and reads missing data as empty', () => {
    expect(describeNotification('chat_request_accepted', { threadId: '../admin' })?.path).toBe('/inbox');
    expect(describeNotification('chat_request', null)?.line).toBe('You have a new message request.');
    expect(describeNotification('something_new', {})).toBeNull();
  });

  it('lets members mute only social kinds, not account notices', () => {
    expect(Object.keys(MUTABLE_NOTIFICATIONS)).toEqual([
      'chat_request',
      'chat_request_accepted',
      'pair_invite',
      'pair_accepted',
      'pair_ended',
      'pair_paused',
      'adoption_revived',
      'adoption_dropped',
    ]);
    expect(Object.keys(MUTABLE_NOTIFICATIONS)).not.toContain('account_hidden');
    expect(Object.keys(MUTABLE_NOTIFICATIONS)).not.toContain('github_reconnect');
    expect(describeNotification('pair_paused', { login: 'sam' })?.path).toBe('/streaks');
  });

  it('words a revival and an ended adoption for the adopter and the owner', () => {
    expect(describeNotification('adoption_revived', { role: 'owner', repo: 'sam/app', fork: 'kim/app' })?.line).toBe(
      'sam/app is being worked on again in kim/app. You both earned the Revived badge.',
    );
    expect(describeNotification('adoption_revived', { role: 'adopter', repo: 'sam/app' })?.line).toBe('Your work brought sam/app back to life. You earned the Revived badge.');
    expect(describeNotification('adoption_dropped', { role: 'owner', repo: 'sam/app' })).toMatchObject({
      line: 'The adoption of sam/app ended without new commits. You can put it up for adoption again.',
      path: '/settings/projects',
    });
    expect(describeNotification('adoption_dropped', {})?.line).toBe('Your adoption of a project ended because its fork had no new commits for a while.');
  });
});
