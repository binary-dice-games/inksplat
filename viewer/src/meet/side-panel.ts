// MIT License © 2026 Binary Dice Games
/**
 * @file Side panel of the Meet add-on: starts inksplat for everybody in the call and shows how
 * the session is going (spec/08_meet_addon/DESIGN.md section 3).
 */
import { MeetError, meetProblem, openAddonSession } from './meet-sdk';
import { activityRunning, startActivity } from './meet-boot';

async function main(): Promise<void> {
  const start = document.getElementById('start') as HTMLButtonElement;
  const status = document.getElementById('status') as HTMLElement;
  try {
    const session = await openAddonSession();
    const client = await session.createSidePanelClient();
    client.frameToFrameMessage = (raw) => {
      try {
        const m = JSON.parse(raw) as { t?: string; status?: string };
        if (m.t === 'status' && typeof m.status === 'string') {
          status.textContent = m.status.slice(0, 200);
        }
      } catch {
        // not ours
      }
    };
    if (await activityRunning(client)) {
      status.textContent = 'inksplat is running in this call.';
      return;
    }
    start.hidden = false;
    start.addEventListener('click', () => {
      start.disabled = true;
      status.textContent = 'Starting…';
      startActivity(client, new URL('meet-stage.html', location.href).toString()).then(
        () => (status.textContent = 'inksplat started.'),
        (e: unknown) => {
          start.disabled = false;
          status.textContent = e instanceof MeetError ? e.message : 'Could not start inksplat.';
        },
      );
    });
  } catch (e) {
    status.textContent = meetProblem(e);
  }
}

void main();
