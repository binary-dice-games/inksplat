// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { FrameRouter, sdpCodecs } from '@inksplat/collab-session';

// The host's relay of encoded frames (spec/07_participant_streaming/DESIGN.md section 4.2),
// with fake frames and a fake clock.

interface Fake {
  type: 'key' | 'delta';
  ts: number;
  from: string;
  getMetadata(): { rtpTimestamp: number };
}

const frame = (from: string, type: 'key' | 'delta', ts: number): Fake => ({
  type,
  ts,
  from,
  getMetadata: () => ({ rtpTimestamp: ts }),
});

function setup() {
  const asked: string[] = [];
  const timers: (() => void)[] = [];
  const router = new FrameRouter<Fake>({
    requestKeyFrame: (s) => asked.push(s),
    copy: (f, rtpTimestamp) => ({ from: f.from, type: f.type, rtpTimestamp }),
    retryMs: 500,
    maxTries: 3,
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => {},
  });
  const got: Record<string, { from: string; type: string; rtpTimestamp: number }[]> = {};
  const output = (id: string) => {
    got[id] = [];
    router.addOutput(id, id, (f) => got[id]!.push(f as never));
  };
  /** Fires the pending retry timer. */
  const tick = () => timers.shift()?.();
  return { router, asked, got, output, tick, timers };
}

describe('the frame router', () => {
  it('forwards the source to every output but its own, from a key frame on', () => {
    const { router, got, output } = setup();
    for (const id of ['ana', 'bob', 'cy']) output(id);
    router.setSource('ana');
    router.input('ana', frame('ana', 'delta', 100)); // no key frame yet: dropped
    router.input('bob', frame('bob', 'key', 5)); // not the source
    router.input('ana', frame('ana', 'key', 200));
    router.input('ana', frame('ana', 'delta', 300));
    expect(got.ana).toEqual([]);
    expect(got.bob!.map((f) => [f.type, f.rtpTimestamp])).toEqual([
      ['key', 200],
      ['delta', 300],
    ]);
    expect(got.cy).toHaveLength(2);
  });

  it('keeps each output on continuous timestamps across a switch', () => {
    const { router, got, output } = setup();
    output('cy');
    router.setSource('ana');
    router.input('ana', frame('ana', 'key', 1_000_000));
    router.input('ana', frame('ana', 'delta', 1_003_000));
    router.setSource('bob');
    router.input('ana', frame('ana', 'delta', 1_006_000)); // the old source: dropped
    router.input('bob', frame('bob', 'delta', 50)); // waits for a key frame of bob
    router.input('bob', frame('bob', 'key', 90));
    router.input('bob', frame('bob', 'delta', 3090));
    expect(got.cy!.map((f) => f.rtpTimestamp)).toEqual([
      1_000_000, 1_003_000, 1_006_000, 1_009_000,
    ]);
  });

  it('wraps timestamps at 32 bits', () => {
    const { router, got, output } = setup();
    output('cy');
    router.setSource('ana');
    router.input('ana', frame('ana', 'key', 2 ** 32 - 1000));
    router.setSource('bob');
    router.input('bob', frame('bob', 'key', 7));
    expect(got.cy!.map((f) => f.rtpTimestamp)).toEqual([2 ** 32 - 1000, 2000]);
  });

  it("forwards the host's own frames only to their own output, while the host is the source", () => {
    const { router, got, output } = setup();
    output('bob');
    output('cy');
    router.own('bob', 'host', frame('host', 'key', 10)); // no source yet
    router.setSource('host');
    router.own('bob', 'host', frame('host', 'key', 20));
    router.own('cy', 'host', frame('host', 'delta', 21));
    expect(got.bob!.map((f) => f.rtpTimestamp)).toEqual([20]);
    expect(got.cy).toEqual([]); // waits for its key frame
  });

  it('asks the source for key frames, coalesced, again while an output waits, and gives up', () => {
    const { router, asked, output, tick, timers } = setup();
    router.setSource('ana');
    expect(asked).toEqual(['ana']);
    tick(); // nobody waits: no retry
    expect(asked).toEqual(['ana']);
    output('bob'); // a new viewer waits
    output('cy'); // within the wait: coalesced
    expect(asked).toEqual(['ana', 'ana']);
    tick(); // still waiting: asks again
    tick();
    tick();
    tick(); // the last try
    expect(asked.length).toBe(5);
    tick();
    expect(timers).toHaveLength(0);
    expect(asked.length).toBe(5);
    router.keyFrameWanted(); // a viewer lost frames: tries again
    expect(asked.length).toBe(6);
  });

  it('stops waiting for an output once it has its key frame, and forgets removed outputs', () => {
    const { router, asked, got, output, tick } = setup();
    output('bob');
    router.setSource('ana');
    router.input('ana', frame('ana', 'key', 1));
    tick();
    expect(asked).toEqual(['ana']);
    expect(router.waiting()).toBe(false);
    router.removeOutput('bob');
    router.input('ana', frame('ana', 'delta', 2));
    expect(got.bob).toHaveLength(1);
  });

  it('sends nothing to an output before its peer is known, and nothing with no source', () => {
    const { router, asked } = setup();
    const out: unknown[] = [];
    router.addOutput('k', null, (f) => out.push(f));
    router.setSource(null);
    router.input('ana', frame('ana', 'key', 1));
    router.setSource('ana');
    router.input('ana', frame('ana', 'key', 2));
    expect(out).toEqual([]);
    router.setOutputId('k', 'bob');
    router.input('ana', frame('ana', 'key', 3));
    expect(out).toHaveLength(1);
    expect(asked).toEqual(['ana']);
  });

  it('forwards only to outputs on the source codec; the others take their own encoder', () => {
    const asked: string[] = [];
    const ownAsked: unknown[] = [];
    const timers: (() => void)[] = [];
    const codecs: Record<string, string> = { ana: 'video/AV1', bob: 'video/H264' };
    const router = new FrameRouter<Fake>({
      requestKeyFrame: (s) => asked.push(s),
      requestOutputKeyFrame: (key) => ownAsked.push(key),
      codecOf: (s) => codecs[s],
      copy: (f, rtpTimestamp) => ({ from: f.from, type: f.type, rtpTimestamp }),
      setTimer: (fn) => timers.push(fn),
      clearTimer: () => {},
    });
    const got: Record<string, string[]> = { cy: [], dan: [] };
    router.addOutput('cy', 'cy', (f) => got.cy!.push((f as Fake).from), 'video/AV1');
    router.addOutput('dan', 'dan', (f) => got.dan!.push((f as Fake).from), 'video/vp8');
    router.setSource('ana');
    expect(router.reencodes('cy')).toBe(false);
    expect(router.reencodes('dan')).toBe(true);
    expect(asked).toEqual(['ana']);
    expect(ownAsked).toEqual(['dan']); // dan's own encoder starts on a key frame
    router.input('ana', frame('ana', 'key', 1));
    router.own('dan', 'host', frame('host-for-dan', 'key', 7));
    router.own('cy', 'host', frame('host-for-cy', 'key', 7)); // cy forwards: own frames dropped
    expect(got).toEqual({ cy: ['ana'], dan: ['host-for-dan'] });
    // Back to the host's own stream: everybody takes their own encoder.
    router.setSource('host');
    expect(router.reencodes('dan')).toBe(false);
    router.own('cy', 'host', frame('host-for-cy', 'key', 8));
    expect(got.cy).toEqual(['ana', 'host-for-cy']);
  });

  it('treats an unknown codec as a match', () => {
    const router = new FrameRouter<Fake>({ requestKeyFrame: () => {}, copy: (f) => f });
    router.addOutput('cy', 'cy', () => {});
    router.addOutput('dan', 'dan', () => {}, 'video/VP8');
    router.setSource('ana'); // no codecOf: unknown
    expect(router.reencodes('cy')).toBe(false);
    expect(router.reencodes('dan')).toBe(false);
  });
});

describe('sdpCodecs', () => {
  const sdp = [
    'v=0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'a=mid:0',
    'm=video 9 UDP/TLS/RTP/SAVPF 96 97 45 102',
    'a=rtpmap:96 VP8/90000',
    'a=mid:1',
    'a=rtpmap:97 rtx/90000',
    'a=rtpmap:45 AV1/90000',
    'm=video 9 UDP/TLS/RTP/SAVPF 102',
    'a=mid:2',
    'a=rtpmap:102 H264/90000',
    '',
  ].join('\r\n');

  it('lists the codecs of one media section, wherever its mid line is', () => {
    expect(sdpCodecs(sdp, '1')).toEqual(['video/vp8', 'video/rtx', 'video/av1']);
    expect(sdpCodecs(sdp, '2')).toEqual(['video/h264']);
  });

  it('returns nothing for an unknown section or no description', () => {
    expect(sdpCodecs(sdp, '7')).toEqual([]);
    expect(sdpCodecs(undefined, '1')).toEqual([]);
  });
});
