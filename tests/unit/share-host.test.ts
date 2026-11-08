// MIT License © 2026 Binary Dice Games
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryNetwork, createSession } from '@inksplat/collab-session';
import type { Session } from '@inksplat/collab-session';
import { WhiteboardModel } from '@inksplat/collab-whiteboard';
import { PROTOCOL, SUPPORT_VIDEO, cleanStage, safetyCode } from '@inksplat/defaults';
import type { Stage } from '@inksplat/defaults';
import { ShareHost } from '../../viewer/src/share-host';
import { DEFAULT_SETTINGS } from '../../viewer/src/settings';
import type { Settings } from '../../viewer/src/settings';
import { settle, until } from '../support/wait';

const stroke = { kind: 'ink', points: [0, 0, 20, 20], color: '#e5484d', width: 3 };

describe('ShareHost', () => {
  const network = createMemoryNetwork();
  const opened: { stop(): void }[] = [];
  const guests: Session[] = [];

  afterEach(() => {
    opened.splice(0).forEach((h) => h.stop());
    guests.splice(0).forEach((g) => g.close());
  });

  async function start(
    settings: Partial<Settings> = {},
    clearBoard?: () => void,
  ): Promise<ShareHost> {
    const host = await ShareHost.start({
      settings: { ...DEFAULT_SETTINGS, name: 'Pat', ...settings },
      clearBoard,
      rendezvous: [{ kind: 'memory', network }],
    });
    opened.push(host);
    return host;
  }

  async function join(host: ShareHost, name: string): Promise<{ guest: Session; stages: Stage[] }> {
    const guest = await createSession({
      role: 'guest',
      token: host.session.token,
      protocol: PROTOCOL,
      me: { name, color: '#e5484d' },
      rendezvous: [{ kind: 'memory', network }],
    });
    guests.push(guest);
    const stages: Stage[] = [];
    guest.channel('stage').on('message', (m) => {
      const stage = cleanStage(m);
      if (stage) stages.push(stage);
    });
    await until(() => guest.host(), 'guest reached the host');
    return { guest, stages };
  }

  /** What the host's own app receives on the whiteboard channel (what the gate let through). */
  function wbInbox(host: ShareHost): unknown[] {
    const inbox: unknown[] = [];
    host.session.channel('wb').on('message', (m) => inbox.push(m));
    return inbox;
  }

  it('builds the link from the viewer base and the session token', async () => {
    const host = await start({ viewerBase: 'https://example.github.io/inksplat/' });
    expect(host.link()).toBe(`https://example.github.io/inksplat/#inksplat=${host.session.token}`);
    expect(host.ui()).toMatchObject({ phase: 'live', viewers: [], drawing: true });
  });

  it('carries custom trackers in the link, and no presenter key', async () => {
    const host = await start({ trackers: ['ws://127.0.0.1:9'] });
    expect(host.link()).toContain('tr=ws');
    expect(host.link()).not.toContain('presenter');
  });

  it('tells a viewer the stage when it joins', async () => {
    const host = await start({ viewersMayDraw: false });
    const inbox = wbInbox(host);
    const { guest, stages } = await join(host, 'Ana');
    await until(() => stages.length > 0, 'stage');
    expect(stages[0]?.drawing).toBe(false);

    const model = new WhiteboardModel(guest.me.id);
    guest.channel('wb').send({ t: 'op', op: model.add(stroke) });
    await settle();
    expect(inbox).toEqual([]);

    await host.command({ cmd: 'drawing', on: true });
    await until(() => stages.at(-1)?.drawing === true, 'drawing on');
    guest.channel('wb').send({ t: 'op', op: model.add(stroke) });
    await until(() => inbox.length === 1, 'stroke accepted');
  });

  it('does not let a viewer speak on the stage channel or any other host channel', async () => {
    const host = await start();
    const a = await join(host, 'Ana');
    const b = await join(host, 'Ben');
    await until(() => b.stages.length > 0, 'stage');
    const before = b.stages.length;
    const other: unknown[] = [];
    b.guest.channel('chat').on('message', (m) => other.push(m));
    a.guest
      .channel('stage')
      .send({ aspect: 1, w: 1, h: 1, fps: 1, state: 'ended', drawing: false });
    a.guest.channel('chat').send('hi');
    await settle(100);
    expect(b.stages.length).toBe(before);
    expect(other).toEqual([]);
  });

  it('ignores the old presenter channel: nobody can command the host', async () => {
    const host = await start();
    const { guest } = await join(host, 'Ana');
    const to = guest.host()!.id;
    guest.channel('ctl').send({ t: 'cmd', command: { cmd: 'lock', on: true } }, { to });
    guest.channel('ctl').send({ t: 'cmd', command: { cmd: 'end' } }, { to });
    guest.channel('ctl').send('hello', { to });
    await settle(80);
    expect(host.ui().locked).toBe(false);
    expect(host.ui().phase).toBe('live');
    expect(host.ui().viewers).toHaveLength(1);
  });

  it('removes a viewer and locks the room', async () => {
    const host = await start();
    const { guest } = await join(host, 'Ana');
    await until(() => host.ui().viewers.length === 1, 'viewer');
    await host.command({ cmd: 'lock', on: true });
    expect(host.ui().locked).toBe(true);
    await host.command({ cmd: 'remove', id: guest.me.id });
    await until(() => host.ui().viewers.length === 0, 'viewer removed');
  });

  it('shows the screen on canvas 1 and lets the presenter pick each canvas background', async () => {
    const host = await start();
    const { stages } = await join(host, 'Ana');
    await until(() => stages.length > 0, 'stage');
    expect(stages[0]?.backgrounds).toEqual(['screen', 'whiteboard', 'blackboard', 'wall', 'cork']);
    expect(stages[0]).toMatchObject({ aspect: 16 / 9, w: 1280, h: 720, state: 'live' });
    expect(stages[0]).not.toHaveProperty('screen'); // nothing shared yet: black

    await host.command({ cmd: 'background', page: 0, name: 'wall' });
    await host.command({ cmd: 'background', page: 3, name: 'screen' });
    await until(() => stages.at(-1)?.backgrounds?.[3] === 'screen', 'backgrounds changed');
    expect(host.ui().backgrounds).toEqual(['wall', 'whiteboard', 'blackboard', 'screen', 'cork']);
    await host.command({ cmd: 'background', page: 1, name: 'video' }); // the old name
    expect(host.ui().backgrounds[1]).toBe('screen');
    await expect(host.command({ cmd: 'background', page: 0, name: 'lava' })).rejects.toThrow(
      /background/,
    );
    await expect(host.command({ cmd: 'background', page: 5, name: 'wall' })).rejects.toThrow(
      /canvas/,
    );
  });

  it('issues a new link without dropping the people already there', async () => {
    const host = await start();
    await join(host, 'Ana');
    const before = host.link();
    await host.command({ cmd: 'newLink' });
    expect(host.link()).not.toBe(before);
    expect(host.ui().viewers).toHaveLength(1);
  });

  /** Records what the host asks of the guests' uplinks and what it relays. */
  function spy(host: ShareHost) {
    const asked: [string, boolean][] = [];
    const relays: (string | null)[] = [];
    const s = host.session;
    const uplinkParams = s.uplinkParams.bind(s);
    const setRelay = s.setRelay.bind(s);
    s.uplinkParams = (id, p) => {
      asked.push([id, p.active]);
      uplinkParams(id, p);
    };
    s.setRelay = (id) => {
      relays.push(id);
      setRelay(id);
    };
    return { asked, relays };
  }

  const offer = { cmd: 'offer', surface: 'window', w: 640, h: 360 };

  it('lists the streams guests offer, sends nothing up until previewed or shown', async () => {
    const host = await start();
    const { asked, relays } = spy(host);
    const a = await join(host, 'Ana');
    const b = await join(host, 'Ben');
    const to = a.guest.host()!.id;
    a.guest.channel('screen').send(offer, { to });
    await until(() => host.ui().streams.length === 1, 'offer listed');
    expect(host.ui().streams[0]).toMatchObject({
      id: a.guest.me.id,
      name: 'Ana',
      surface: 'window',
      w: 640,
      h: 360,
      own: false,
    });
    expect(host.ui().active).toBeNull(); // a guest's stream never shows by itself
    expect(asked).toEqual([[a.guest.me.id, false]]);

    await host.command({ cmd: 'preview', id: a.guest.me.id });
    expect(asked.at(-1)).toEqual([a.guest.me.id, true]);
    expect(relays.at(-1)).toBeNull(); // only the host sees a preview
    await until(() => a.stages.at(-1)?.preview === a.guest.me.id, 'owner told of the preview');

    await host.command({ cmd: 'show', id: a.guest.me.id });
    expect(relays.at(-1)).toBe(a.guest.me.id);
    expect(host.ui().preview).toBeNull(); // shown: no longer a preview
    await until(() => b.stages.at(-1)?.screen?.owner === a.guest.me.id, 'on screen');
    expect(b.stages.at(-1)?.screen).toEqual({ owner: a.guest.me.id, name: 'Ana', w: 640, h: 360 });

    await host.command({ cmd: 'preview', id: null });
    await host.command({ cmd: 'show', id: null });
    expect(asked.at(-1)).toEqual([a.guest.me.id, false]);
    await until(() => b.stages.at(-1)?.screen === undefined, 'black screen');
    await expect(host.command({ cmd: 'show', id: 'nobody-1' })).rejects.toThrow(/stream/);
  });

  it('takes a stream off the screen when its owner withdraws it, leaves or is removed', async () => {
    const host = await start();
    const { relays } = spy(host);
    const a = await join(host, 'Ana');
    const b = await join(host, 'Ben');
    const to = a.guest.host()!.id;
    a.guest.channel('screen').send(offer, { to });
    b.guest.channel('screen').send(offer, { to });
    await until(() => host.ui().streams.length === 2, 'two offers');
    await host.command({ cmd: 'show', id: a.guest.me.id });
    a.guest.channel('screen').send({ cmd: 'withdraw' }, { to });
    await until(() => host.ui().streams.length === 1, 'withdrawn');
    expect(host.ui().active).toBeNull(); // no fallback to another stream
    expect(relays.at(-1)).toBeNull();

    await host.command({ cmd: 'show', id: b.guest.me.id });
    await host.command({ cmd: 'remove', id: b.guest.me.id });
    await until(() => host.ui().streams.length === 0, 'removed with its owner');
    expect(host.ui().active).toBeNull();
  });

  it('never relays screen messages, and ignores malformed ones', async () => {
    const host = await start();
    const a = await join(host, 'Ana');
    const b = await join(host, 'Ben');
    const seen: unknown[] = [];
    b.guest.channel('screen').on('message', (m) => seen.push(m));
    a.guest.channel('screen').send(offer); // to everybody: the host keeps it
    a.guest.channel('screen').send({ cmd: 'offer', w: 'big' }, { to: a.guest.host()!.id });
    a.guest.channel('screen').send({ cmd: 'show', id: a.guest.me.id }, { to: a.guest.host()!.id });
    await until(() => host.ui().streams.length === 1, 'offer listed');
    await settle(80);
    expect(seen).toEqual([]);
    expect(host.ui().active).toBeNull();
    expect(host.ui().streams).toHaveLength(1);
  });

  it("puts the host's own new stream on the screen when nothing else is there", async () => {
    const host = await start();
    const { relays } = spy(host);
    const a = await join(host, 'Ana');
    const fake = { getVideoTracks: () => [] } as unknown as MediaStream;
    host.setOwnStream(fake, { surface: 'monitor', w: 1920, h: 1080 });
    const me = host.session.me.id;
    expect(host.ui()).toMatchObject({ active: me });
    expect(host.ui().streams[0]).toMatchObject({ id: me, own: true, w: 1920, name: 'Pat' });
    expect(relays.at(-1)).toBe(me);
    expect(host.streamOf(me)).toBe(fake);
    await until(() => a.stages.at(-1)?.screen?.owner === me, 'own stream shown');

    // A guest's stream on the screen stays when the host starts sharing again.
    a.guest.channel('screen').send(offer, { to: me });
    await until(() => host.ui().streams.length === 2, 'offer');
    await host.command({ cmd: 'show', id: a.guest.me.id });
    host.setOwnStream(null);
    const again = { getVideoTracks: () => [] } as unknown as MediaStream;
    host.setOwnStream(again, { surface: 'window', w: 800, h: 600 });
    expect(host.ui().active).toBe(a.guest.me.id);
    // The same stream again only updates its size.
    host.setOwnStream(again, { surface: 'window', w: 900, h: 600 });
    expect(host.ui().streams.find((s) => s.own)?.w).toBe(900);
    host.setOwnStream(null);
    expect(host.ui().streams.map((s) => s.id)).toEqual([a.guest.me.id]);
  });

  it('clears the board through the owner', async () => {
    let cleared = 0;
    const host = await start({}, () => (cleared += 1));
    await host.command({ cmd: 'clear' });
    expect(cleared).toBe(1);
  });

  it('clears only the drawings through the owner', async () => {
    const calls: string[] = [];
    const host = await ShareHost.start({
      settings: { ...DEFAULT_SETTINGS, name: 'Pat' },
      clearBoard: () => calls.push('all'),
      clearDrawings: () => calls.push('drawings'),
      rendezvous: [{ kind: 'memory', network }],
    });
    opened.push(host);
    await host.command({ cmd: 'clearDrawings' });
    expect(calls).toEqual(['drawings']);
    await host.command({ cmd: 'clear' });
    expect(calls).toEqual(['drawings', 'all']);
  });

  it('reports changes to listeners until stopped', async () => {
    const host = await start();
    const seen: number[] = [];
    host.onChange((ui) => seen.push(ui.viewers.length));
    await join(host, 'Ana');
    await until(() => seen.includes(1), 'one viewer');
    host.setProblem('no-tracker');
    expect(host.ui().problem).toBe('no-tracker');
  });

  it('rejects an unknown command', async () => {
    const host = await start();
    await expect(host.command({ cmd: 'format-disk' } as never)).rejects.toThrow(/unknown/);
  });

  it('ends the share: viewers see `ended`, then the room closes', async () => {
    const host = await start();
    const { stages } = await join(host, 'Ana');
    await until(() => stages.length > 0, 'stage');
    host.stop();
    await until(() => stages.at(-1)?.state === 'ended', 'ended');
    expect(host.ui().phase).toBe('idle');
    host.stop(); // idempotent
  });
});

describe('ShareHost in a support session (spec/08_remote_support)', () => {
  const network = createMemoryNetwork();
  const opened: { stop(): void }[] = [];
  const guests: Session[] = [];
  const offer = {
    cmd: 'offer',
    surface: 'monitor',
    w: 1280,
    h: 800,
    client: 'support',
    v: '0.1.0',
  };

  afterEach(() => {
    opened.splice(0).forEach((h) => h.stop());
    guests.splice(0).forEach((g) => g.close());
  });

  async function start(): Promise<ShareHost> {
    const host = await ShareHost.start({
      settings: {
        ...DEFAULT_SETTINGS,
        name: 'Ana',
        viewerBase: 'https://example.github.io/inksplat/',
      },
      rendezvous: [{ kind: 'memory', network }],
      mode: 'support',
    });
    opened.push(host);
    return host;
  }

  async function connect(host: ShareHost, name: string): Promise<Session> {
    const guest = await createSession({
      role: 'guest',
      token: host.session.token,
      protocol: PROTOCOL,
      me: { name, color: '#30a46c' },
      rendezvous: [{ kind: 'memory', network }],
      reconnectMs: 0,
    });
    guests.push(guest);
    return guest;
  }

  async function join(host: ShareHost, name: string): Promise<{ guest: Session; stages: Stage[] }> {
    const guest = await connect(host, name);
    const stages: Stage[] = [];
    guest.channel('stage').on('message', (m) => {
      const stage = cleanStage(m);
      if (stage) stages.push(stage);
    });
    await until(() => guest.host(), 'guest reached the host');
    return { guest, stages };
  }

  function asks(host: ShareHost): unknown[] {
    const asked: unknown[] = [];
    const s = host.session;
    const uplinkParams = s.uplinkParams.bind(s);
    s.uplinkParams = (id, p) => {
      asked.push(p);
      uplinkParams(id, p);
    };
    return asked;
  }

  it('gives the support link and starts waiting, with drawing off', async () => {
    const host = await start();
    expect(host.link()).toBe(
      `https://example.github.io/inksplat/support.html#inksplat=${host.session.token}`,
    );
    expect(host.ui()).toMatchObject({
      mode: 'support',
      drawing: false,
      support: { status: 'waiting', person: null, code: null },
    });
    expect(host.stage()).toMatchObject({ mode: 'support', drawing: false });
  });

  it("shows the person's screen at once, with the display's aspect and the support video", async () => {
    const host = await start();
    const asked = asks(host);
    const { guest, stages } = await join(host, 'Bob');
    await until(() => host.ui().support?.status === 'deciding', 'deciding');
    expect(host.session.locked).toBe(true);
    guest.channel('screen').send(offer, { to: guest.host()!.id });
    await until(() => host.ui().support?.status === 'sharing', 'sharing');
    expect(host.ui().active).toBe(guest.me.id);
    expect(host.ui().support).toMatchObject({ person: { name: 'Bob' }, version: '0.1.0' });
    expect(asked.at(-1)).toMatchObject({
      active: true,
      fps: SUPPORT_VIDEO.fps,
      maxBitrate: SUPPORT_VIDEO.bitrateKbps * 1000,
      contentHint: 'text',
      degradationPreference: 'balanced',
    });
    await until(() => stages.at(-1)?.screen?.owner === guest.me.id, 'stage');
    expect(stages.at(-1)).toMatchObject({ mode: 'support', aspect: 1280 / 800, w: 1280, h: 800 });
  });

  it('lets nobody else in while the person is connected, and lets them back after they leave', async () => {
    const host = await start();
    const bob = await join(host, 'Bob');
    await until(() => host.session.locked, 'locked');
    const intruder = await connect(host, 'Eve');
    await until(() => intruder.state === 'ended', 'refused');
    expect(host.ui().support?.person?.name).toBe('Bob');

    bob.guest.channel('screen').send(offer, { to: bob.guest.host()!.id });
    await until(() => host.ui().support?.status === 'sharing', 'sharing');
    bob.guest.close();
    await until(() => host.ui().support?.status === 'waiting', 'waiting');
    expect(host.ui().support?.left).toBe('Bob');
    expect(host.session.locked).toBe(false);
    expect(host.ui().active).toBeNull();

    await join(host, 'Bob');
    await until(() => host.ui().support?.status === 'deciding', 'back');
    expect(host.ui().support?.left).toBeNull();
  });

  it('removes a second person who got in at the same moment', async () => {
    const host = await start();
    host.session.lock = () => {}; // both joins race past the lock
    const a = await join(host, 'Bob');
    const b = await join(host, 'Eve');
    await until(() => b.guest.state === 'ended', 'second removed');
    expect(a.guest.state).toBe('open');
    expect(host.ui().support?.person?.name).toBe('Bob');
  });

  it("refuses the person's drawing but lets the helper's marks through", async () => {
    const host = await start();
    const inbox: unknown[] = [];
    host.session.channel('wb').on('message', (m) => inbox.push(m));
    const { guest } = await join(host, 'Bob');
    const model = new WhiteboardModel(guest.me.id);
    guest.channel('wb').send({ t: 'op', op: model.add(stroke) });
    guest.channel('wb').send({ t: 'cur', x: 1, y: 2 });
    await until(() => inbox.length > 0, 'cursor');
    await settle(50);
    expect(inbox).toEqual([{ t: 'cur', x: 1, y: 2 }]);
  });

  it('refuses what only an ordinary session has', async () => {
    const host = await start();
    for (const command of [
      { cmd: 'newLink' },
      { cmd: 'drawing', on: true },
      { cmd: 'background', page: 0, name: 'cork' },
      { cmd: 'clear' },
      { cmd: 'show', id: null },
      { cmd: 'lock', on: false },
    ] as const) {
      await expect(host.command(command)).rejects.toThrow(/support/);
    }
    expect(() => host.setOwnStream({} as MediaStream)).toThrow(/support/);
  });

  it('works out the safety code of the link to the person', async () => {
    const host = await start();
    host.session.fingerprints = () => ({ local: 'AA:BB', remote: 'CC:DD' });
    await join(host, 'Bob');
    const code = await safetyCode('CC:DD', 'AA:BB');
    await until(() => host.ui().support?.code === code, 'code');
    expect(code).toMatch(/^\d{3} \d{3}$/);
  });
});
