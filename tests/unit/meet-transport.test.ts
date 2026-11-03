// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { meetTransport } from '../../viewer/src/meet/meet-transport';
import { fakeSession } from '../support/fake-meet';
import { settle, until } from '../support/wait';

let n = 0;
const hub = (): string => `transport-${process.pid}-${n++}`;

describe('the Meet transport', () => {
  it('delivers text to the others, not to the sender', async () => {
    const h = hub();
    const a = meetTransport(await fakeSession(h));
    const b = meetTransport(await fakeSession(h));
    const heardA: string[] = [];
    const heardB: string[] = [];
    a.subscribe((t) => heardA.push(t));
    b.subscribe((t) => heardB.push(t));
    await a.send('hello ✓');
    await until(() => heardB.length === 1, 'b hears a');
    expect(heardB).toEqual(['hello ✓']);
    await settle();
    expect(heardA).toEqual([]);
  });

  it('stops delivering after unsubscribe', async () => {
    const h = hub();
    const a = meetTransport(await fakeSession(h));
    const b = meetTransport(await fakeSession(h));
    const heard: string[] = [];
    const off = b.subscribe((t) => heard.push(t));
    await a.send('one');
    await until(() => heard.length === 1, 'first');
    off();
    await a.send('two');
    await settle(80);
    expect(heard).toEqual(['one']);
  });

  it('tolerates an echo of its own broadcast', async () => {
    const a = meetTransport(await fakeSession(hub(), { echo: true }));
    const heard: string[] = [];
    a.subscribe((t) => heard.push(t));
    await a.send('x');
    expect(heard).toEqual(['x']);
  });

  it('rejects when the call channel fails', async () => {
    const fail = { value: true };
    const a = meetTransport(await fakeSession(hub(), { fail }));
    await expect(a.send('x')).rejects.toThrow(/unavailable/);
    fail.value = false;
    await expect(a.send('x')).resolves.toBeUndefined();
  });

  it('reports the size limit it was given', async () => {
    expect(meetTransport(await fakeSession(hub()), 1000).maxBytes).toBe(1000);
    expect(meetTransport(await fakeSession(hub())).maxBytes).toBeUndefined();
  });
});
