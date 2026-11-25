// MIT License © 2026 Binary Dice Games
/**
 * @file The summary logged when ICE fails: candidate counts from the SDPs and the likely cause.
 */
import { describe, expect, it } from 'vitest';
import { describeIceFailure, iceCandidateTypes } from '@inksplat/collab-session';

const candidate = (type: string, address = '192.0.2.1'): string =>
  `a=candidate:1 1 udp 2122260223 ${address} 50000 typ ${type} generation 0`;
const sdp = (...lines: string[]): string =>
  ['v=0', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', ...lines, ''].join('\r\n');

describe('iceCandidateTypes', () => {
  it('counts the candidates of each type, and the mDNS host ones', () => {
    const offer = sdp(
      candidate('host', '0f3c1a2b-1111-2222-3333-444455556666.local'),
      candidate('host'),
      candidate('srflx', '203.0.113.7'),
      'a=candidate:2 1 tcp 1518280447 192.0.2.1 9 typ host tcptype active generation 0',
      candidate('relay', '198.51.100.9'),
    );
    expect(iceCandidateTypes(offer)).toEqual({ host: 3, mdns: 1, srflx: 1, prflx: 0, relay: 1 });
  });

  it('gives zeros for no SDP', () => {
    expect(iceCandidateTypes(undefined)).toEqual({
      host: 0,
      mdns: 0,
      srflx: 0,
      prflx: 0,
      relay: 0,
    });
  });
});

describe('describeIceFailure', () => {
  const both = sdp(candidate('host'), candidate('srflx', '203.0.113.7'));

  it('blames blocked STUN when this side has only host candidates', () => {
    const line = describeIceFailure(sdp(candidate('host')), both);
    expect(line).toContain('local candidates: host 1, srflx 0, relay 0');
    expect(line).toContain('remote candidates: host 1, srflx 1, relay 0');
    expect(line).toContain('STUN is blocked here');
  });

  it('blames a browser policy when this side has no candidates', () => {
    expect(describeIceFailure(sdp(), both)).toContain('WebRtcIPHandling');
  });

  it('blames the other side when only it lacks a public address', () => {
    expect(describeIceFailure(both, sdp(candidate('host')))).toContain(
      'the other side got no public address',
    );
  });

  it('blames the path when both have public addresses, and TURN when a relay failed too', () => {
    expect(describeIceFailure(both, both)).toContain('no path between them worked');
    const relayed = sdp(candidate('relay', '198.51.100.9'));
    expect(describeIceFailure(relayed, both)).toContain('not even the TURN relay worked');
  });

  it('carries no addresses', () => {
    expect(describeIceFailure(both, both)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});
