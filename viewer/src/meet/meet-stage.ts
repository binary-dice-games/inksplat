// MIT License © 2026 Binary Dice Games
/**
 * @file Main stage entry of the Meet add-on: every participant's main stage loads this page,
 * which finds out whether this tab started the activity and moves on to the host page or the
 * guest page (spec/08_meet_addon/DESIGN.md section 3).
 */
import { meetProblem } from './meet-sdk';
import { planMainStage } from './meet-boot';

async function main(): Promise<void> {
  const text = document.getElementById('text') as HTMLElement;
  try {
    const plan = await planMainStage();
    location.replace(
      `${plan.role === 'host' ? 'meet-host.html' : 'meet-guest.html'}${location.search}`,
    );
  } catch (e) {
    text.textContent = meetProblem(e);
  }
}

void main();
