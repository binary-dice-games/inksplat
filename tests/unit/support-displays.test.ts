// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import {
  barBounds,
  clampInto,
  inside,
  nextDisplay,
  sourceFor,
} from '../../support-app/src/main/displays';

// Which display the app shares and where its windows go (spec/08_remote_support section 3.3).

const d = (id: number, x: number) => ({
  id,
  bounds: { x, y: 0, width: 1920, height: 1080 },
  workArea: { x, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
});
const left = d(1, 0);
const right = d(2, 1920);

describe('displays', () => {
  it('takes the source whose display id is the display', () => {
    const sources = [
      { id: 'screen:2:0', display_id: '2' },
      { id: 'screen:1:0', display_id: '1' },
    ];
    expect(sourceFor(left, [left, right], sources)?.id).toBe('screen:1:0');
    expect(sourceFor(right, [left, right], sources)?.id).toBe('screen:2:0');
    expect(sourceFor(d(3, 0), [left, right], sources)).toBeNull();
  });

  it('goes by order where the system gives no ids, and refuses to guess otherwise', () => {
    const anonymous = [
      { id: 'screen:a', display_id: '' },
      { id: 'screen:b', display_id: '' },
    ];
    expect(sourceFor(right, [left, right], anonymous)?.id).toBe('screen:b');
    expect(sourceFor(right, [left, right], anonymous.slice(0, 1))).toBeNull();
  });

  it('goes round the displays, and stays on a single one', () => {
    expect(nextDisplay(left, [left, right])).toBe(right);
    expect(nextDisplay(right, [left, right])).toBe(left);
    expect(nextDisplay(left, [left])).toBe(left);
  });

  it('puts the bar in the top right corner and keeps a moved window on its display', () => {
    expect(barBounds(right.workArea, { width: 400, height: 100 })).toEqual({
      x: 1920 + 1920 - 400 - 12,
      y: 12,
      width: 400,
      height: 100,
    });
    const off = { x: 1800, y: -50, width: 400, height: 100 };
    expect(inside(off, left.workArea)).toBe(false);
    const back = clampInto(off, left.workArea);
    expect(back).toEqual({ x: 1520, y: 0, width: 400, height: 100 });
    expect(inside(back, left.workArea)).toBe(true);
  });
});
