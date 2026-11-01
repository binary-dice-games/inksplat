// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { cleanPrefs } from '../../viewer/src/present-settings';

describe('cleanPrefs', () => {
  it('defaults everything for nothing or junk', () => {
    for (const input of [undefined, null, 'x', 42, []]) {
      expect(cleanPrefs(input)).toMatchObject({
        cursor: 'always',
        toolsCollapsed: false,
        panelCollapsed: false,
        toolHints: true,
        settings: { name: 'Presenter', viewersMayDraw: true },
      });
    }
  });

  it('keeps valid values and clamps video limits', () => {
    const prefs = cleanPrefs({
      cursor: 'never',
      toolsCollapsed: true,
      panelCollapsed: true,
      settings: { name: 'Pat', video: { fps: 99, bitrateKbps: 1 } },
    });
    expect(prefs.cursor).toBe('never');
    expect(prefs.toolsCollapsed).toBe(true);
    expect(prefs.panelCollapsed).toBe(true);
    expect(prefs.settings.name).toBe('Pat');
    expect(prefs.settings.video.fps).toBe(15);
    expect(prefs.settings.video.bitrateKbps).toBe(100);
  });

  it('accepts the motion pointer mode and rejects unknown ones', () => {
    expect(cleanPrefs({ cursor: 'motion' }).cursor).toBe('motion');
    expect(cleanPrefs({ cursor: 'sometimes' }).cursor).toBe('always');
    expect(cleanPrefs({ toolsCollapsed: 'yes' }).toolsCollapsed).toBe(false);
    expect(cleanPrefs({ toolHints: false }).toolHints).toBe(false);
    expect(cleanPrefs({ toolHints: 'no' }).toolHints).toBe(true);
  });
});
