// MIT License © 2026 Binary Dice Games
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@inksplat/collab-session';
import { TestRoom } from '../support/rooms';

// The host's video limits on a downlink whose sender, like Safari's, has no encodings before
// the answer is set: they must be applied once it is answered, not lost.

interface Encoding {
  maxFramerate?: number;
  maxBitrate?: number;
}
interface Params {
  encodings: Encoding[];
}

/** A sender that refuses encodings until `answer()`, as Safari does. */
class SafariSender {
  answered = false;
  sent: Encoding = {};
  getParameters(): Params {
    return { encodings: this.answered ? [{ ...this.sent }] : [] };
  }
  setParameters(p: Params): Promise<void> {
    if (!this.answered) {
      return Promise.reject(new Error('InvalidModificationError'));
    }
    this.sent = { ...p.encodings[0] };
    return Promise.resolve();
  }
  replaceTrack(): Promise<void> {
    return Promise.resolve();
  }
}

interface Media {
  prepareAnswer(pc: unknown): void;
  answered(pc: unknown): Promise<void>;
}

/** A fake answering RTCPeerConnection with one downlink transceiver. */
function fakePc(sender: SafariSender) {
  return {
    remoteDescription: { sdp: '' },
    getTransceivers: () => [
      { direction: 'recvonly', receiver: { track: { kind: 'video' } }, sender },
    ],
    addEventListener: () => {},
  };
}

describe('video limits', () => {
  const room = new TestRoom();
  afterEach(() => {
    room.close();
    vi.unstubAllGlobals();
  });

  it('applies fps and bitrate to a downlink once answered', async () => {
    vi.stubGlobal('RTCRtpSender', class {}); // no codec capabilities: codecs stay as offered
    const host: Session = await room.start();
    host.mediaParams({ fps: 2, maxBitrate: 500_000 });
    const media = (host as unknown as { media: Media }).media;
    const sender = new SafariSender();
    const pc = fakePc(sender);
    media.prepareAnswer(pc);
    expect(sender.sent).toEqual({});
    sender.answered = true;
    await media.answered(pc);
    expect(sender.sent).toMatchObject({ maxFramerate: 2, maxBitrate: 500_000 });
  });
});
