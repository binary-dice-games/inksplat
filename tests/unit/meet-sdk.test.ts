// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { afterEach, describe, expect, it } from 'vitest';
import {
  MeetError,
  cloudProject,
  insideMeet,
  meetProblem,
  openAddonSession,
} from '../../viewer/src/meet/meet-sdk';
import { meetMode } from '../../viewer/src/meet/meet-page';
import { fakeMeet } from '../support/fake-meet';

afterEach(() => {
  delete (globalThis as { meet?: unknown }).meet;
  document.head.innerHTML = '';
});

const project = (n: string): void => {
  document.head.innerHTML = `<meta name="inksplat-meet-project" content="${n}">`;
};

describe('the Meet SDK facade', () => {
  it('knows when it is inside Meet', () => {
    expect(insideMeet('?meet_sdk=abc')).toBe(true);
    expect(insideMeet('')).toBe(false);
  });

  it('reads the cloud project number of the build', () => {
    project('123456');
    expect(cloudProject()).toBe('123456');
    project('abc');
    expect(() => cloudProject()).toThrow(MeetError);
    document.head.innerHTML = '';
    expect(() => cloudProject()).toThrow(/project number/);
  });

  it('refuses to start outside Meet, without loading anything', async () => {
    project('1');
    await expect(openAddonSession()).rejects.toMatchObject({ reason: 'not-in-meet' });
    expect(document.querySelector('script')).toBeNull();
  });

  it('starts a session on an SDK that is there already', async () => {
    project('1');
    (globalThis as { meet?: unknown }).meet = fakeMeet('sdk-ok');
    const session = await openAddonSession();
    expect(typeof session.createCoDoingClient).toBe('function');
  });

  it('turns SDK failures into MeetError', async () => {
    (globalThis as { meet?: unknown }).meet = fakeMeet('sdk-no-project');
    await expect(openAddonSession()).rejects.toMatchObject({ reason: 'no-project' });
    project('1');
    (globalThis as { meet?: unknown }).meet = {
      addon: {
        createAddonSession: async () => {
          throw new Error('denied');
        },
      },
    };
    await expect(openAddonSession()).rejects.toMatchObject({ reason: 'sdk-unavailable' });
  });

  it('explains problems to the person', () => {
    expect(meetProblem(new MeetError('not-in-meet', 'x'))).toMatch(/Google Meet/);
    expect(meetProblem(new MeetError('bad-state', 'Not started.'))).toBe('Not started.');
    expect(meetProblem(new Error('boom'))).toMatch(/could not start/);
  });

  it('marks the Meet variants of the pages', () => {
    expect(meetMode()).toBe(false);
    document.head.innerHTML = '<meta name="inksplat-meet" content="1">';
    expect(meetMode()).toBe(true);
  });
});
