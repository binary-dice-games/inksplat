// MIT License © 2026 Binary Dice Games
/**
 * @file The presenter's codec order: codecs this machine encodes in hardware first, so its own
 * stream (one shared encoder, see spec/07_participant_streaming/DESIGN.md section 4.5) costs as
 * little CPU as it can.
 */

/** Whether this machine encodes `codec` (a MIME type) for WebRTC in hardware. */
export type EfficiencyProbe = (codec: string) => Promise<boolean>;

/**
 * Asks `navigator.mediaCapabilities` (`powerEfficient` of a WebRTC encoding at 1080p, 3 fps,
 * 1.5 Mbit/s). False where the browser cannot tell.
 */
export const browserProbe: EfficiencyProbe = async (codec) => {
  const caps = (navigator as Navigator & { mediaCapabilities?: MediaCapabilities })
    .mediaCapabilities;
  if (typeof caps?.encodingInfo !== 'function') {
    return false;
  }
  const info = await caps.encodingInfo({
    type: 'webrtc',
    video: { contentType: codec, width: 1920, height: 1080, bitrate: 1_500_000, framerate: 3 },
  } as MediaEncodingConfiguration);
  return info.supported && info.powerEfficient;
};

/**
 * `codecs` with the ones `probe` says are encoded in hardware first, each group in its own
 * order. A probe that fails or takes longer than `timeoutMs` counts as no.
 */
export async function hardwareFirst(
  codecs: readonly string[],
  probe: EfficiencyProbe = browserProbe,
  timeoutMs = 1000,
): Promise<string[]> {
  const ask = async (codec: string): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      return await Promise.race([probe(codec).catch(() => false), late]);
    } finally {
      clearTimeout(timer);
    }
  };
  const fast = await Promise.all(codecs.map(ask));
  return [...codecs.filter((_, i) => fast[i]), ...codecs.filter((_, i) => !fast[i])];
}
