// MIT License © 2026 Binary Dice Games (adapted for inksplat)
/**
 * @file collab-whiteboard.js A shared whiteboard over any element:
 * everyone's cursors, freehand ink, text notes and stickers, synced over any
 * session-like transport. It imports nothing.
 *
 * Provenance: copied from binary-dice-games/nymph, web/collab/collab-whiteboard.js
 * at commit 13de939afdd5b52f35b1bbd8ef90cd677c3ae844 (2026-10). Changes:
 * emoticon stickers, `frameAdapter` (board units = a frame 1000 units wide,
 * see spec/01_core_features/DESIGN.md section 4.2) and `drawingGate` (the
 * host-side lock on viewers' changes), and later: numbered tools with options, moving, scaling
 * and turning one's own items, images dropped on the board, zoom (in `frameAdapter`), cursors
 * that show the tool and the avatar, a queue for the turn to speak, and files pinned on the
 * board (a preview on the board, the file itself sent to everyone to drag out as a copy). A GIF
 * is drawn animated from its file once it is here, and a picture with transparent parts as a
 * cutout (its border and shadow around what shows).
 * Elements are removed by selecting them and pressing Delete or Backspace (the right button does
 * nothing to them). The pointer tool has modes: the cursor, a laser that leaves a short trail and
 * emotes picked from a wheel that float away (`laser` and `emote` messages, never stored), and a
 * magnifier (a lens beside the pointer with a live copy of the adapter's `content()` and the
 * drawings, seen only here). Bare pins
 * and the pins of notes and pictures are drawn at half their size and catch the pointer as before.
 * New notes and pins are half the size nymph makes them, text sizes three
 * quarters, and the bar over a selected element is kept inside the board (and hidden while the
 * element is dragged or a thread pulled). A note can be dragged
 * out to its size with the note tool, and a thread pressed on or let go over an element gets a new
 * pin there. A sticker catches the pointer over its whole square (WebKit missed its <use>).
 * `saveBoard` gives the files as bytes and `loadBoard` takes them so (the page saves boards as
 * zips, with the files apart from the JSON). A drag of the pointer from an empty place selects
 * several items, which are moved, coloured, removed, copied, cut and pasted together; zoomed in, a
 * mouse drag there pans only with Space held.
 *
 *   import { createWhiteboard } from './collab-whiteboard.js';
 *   const wb = createWhiteboard(container, { session, adapter });
 *   wb.setTool('pen');
 *
 * Items are stored in content units the host defines (the adapter's
 * transform maps them to the screen), and merged per item, last writer
 * wins, so every peer converges whatever the order the changes arrive in.
 */

// ── Limits and validation ─────────────────────────────────────────────────────

/** The model's limits (DESIGN.md section 3.6). */
export const LIMITS = Object.freeze({
  items: 2000,
  points: 5000,
  text: 500,
  snapshotBytes: 1 << 20,
  images: 20,
  imageChars: 300000,
  avatarChars: 16000,
  fileBytes: 5 * 1024 * 1024,
  filesTotal: 25 * 1024 * 1024,
});

/** A refused change (a limit, read-only), with a message for the user. */
export class WhiteboardError extends Error {}

const ID = /^[A-Za-z0-9_.-]{1,64}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const STICKER = /^[a-z0-9-]{1,32}$/;
const KINDS = new Set(['ink', 'text', 'sticker', 'image', 'link', 'note', 'pin', 'arrow']);
const IMAGE_DATA = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const TOOL_NAMES = new Set(['pointer', 'pen', 'text', 'sticker', 'eraser', 'note', 'pin', 'arrow']);
/** The shapes of a sticky note, and the heads of a thread (none, at its source, at its destination, both). */
export const NOTE_SHAPES = Object.freeze(['square', 'rounded', 'oval', 'diamond', 'hexagon']);
/** The shapes of a pin's head (`round` is the usual one and is not stored). */
export const PIN_SHAPES = Object.freeze(['round', 'square', 'diamond', 'triangle', 'star']);
export const ARROW_HEADS = Object.freeze(['none', 'start', 'end', 'both']);
/**
 * The modes of the pointer tool: the plain cursor, a laser that leaves a short trail, emotes that
 * float away, and a magnifier (the cursor with a lens beside it, seen only here).
 */
export const POINTER_MODES = Object.freeze(['cursor', 'laser', 'emote', 'magnify']);
/** The modes in which the pointer lets the input through to the page, as the plain cursor does. */
const PASSIVE_MODES = new Set(['cursor', 'magnify']);
/** The stickers of the emote wheel, clockwise from the top. */
export const EMOTES = Object.freeze(['thumbs-up', 'heart', 'laugh', 'smile', 'surprised', 'thinking', 'sad', 'angry']);
/** How many times an emote can grow (a click on a live one makes it bigger). */
export const EMOTE_LEVELS = 5;
/** How an element is locked: absent (anybody may change it), `owner` (only its author), `all` (nobody, but its author may unlock it). */
export const LOCKS = Object.freeze(['owner', 'all']);
/** How many canvases a board has; an item belongs to one (`page`, 0 to 4, absent for the first). */
export const PAGES = 5;
const MIME = /^[a-z0-9][a-z0-9.+-]{0,60}\/[a-z0-9][a-z0-9.+-]{0,80}$/;
const turned = (r) => (finite(r, -360, 360) && r !== 0 ? { rot: r } : {});
const finite = (n, lo = -1e6, hi = 1e6) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;

function validStamp(s) {
  return Array.isArray(s) && s.length === 2 && Number.isInteger(s[0]) && s[0] >= 0 && typeof s[1] === 'string' && ID.test(s[1]);
}

/** The two items apart from their stamps and locks (what a change of nothing but the lock leaves alone). */
function sameBody(a, b) {
  const strip = ({ stamp, lock, ...rest }) => JSON.stringify(rest);
  return strip(a) === strip(b);
}

/**
 * Whether `next` (a newer version of `old`, made by the peer in its stamp) may replace it: anything
 * goes unless `old` is locked; `owner` lets only its author change it; `all` lets nobody change it
 * but its author may lock or unlock it. Only the author changes the lock.
 */
export function mayChange(old, next) {
  if (!old || old.deleted) {
    return true;
  }
  const owner = next.stamp[1] === old.author;
  if (next.lock !== old.lock && !owner) {
    return false;
  }
  if (!old.lock) {
    return true;
  }
  return owner && (old.lock === 'owner' || sameBody(old, next));
}

/**
 * The attachment fields of a note, picture or link that sits on another element: `on` (the id of
 * that element), `u` and `v` (where the element's centre is on it, as fractions of its width and
 * height from its centre) and `dr` (how much more turned than it the element is). Empty if none.
 */
function attachedTo(item) {
  if (!ID.test(item.on ?? '') || !finite(item.u, -20, 20) || !finite(item.v, -20, 20)) {
    return {};
  }
  return { on: item.on, u: item.u, v: item.v, ...(finite(item.dr, -360, 360) && item.dr !== 0 ? { dr: item.dr } : {}) };
}

/** Orders stamps: the clock, then the peer id. */
function compareStamps(a, b) {
  if (a[0] !== b[0]) {
    return a[0] - b[0];
  }
  return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
}

/**
 * The item if it is well formed, else null. Only the known fields of its
 * kind are kept, so nothing a peer adds reaches the renderer.
 */
export function cleanItem(item) {
  if (!item || typeof item !== 'object' || !ID.test(item.id ?? '') || !ID.test(item.author ?? '') || !validStamp(item.stamp)) {
    return null;
  }
  const base = { id: item.id, author: item.author, stamp: [item.stamp[0], item.stamp[1]] };
  if (item.deleted === true) {
    return { ...base, deleted: true };
  }
  if (!KINDS.has(item.kind)) {
    return null;
  }
  base.kind = item.kind;
  if (LOCKS.includes(item.lock)) {
    base.lock = item.lock;
  }
  if (Number.isInteger(item.page) && item.page > 0 && item.page < PAGES) {
    base.page = item.page;
  }
  if (item.kind === 'ink') {
    const p = item.points;
    if (!Array.isArray(p) || p.length < 2 || p.length % 2 !== 0 || p.length > LIMITS.points * 2 || !p.every((n) => finite(n))) {
      return null;
    }
    if (!COLOR.test(item.color ?? '') || !finite(item.width, 0.5, 64)) {
      return null;
    }
    return { ...base, points: p.slice(), color: item.color, width: item.width };
  }
  if (item.kind === 'image') {
    if (!finite(item.x) || !finite(item.y) || !finite(item.size, 8, 2000) || !finite(item.ratio, 0.05, 20) || !cleanImageData(item.data)) {
      return null;
    }
    const file = cleanFileInfo(item.file);
    return { ...base, x: item.x, y: item.y, size: item.size, ratio: item.ratio, data: item.data, ...(file ? { file } : {}), ...(item.cutout === true ? { cutout: true } : {}), ...turned(item.rot), ...attachedTo(item) };
  }
  if (item.kind === 'note') {
    if (!finite(item.x) || !finite(item.y) || !finite(item.size, 60, 600) || !finite(item.ratio, 0.3, 3) || typeof item.text !== 'string' || item.text.length > LIMITS.text || !COLOR.test(item.color ?? '')) {
      return null;
    }
    const shape = NOTE_SHAPES.includes(item.shape) && item.shape !== 'square' ? { shape: item.shape } : {};
    const font = finite(item.fs, 8, 64) && item.fs !== NOTE_TEXT ? { fs: item.fs } : {};
    return { ...base, x: item.x, y: item.y, size: item.size, ratio: item.ratio, text: item.text, color: item.color, ...shape, ...font, ...turned(item.rot), ...attachedTo(item) };
  }
  if (item.kind === 'pin') {
    const on = ID.test(item.on ?? '') && finite(item.u, -3, 3) && finite(item.v, -3, 3) ? { on: item.on, u: item.u, v: item.v } : {};
    const shape = PIN_SHAPES.includes(item.shape) && item.shape !== 'round' ? { shape: item.shape } : {};
    return finite(item.x) && finite(item.y) && COLOR.test(item.color ?? '') ? { ...base, x: item.x, y: item.y, color: item.color, ...shape, ...on } : null;
  }
  if (item.kind === 'arrow') {
    if (!ID.test(item.from ?? '') || !ID.test(item.to ?? '') || item.from === item.to || !COLOR.test(item.color ?? '') || !ARROW_HEADS.includes(item.heads)) {
      return null;
    }
    return { ...base, from: item.from, to: item.to, color: item.color, heads: item.heads };
  }
  if (item.kind === 'link') {
    const url = cleanUrl(item.url);
    if (!url || !finite(item.x) || !finite(item.y) || !finite(item.size, 40, 1000)) {
      return null;
    }
    return { ...base, x: item.x, y: item.y, size: item.size, url, ...turned(item.rot), ...attachedTo(item) };
  }
  if (!finite(item.x) || !finite(item.y) || !finite(item.size, 4, 400)) {
    return null;
  }
  if (item.kind === 'text') {
    if (typeof item.text !== 'string' || item.text.length === 0 || item.text.length > LIMITS.text || !COLOR.test(item.color ?? '')) {
      return null;
    }
    return { ...base, x: item.x, y: item.y, size: item.size, text: item.text, color: item.color };
  }
  if (!STICKER.test(item.name ?? '')) {
    return null;
  }
  return { ...base, x: item.x, y: item.y, size: item.size, name: item.name, ...turned(item.rot) };
}

/** The web address if it is a short http or https link, else null (so a peer cannot pin a script or a local file). */
export function cleanUrl(value) {
  if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u0020]/.test(value.trim())) {
    return null;
  }
  try {
    const u = new URL(value.trim());
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname && u.href.length <= 2000 ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * The description of a file shared on the board ({name, mime, bytes}) if it is valid, else null.
 * The name loses path separators and control characters, so it is safe as a file name.
 */
export function cleanFileInfo(info) {
  if (!info || typeof info !== 'object') {
    return null;
  }
  const name = typeof info.name === 'string' ? info.name.replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_').trim().slice(0, 120) : '';
  if (!name || !MIME.test(info.mime ?? '') || !Number.isInteger(info.bytes) || info.bytes < 0 || info.bytes > LIMITS.fileBytes) {
    return null;
  }
  return { name, mime: info.mime, bytes: info.bytes };
}

/** The data URL if it is a small PNG, JPEG or WebP image (at most `maxChars` long), else null. */
export function cleanImageData(value, maxChars = LIMITS.imageChars) {
  return typeof value === 'string' && value.length <= maxChars && IMAGE_DATA.test(value) ? value : null;
}

/** Whether a picture has see-through parts: at least 0.1% of its pixels are clearly transparent. */
export function hasTransparency(rgba) {
  let clear = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 250) {
      clear += 1;
    }
  }
  return clear > 0 && clear * 1000 >= rgba.length / 4;
}

/** Whether the bytes are those of a GIF file (the only kind drawn animated on the board). */
export function isGif(bytes) {
  return bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61;
}

/**
 * Reads an image file into a data URL small enough to travel in a message: scaled down until it
 * fits in `maxChars` (JPEG, or PNG for a PNG or a picture with transparent parts). `square` crops
 * the middle (for an avatar). An animated GIF gives its first frame.
 * @returns {Promise<{data: string, width: number, height: number, cutout?: boolean}>} `cutout`
 *   when the picture has transparent parts (it is drawn as a cutout, its border around them)
 * @throws {WhiteboardError} when the file is not an image the browser can read, or stays too big
 */
export async function fileToImageData(file, { maxSide = 800, square = false, maxChars = LIMITS.imageChars } = {}) {
  if (!file || !/^image\//.test(file.type)) {
    throw new WhiteboardError('That file is not an image.');
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new WhiteboardError('That image cannot be read.');
  }
  try {
    let png = file.type === 'image/png';
    let cutout = false;
    const crop = square ? Math.min(bitmap.width, bitmap.height) : 0;
    for (const k of [1, 0.75, 0.5, 0.35, 0.25]) {
      const long = Math.max(32, Math.round(maxSide * k));
      const w = square ? Math.min(long, crop) : Math.max(1, Math.round(bitmap.width * Math.min(1, long / Math.max(bitmap.width, bitmap.height))));
      const h = square ? w : Math.max(1, Math.round(bitmap.height * (w / bitmap.width)));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (square) {
        ctx.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, w, h);
      } else {
        ctx.drawImage(bitmap, 0, 0, w, h);
      }
      if (k === 1) {
        try {
          cutout = hasTransparency(ctx.getImageData(0, 0, w, h).data);
        } catch {
          cutout = false; // the pixels cannot be read: drawn as an ordinary print
        }
        png ||= cutout;
      }
      if (!png) {
        ctx.globalCompositeOperation = 'destination-over'; // JPEG has no transparency: on white
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
      }
      const data = canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.82);
      if (cleanImageData(data, maxChars)) {
        return { data, width: w, height: h, ...(cutout ? { cutout: true } : {}) };
      }
    }
  } finally {
    bitmap.close?.();
  }
  throw new WhiteboardError('That image is too large.');
}

const TEXT_NAME = /\.(txt|md|markdown|csv|tsv|json|xml|ya?ml|log|ini|toml|js|mjs|ts|tsx|jsx|py|rb|go|rs|c|h|cc|cpp|hpp|java|cs|sh|bat|ps1|html?|css|sql)$/i;

function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

function fromBase64(text) {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; ++i) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/** The bytes of a Blob (FileReader where `arrayBuffer` is missing). */
async function blobBytes(blob) {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function formatBytes(n) {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

function wrapLines(ctx, text, width, maxLines) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > width && line) {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines) {
        break;
      }
    } else {
      line += ch;
    }
  }
  if (lines.length < maxLines) {
    lines.push(line);
  } else {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}\u2026`;
  }
  return lines;
}

/**
 * The preview of a file that is not a picture: a page with a coloured band and the type, the
 * first lines when it is text, and its name and size.
 */
async function cardPreview(file, name, mime, content = null) {
  const ext = (/\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1] ?? 'file').toUpperCase();
  let lines = content?.lines ?? null;
  if (!lines && !content?.image && (mime.startsWith('text/') || TEXT_NAME.test(name) || /[/+](json|xml|javascript)$/.test(mime))) {
    try {
      const text = await file.slice(0, 6000).text();
      if (!/[\u0000\uFFFD]/.test(text)) {
        lines = text.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n').slice(0, 14).map((l) => l.slice(0, 36));
      }
    } catch {
      lines = null;
    }
  }
  const w = 320;
  const h = 400;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  let hue = 0;
  for (const ch of ext) {
    hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = `hsl(${hue} 55% 42%)`;
  ctx.fillRect(0, 0, w, 64);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(ext, 20, 44);
  // The folded corner.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(w - 48, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, 48);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#d5d8de';
  ctx.beginPath();
  ctx.moveTo(w - 48, 0);
  ctx.lineTo(w - 48, 48);
  ctx.lineTo(w, 48);
  ctx.closePath();
  ctx.fill();
  if (content?.image) {
    // The first page (or thumbnail) of a document: the top of it, as wide as the card allows.
    const img = content.image;
    const scale = 280 / img.width;
    ctx.save();
    ctx.beginPath();
    ctx.rect(20, 76, 280, 214);
    ctx.clip();
    if (img.height * scale >= 214) {
      ctx.drawImage(img, 0, 0, img.width, 214 / scale, 20, 76, 280, 214);
    } else {
      ctx.drawImage(img, 20, 76 + (214 - img.height * scale) / 2, 280, img.height * scale);
    }
    ctx.restore();
    ctx.strokeStyle = '#d0d3da';
    ctx.strokeRect(20.5, 76.5, 279, 213);
    content.image.close?.();
  } else if (lines) {
    ctx.fillStyle = '#2b2f36';
    ctx.font = '13px ui-monospace, Consolas, monospace';
    lines.forEach((l, i) => ctx.fillText(l, 20, 92 + i * 17));
  } else {
    ctx.fillStyle = '#e3e5ea';
    for (let i = 0; i < 9; ++i) {
      ctx.fillRect(20, 92 + i * 22, i % 4 === 3 ? 150 : 280, 9);
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(0, 300, w, 100);
  ctx.fillStyle = '#1c2024';
  ctx.font = 'bold 20px system-ui, sans-serif';
  wrapLines(ctx, name, w - 40, 2).forEach((l, i) => ctx.fillText(l, 20, 330 + i * 24));
  ctx.fillStyle = '#60646c';
  ctx.font = '15px system-ui, sans-serif';
  ctx.fillText(formatBytes(file.size), 20, 384);
  return { data: canvas.toDataURL('image/png'), width: w, height: h, card: true };
}

/**
 * Prepares a dropped file for the board: its preview (a picture's own, a text file's first lines,
 * or a card with the type, name and size) and, when it is small enough, the file itself to send.
 *
 * @param {File} file
 * @param {{maxBytes?: number, room?: number, preview?: (file: File) => Promise<{image?: CanvasImageSource, lines?: string[]} | null>}} [options]
 *   `maxBytes` the largest file to send, `room` how many more bytes the board can take in total,
 *   `preview` what a host can show of other documents (the first page of a PDF as `image`, the
 *   first `lines` of an Office file); it is not called for files that are too large
 * @returns {Promise<{data: string, width: number, height: number, card?: boolean, name: string,
 *   file?: {name: string, mime: string, bytes: number}, blob: Blob | null}>} no `file` when only
 *   the picture could be shared
 * @throws {WhiteboardError} when it is empty, or not a picture and too large to send
 */
export async function prepareFile(file, { maxBytes = LIMITS.fileBytes, room = Infinity, preview = null } = {}) {
  const info = cleanFileInfo({ name: file?.name || 'file', mime: MIME.test(file?.type ?? '') ? file.type : 'application/octet-stream', bytes: Math.min(file?.size ?? 0, LIMITS.fileBytes) });
  if (!file || !info) {
    throw new WhiteboardError('That file cannot be shared.');
  }
  if (file.size === 0) {
    throw new WhiteboardError(`${info.name} is empty.`);
  }
  const fits = file.size <= Math.min(maxBytes, LIMITS.fileBytes, room);
  let picture = null;
  if (/^image\/(png|jpeg|webp|gif|bmp)$/.test(info.mime)) {
    try {
      picture = await fileToImageData(file);
    } catch {
      picture = null;
    }
  }
  if (!picture) {
    if (!fits) {
      throw new WhiteboardError(`${info.name} is too large to share (the limit is ${Math.floor(LIMITS.fileBytes / 1048576)} MB).`);
    }
    let content = null;
    if (fits && preview) {
      try {
        content = await preview(file);
      } catch {
        content = null; // a damaged or protected document: the card without its content
      }
    }
    picture = await cardPreview(file, info.name, info.mime, content);
  }
  return { ...picture, name: info.name, file: fits ? { ...info, bytes: file.size } : undefined, blob: fits ? file : null };
}

// ── Points ────────────────────────────────────────────────────────────────────

/**
 * Simplifies a flat [x0, y0, x1, y1, ...] polyline (Ramer-Douglas-Peucker,
 * `tolerance` content units) and rounds it to 0.1.
 */
export function simplifyPoints(points, tolerance = 0.4) {
  const n = points.length / 2;
  if (n <= 2) {
    return points.map(round1);
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = points[a * 2];
    const ay = points[a * 2 + 1];
    const dx = points[b * 2] - ax;
    const dy = points[b * 2 + 1] - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; ++i) {
      const px = points[i * 2] - ax;
      const py = points[i * 2 + 1] - ay;
      let d2;
      if (len2 === 0) {
        d2 = px * px + py * py;
      } else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > worst) {
        worst = d2;
        at = i;
      }
    }
    if (worst > t2) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; ++i) {
    if (keep[i]) {
      out.push(round1(points[i * 2]), round1(points[i * 2 + 1]));
    }
  }
  return out;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

// ── Model ─────────────────────────────────────────────────────────────────────

/**
 * The whiteboard's state: items merged per id, last writer (largest
 * stamp) wins, deletes kept as tombstones, Clear as a stamp that removes
 * every older item. Applying the same operations in any order, any
 * number of times, gives the same state.
 *
 * Operations: {t: 'put', item} (add, change or delete one item, whole) and
 * {t: 'clear', stamp}.
 */
export class WhiteboardModel {
  /** @param {string} peerId this peer's id: new items' ids and stamps */
  constructor(peerId) {
    if (!ID.test(peerId ?? '')) {
      throw new WhiteboardError('a whiteboard needs a peer id of letters, digits, ".", "_" and "-"');
    }
    this.peerId = peerId;
    this.clock = 0;
    this.counter = 0;
    this.page = 0; // the canvas new items go on
    this.items = new Map();
    this.clearStamp = [0, ''];
    this.undoStack = [];
    this.redoStack = [];
  }

  /** The items not deleted, oldest stamp first (the drawing order). */
  live() {
    return [...this.items.values()].filter((i) => !i.deleted).sort((a, b) => compareStamps(a.stamp, b.stamp));
  }

  get(id) {
    const item = this.items.get(id);
    return item && !item.deleted ? item : null;
  }

  /** @private A new stamp, after everything seen. */
  stamp() {
    this.clock += 1;
    return [this.clock, this.peerId];
  }

  /**
   * Applies an operation from anywhere; returns the ids it changed (or
   * ['*'] for a clear that removed something), [] when it changed nothing,
   * or null when it is malformed.
   */
  apply(op) {
    if (!op || typeof op !== 'object') {
      return null;
    }
    if (op.t === 'clear') {
      if (!validStamp(op.stamp)) {
        return null;
      }
      this.clock = Math.max(this.clock, op.stamp[0]);
      if (compareStamps(op.stamp, this.clearStamp) <= 0) {
        return [];
      }
      this.clearStamp = [op.stamp[0], op.stamp[1]];
      let removed = false;
      for (const [id, item] of this.items) {
        if (compareStamps(item.stamp, this.clearStamp) < 0) {
          this.items.delete(id);
          removed = true;
        }
      }
      return removed ? ['*'] : [];
    }
    if (op.t !== 'put') {
      return null;
    }
    const item = cleanItem(op.item);
    if (!item) {
      return null;
    }
    this.clock = Math.max(this.clock, item.stamp[0]);
    if (compareStamps(item.stamp, this.clearStamp) < 0) {
      return [];
    }
    const old = this.items.get(item.id);
    if (old && compareStamps(item.stamp, old.stamp) <= 0) {
      return [];
    }
    if (!mayChange(old, item)) {
      return [];
    }
    this.items.set(item.id, item);
    return [item.id];
  }

  /**
   * Adds an item made here: `fields` without id, author or stamp. Returns
   * the operation to send. Throws a WhiteboardError past the limits.
   */
  add(fields) {
    if (this.live().length >= LIMITS.items) {
      throw new WhiteboardError(`The whiteboard is full (${LIMITS.items} items): erase some first.`);
    }
    if (fields.kind === 'image' && this.live().filter((i) => i.kind === 'image').length >= LIMITS.images) {
      throw new WhiteboardError(`The whiteboard has ${LIMITS.images} images already: erase one first.`);
    }
    this.counter += 1;
    const id = `${this.peerId}.${this.counter}`;
    return this.put(null, { page: this.page, ...fields, id, author: this.peerId });
  }

  /** Changes an item (any author's): `fields` replace its own. */
  change(id, fields) {
    const old = this.get(id);
    if (!old) {
      return null;
    }
    return this.put(old, { ...old, ...fields, id, author: old.author });
  }

  /** Deletes an item. */
  remove(id) {
    const old = this.get(id);
    if (!old) {
      return null;
    }
    return this.put(old, { id, author: old.author, deleted: true });
  }

  /** @private Puts `next` with a new stamp, recording `before` for undo. */
  put(before, next, { record = true } = {}) {
    const item = cleanItem({ ...next, stamp: this.stamp() });
    if (!item) {
      throw new WhiteboardError('That item is not valid (too many points, too long a text, or a bad colour).');
    }
    if (!mayChange(this.items.get(item.id), item)) {
      throw new WhiteboardError('That element is locked.');
    }
    const op = { t: 'put', item };
    this.apply(op);
    if (record) {
      this.undoStack.push({ before, after: item });
      if (this.undoStack.length > 200) {
        this.undoStack.shift();
      }
      this.redoStack = [];
    }
    return op;
  }

  /** Clears the whiteboard for everyone; returns the operation. */
  clear() {
    this.clock += 1;
    const op = { t: 'clear', stamp: [this.clock, this.peerId] };
    this.apply(op);
    this.undoStack = [];
    this.redoStack = [];
    return op;
  }

  /** Undoes this peer's last change (as a new operation), or null. */
  undo() {
    const entry = this.undoStack.pop();
    if (!entry) {
      return null;
    }
    this.redoStack.push(entry);
    const { before, after } = entry;
    const restored = before ? { ...before } : { id: after.id, author: after.author, deleted: true };
    return this.put(null, restored, { record: false });
  }

  /** Redoes what undo() took back, or null. */
  redo() {
    const entry = this.redoStack.pop();
    if (!entry) {
      return null;
    }
    this.undoStack.push(entry);
    return this.put(null, { ...entry.after }, { record: false });
  }

  /** A JSON snapshot that merge() takes back: items, tombstones, clear stamp. */
  snapshot() {
    return { v: 1, clock: this.clock, clear: this.clearStamp, items: [...this.items.values()] };
  }

  /**
   * Merges a snapshot (from a peer, or kept from before); returns the ops
   * that changed this state, for relaying.
   */
  merge(snapshot) {
    if (!snapshot || snapshot.v !== 1 || !Array.isArray(snapshot.items)) {
      return null;
    }
    const changed = [];
    if (validStamp(snapshot.clear) && snapshot.clear[0] > 0) {
      const op = { t: 'clear', stamp: snapshot.clear };
      if (this.apply(op)?.length) {
        changed.push(op);
      }
    }
    for (const item of snapshot.items.slice(0, LIMITS.items * 4)) {
      const op = { t: 'put', item };
      if (this.apply(op)?.length) {
        changed.push(op);
      }
    }
    if (Number.isInteger(snapshot.clock)) {
      this.clock = Math.max(this.clock, snapshot.clock);
    }
    return changed;
  }
}

/** A model for `peerId` (also for tests). */
export function createModel(peerId) {
  return new WhiteboardModel(peerId);
}

// ── Stickers ──────────────────────────────────────────────────────────────────

const LINE = 'fill="none" stroke="#1c2024" stroke-width="1.9" stroke-linecap="round"';
const EYES = '<circle cx="8.6" cy="10" r="1.5" fill="#1c2024"/><circle cx="15.4" cy="10" r="1.5" fill="#1c2024"/>';

/** An emoticon: a round face (`fill`) with the given features. */
function face(features, fill = '#ffc53d') {
  return `<circle cx="12" cy="12" r="11" fill="${fill}" stroke="#b97300" stroke-width="1"/>${features}`;
}

/**
 * Built-in stickers: 24-unit SVG symbols, drawn the same on every system
 * (not emoji glyphs, which differ per OS).
 */
export const STICKERS = Object.freeze({
  check: '<circle cx="12" cy="12" r="11" fill="#30a46c"/><path d="M6.5 12.5l3.5 3.5 7.5-8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  cross: '<circle cx="12" cy="12" r="11" fill="#e5484d"/><path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>',
  question: '<circle cx="12" cy="12" r="11" fill="#3e63dd"/><path d="M9.2 9.3a2.9 2.9 0 1 1 4.2 2.6c-.9.5-1.4 1.1-1.4 2.1v.6" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/><circle cx="12" cy="17.6" r="1.4" fill="#fff"/>',
  star: '<path d="M12 1.8l3.1 6.4 7 1-5.1 4.9 1.2 7L12 17.8l-6.2 3.3 1.2-7L1.9 9.2l7-1z" fill="#f5a524" stroke="#b97300" stroke-width="1" stroke-linejoin="round"/>',
  heart: '<path d="M12 21.3S2.2 15.2 2.2 8.6A5 5 0 0 1 12 6.2a5 5 0 0 1 9.8 2.4c0 6.6-9.8 12.7-9.8 12.7z" fill="#e93d82"/>',
  'thumbs-up': '<path d="M2.5 10.5h4v11h-4z" fill="#f5a524"/><path d="M7.5 21.5h9.6a2.4 2.4 0 0 0 2.3-1.8l1.8-6.6A2.4 2.4 0 0 0 18.9 10H14l.8-4a2.2 2.2 0 0 0-4.1-1.4L7.5 10.6z" fill="#ffc53d" stroke="#b97300" stroke-width="1" stroke-linejoin="round"/>',
  warning: '<path d="M12 2.2l10.6 19H1.4z" fill="#ffc53d" stroke="#b97300" stroke-width="1.2" stroke-linejoin="round"/><path d="M12 9v5.5" stroke="#1c2024" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="18" r="1.4" fill="#1c2024"/>',
  arrow: '<path d="M3 12h13M11 5.5L17.5 12 11 18.5" fill="none" stroke="#1c2024" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  smile: face(`${EYES}<path d="M7 14.2q5 5.2 10 0" ${LINE}/>`),
  laugh: face('<path d="M6.5 10.2q2-2.6 4 0M13.5 10.2q2-2.6 4 0" ' + LINE + '/><path d="M6.5 13.4h11a5.5 5.5 0 0 1-11 0z" fill="#1c2024"/>'),
  wink: face(`<circle cx="8.6" cy="9.6" r="1.5" fill="#1c2024"/><path d="M13.6 9.8h3.8" ${LINE}/><path d="M7 14.2q5 5.2 10 0" ${LINE}/>`),
  sad: face(`${EYES}<path d="M8 17.4q4-4.2 8 0" ${LINE}/>`),
  surprised: face(`${EYES}<ellipse cx="12" cy="16.4" rx="2.1" ry="2.7" fill="#1c2024"/>`),
  angry: face(`<path d="M6.3 7.3l4.4 2.1M17.7 7.3l-4.4 2.1" ${LINE}/><circle cx="8.6" cy="11" r="1.4" fill="#1c2024"/><circle cx="15.4" cy="11" r="1.4" fill="#1c2024"/><path d="M8 17.2q4-3.2 8 0" ${LINE}/>`, '#ff9d5c'),
  cool: face(`<path d="M4.3 8.4h15.4v3.3a2.6 2.6 0 0 1-2.6 2.6h-1.4a2.6 2.6 0 0 1-2.6-2.6h-1.4a2.6 2.6 0 0 1-2.6 2.6H6.9a2.6 2.6 0 0 1-2.6-2.6z" fill="#1c2024"/><path d="M7 16q5 4.4 10 0" ${LINE}/>`),
  thinking: face(`<circle cx="8.6" cy="10.4" r="1.5" fill="#1c2024"/><circle cx="15.4" cy="10.4" r="1.5" fill="#1c2024"/><path d="M12.6 6.6l4.8-1.2" ${LINE}/><path d="M9 16.6h5.6" ${LINE}/>`),
});

const PLACEHOLDER = '<circle cx="12" cy="12" r="10.5" fill="#d9d9e0" stroke="#8b8d98" stroke-dasharray="3 2"/><text x="12" y="16.5" font-size="12" text-anchor="middle" fill="#60646c" font-family="sans-serif">?</text>';

// ── Overlay ───────────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';
const PALETTE = ['#e5484d', '#f5a524', '#30a46c', '#0f9f86', '#3e63dd', '#8e4ec6', '#1c2024', '#ffffff'];
const COLOR_NAMES = ['red', 'orange', 'green', 'teal', 'blue', 'purple', 'black', 'white'];
/** The options of the pen (thin, normal, thick) and of text (small, medium, large). */
const WIDTHS = [2, 4, 8];
const WIDTH_NAMES = ['thin', 'normal', 'thick'];
const SIZES = [14, 21, 33];
const SIZE_NAMES = ['small', 'medium', 'large'];
/** Where each tool's cursor points, in its 24-unit icon. */
const HOTSPOT = { pointer: [5, 3], pen: [4, 20], text: [12, 12], sticker: [12, 12], eraser: [5, 19], note: [12, 12], pin: [12, 12], arrow: [12, 12], laser: [12, 12], emote: [12, 12], magnify: [10, 10] };
/** The icons of the pointer's laser and emote modes (on the toolbar and on remote cursors). */
const MODE_ICONS = {
  laser: '<circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5L19 19M19 5l-2.5 2.5M7.5 16.5L5 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  magnify: '<circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15 15l6 6" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>',
  emote: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="10" r="1.3" fill="currentColor"/><circle cx="15" cy="10" r="1.3" fill="currentColor"/><path d="M8 14.5q4 4 8 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};
const LASER_MS = 1200; // how long each point of a laser trail lasts
const EMOTE_MS = 2000; // the life of an emote; a click on it starts it again
const EMOTE_PX = 40; // the size of an emote on screen, before it grows
const EMOTE_GROW = 1.3; // how much bigger each click makes it
const EMOTE_RISE = 90; // how far (screen pixels) it floats up in its life
const WHEEL_RADIUS = 64; // from the centre of the emote wheel to its emotes
const LENS_RADIUS = 110; // the magnifier's lens, in screen pixels
const LENS_GAP = 130; // from the pointer to the centre of the lens (up and right, or wherever it fits)
const LENS_POWERS = [1.5, 2, 2.5, 3, 4, 5, 6, 8]; // what the wheel goes through with the magnifier

const MAX_QUEUE = 50;
const pinColor = (id) => PALETTE[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % 6];

const nearest = (list, v) => list.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(list[best] - v) ? i : best), 0);
const readableOn = (hex) => ((parseInt(hex.slice(1, 3), 16) * 299 + parseInt(hex.slice(3, 5), 16) * 587 + parseInt(hex.slice(5, 7), 16) * 114) / 1000 > 150 ? '#1c2024' : '#ffffff');
/** A pale version of a colour, for the paper of a note. */
const pastel = (hex) => {
  const c = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.35 + 255 * 0.65));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

/** How much of a note's width and height the text may use, by shape. */
const SHAPE_INSET = { square: 1, rounded: 1, oval: 0.74, diamond: 0.54, hexagon: 0.86 };

/** The element of a note's outline (also used by the buttons that choose a shape). */
function shapeElement(shape, x, y, w, h, attrs) {
  if (shape === 'oval') {
    return svgEl('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, ...attrs });
  }
  if (shape === 'diamond') {
    return svgEl('polygon', { points: `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`, ...attrs });
  }
  if (shape === 'hexagon') {
    return svgEl('polygon', { points: `${x + w * 0.18},${y} ${x + w * 0.82},${y} ${x + w},${y + h / 2} ${x + w * 0.82},${y + h} ${x + w * 0.18},${y + h} ${x},${y + h / 2}`, ...attrs });
  }
  return svgEl('rect', { x, y, width: w, height: h, ...(shape === 'rounded' ? { rx: Math.min(w, h) * 0.18 } : {}), ...attrs });
}

/** Where the pin of an item is drawn, before the item's turn: size of the border and the pin. */
function pinMetrics(item, h) {
  const pad = Math.min(8, Math.max(3, item.size * 0.03));
  const r = Math.min(8, Math.max(4, item.size * 0.035));
  return { pad, r, x: item.x, y: item.y - h / 2 - pad + r * 1.15, head: r / 2 };
}

/**
 * The filter that draws a picture with transparent parts as a cutout: a white border `pad` wide
 * around what shows, with a thin edge (class `cut-edge`, coloured when the picture is selected).
 * Its region is the picture's box (x, y, w, h) grown by the border.
 */
function cutoutFilter(id, x, y, w, h, pad) {
  const m = pad + 3;
  const f = svgEl('filter', { id, filterUnits: 'userSpaceOnUse', x: x - m, y: y - m, width: w + 2 * m, height: h + 2 * m, 'color-interpolation-filters': 'sRGB' });
  // Grows what shows, then rounds the steps that leaves off with a slight blur cut back to a sharp edge.
  const grow = (radius, result) => {
    const sharp = svgEl('feComponentTransfer', { result });
    sharp.append(svgEl('feFuncA', { type: 'linear', slope: 3, intercept: -1 }));
    return [svgEl('feMorphology', { in: 'SourceAlpha', operator: 'dilate', radius }), svgEl('feGaussianBlur', { stdDeviation: 1 }), sharp];
  };
  f.append(
    ...grow(pad, 'grown'),
    ...grow(pad + 0.75, 'outer'),
    svgEl('feFlood', { class: 'cut-edge', 'flood-color': '#000000', 'flood-opacity': 0.25 }),
    svgEl('feComposite', { in2: 'outer', operator: 'in', result: 'edge' }),
    svgEl('feFlood', { 'flood-color': '#ffffff' }),
    svgEl('feComposite', { in2: 'grown', operator: 'in', result: 'border' }),
  );
  const merge = svgEl('feMerge');
  merge.append(svgEl('feMergeNode', { in: 'edge' }), svgEl('feMergeNode', { in: 'border' }), svgEl('feMergeNode', { in: 'SourceGraphic' }));
  f.append(merge);
  return f;
}

/** The drawn radius of a bare pin, and the radius of the invisible circle that catches the pointer over it (twice as large as the pin was). */
const PIN_RADIUS = 2.5;
const PIN_HIT = 9;

/** How far below its centre the pin of a note, picture or link is (before it is turned); 0 for what has no pin. */
function pinOffset(item) {
  if (item.kind !== 'image' && item.kind !== 'link' && item.kind !== 'note') {
    return 0;
  }
  return pinMetrics(item, item.size * (item.kind === 'link' ? 0.5 : item.ratio)).y - item.y;
}

/** Where the centre of an item really is: what is pinned turns about its pin, not about its centre. */
function centre(item) {
  const k = pinOffset(item);
  const a = ((item.rot ?? 0) * Math.PI) / 180;
  return { x: item.x + k * Math.sin(a), y: item.y + k * (1 - Math.cos(a)) };
}

/** The stored x and y of an item (as sized in `item`) whose centre is `c` once it is turned by `rot` about its pin. */
function fromCentre(item, c, rot) {
  const k = pinOffset(item);
  const a = (rot * Math.PI) / 180;
  return { x: c.x - k * Math.sin(a), y: c.y - k * (1 - Math.cos(a)) };
}

/** The head of a pin in the given shape, centred at (x, y) and about `r` from the centre to its edge. */
function pinHead(shape, x, y, r, attrs) {
  const poly = (pts) => svgEl('polygon', { points: pts.map(([px, py]) => `${round1(x + px * r)},${round1(y + py * r)}`).join(' '), 'stroke-linejoin': 'round', ...attrs });
  if (shape === 'square') {
    return svgEl('rect', { x: x - r * 0.85, y: y - r * 0.85, width: r * 1.7, height: r * 1.7, rx: r * 0.2, ...attrs });
  }
  if (shape === 'diamond') {
    return poly([[0, -1.2], [1.2, 0], [0, 1.2], [-1.2, 0]]);
  }
  if (shape === 'triangle') {
    return poly([[0, -1.15], [1.1, 0.9], [-1.1, 0.9]]);
  }
  if (shape === 'star') {
    return poly(Array.from({ length: 10 }, (_, i) => {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const k = i % 2 === 0 ? 1.25 : 0.55;
      return [Math.cos(a) * k, Math.sin(a) * k];
    }));
  }
  return svgEl('circle', { cx: x, cy: y, r, ...attrs });
}

/** How far along the diagonal to the corner a shape reaches, by shape (so a grip can sit inside it). */
const GRIP_REACH = { square: 1, rounded: 0.92, oval: 0.7071, diamond: 0.5, hexagon: 0.735 };

/** The grip that resizes a note or picture, from its centre in its own frame: inside the shape, near its bottom right. */
function gripOf(item) {
  const s = GRIP_REACH[item.shape ?? 'square'] ?? 1;
  return { x: (s * item.size) / 2 - 9, y: (s * item.size * item.ratio) / 2 - 9, s };
}

/** The little handle drawn at the grip, with a pale disc so it shows on any paper. */
function gripNode(item) {
  const g = gripOf(item);
  const x = item.x + g.x;
  const y = item.y + g.y;
  const node = svgEl('g', { class: 'grip' });
  node.append(
    svgEl('circle', { cx: x, cy: y, r: 8, fill: 'rgba(255,255,255,0.45)' }),
    svgEl('path', { d: `M${x - 5} ${y + 5}L${x + 5} ${y - 5}M${x} ${y + 5}L${x + 5} ${y}`, stroke: 'rgba(0,0,0,0.55)', 'stroke-width': 1.4, fill: 'none', 'stroke-linecap': 'round' }),
  );
  return node;
}

/** A small padlock at (x, y) for a locked element: grey when only its owner may change it, red when nobody may. */
function lockBadge(x, y, level) {
  const color = level === 'all' ? '#c42b31' : '#4b5563';
  const g = svgEl('g', { class: 'lock' });
  g.append(
    svgEl('path', { d: `M${x - 3} ${y}v-2.5a3 3 0 0 1 6 0V${y}`, fill: 'none', stroke: color, 'stroke-width': 1.4 }),
    svgEl('rect', { x: x - 4.5, y, width: 9, height: 7, rx: 1.5, fill: color, stroke: '#ffffff', 'stroke-width': 0.6 }),
  );
  return g;
}

/**
 * The frame (centre, size, turn) of an item a pin can be attached to, or null: notes, pictures,
 * links and stickers.
 */
function hostFrame(item) {
  if (!item) {
    return null;
  }
  const c = centre(item);
  const flat = { x: c.x, y: c.y, w: item.size, rot: item.rot ?? 0 };
  if (item.kind === 'note' || item.kind === 'image') {
    return { ...flat, h: item.size * item.ratio };
  }
  if (item.kind === 'link') {
    return { ...flat, h: item.size * 0.5 };
  }
  return item.kind === 'sticker' ? { ...flat, h: item.size } : null;
}

/** Where (u, v) of a frame is: both are fractions of its width and height from its centre, turned with it. */
function frameAt(f, u, v) {
  const a = (f.rot * Math.PI) / 180;
  const lx = u * f.w;
  const ly = v * f.h;
  return { x: f.x + lx * Math.cos(a) - ly * Math.sin(a), y: f.y + lx * Math.sin(a) + ly * Math.cos(a) };
}

/** The (u, v) of the point `p` in the frame `f`, or null when it is outside it. */
function frameOf(f, p) {
  const a = (f.rot * Math.PI) / 180;
  const dx = p.x - f.x;
  const dy = p.y - f.y;
  const lx = dx * Math.cos(a) + dy * Math.sin(a);
  const ly = -dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= f.w / 2 && Math.abs(ly) <= f.h / 2 ? { u: Math.round((lx / f.w) * 1e6) / 1e6, v: Math.round((ly / f.h) * 1e6) / 1e6 } : null;
}

/** The (u, v) of the point `p` in the frame `f`, whether it is inside it or not. */
function frameCoords(f, p) {
  const a = (f.rot * Math.PI) / 180;
  const dx = p.x - f.x;
  const dy = p.y - f.y;
  return { u: Math.round(((dx * Math.cos(a) + dy * Math.sin(a)) / f.w) * 1e6) / 1e6, v: Math.round(((-dx * Math.sin(a) + dy * Math.cos(a)) / f.h) * 1e6) / 1e6 };
}

/** What follows an element that holds others: where each is and how it is turned, given the element as it will be. */
function followers(live, before, after, out = new Map(), seen = new Set()) {
  if (seen.has(after.id)) {
    return out;
  }
  seen.add(after.id);
  const frame = hostFrame(after);
  if (!frame) {
    return out;
  }
  for (const c of live) {
    if (c.on === after.id && (c.kind === 'note' || c.kind === 'image' || c.kind === 'link')) {
      const at = frameAt(frame, c.u, c.v);
      const rot = degrees((after.rot ?? 0) + (c.dr ?? 0));
      const to = fromCentre(c, at, rot);
      const moved = { ...c, x: round1(to.x), y: round1(to.y), rot };
      out.set(c.id, moved);
      followers(live, c, moved, out, seen);
    }
  }
  return out;
}

/**
 * The point where a thread ties to an item (its pin), in content units, or null when the item has
 * none. Pictures, links and notes carry a pin at the top middle; a pin item is its own pin, and one
 * that is attached to another item (`on`) keeps its place on it as it is moved, turned or scaled.
 *
 * @param {object} item
 * @param {(id: string) => object | null | undefined} [get] finds the item a pin is attached to
 */
export function pinPoint(item, get = () => null) {
  if (!item) {
    return null;
  }
  if (item.kind === 'pin') {
    const frame = item.on ? hostFrame(get(item.on)) : null;
    return frame ? frameAt(frame, item.u, item.v) : { x: item.x, y: item.y };
  }
  if (item.kind !== 'image' && item.kind !== 'link' && item.kind !== 'note') {
    return null;
  }
  // The pin is the pivot: turning the element does not move it.
  return { x: item.x, y: item.y + pinOffset(item) };
}

/**
 * The thread between two points: a quadratic curve that hangs below the straight line, more the
 * longer it is (`seed`, 0 to 1, makes threads between the same pins differ).
 * @returns {{c: {x: number, y: number}, d: string}}
 */
export function threadCurve(a, b, seed = 0.5) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const sag = Math.min(90, 8 + len * 0.16) * (0.85 + seed * 0.3);
  const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + sag };
  return { c, d: `M${round1(a.x)} ${round1(a.y)}Q${round1(c.x)} ${round1(c.y)} ${round1(b.x)} ${round1(b.y)}` };
}

const BOARD_FORMAT = 'inksplat-board';

const NOTE_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const NOTE_TEXT = 12; // the usual font size of a note, in board units
const NOTE_SIZES = [9, 12, 18]; // small, medium, large
const noteFont = (item) => item.fs ?? NOTE_TEXT;
const NOTE_PAD = 10;
const NOTE_SIZE = 90; // the width of a new note, in board units
/** What has a colour that the bar over a selection of several items changes. */
const COLORED = new Set(['ink', 'text', 'note', 'pin', 'arrow']);
/** The clipboard type of copied items (JSON: {format, key, items}). */
const CLIP_TYPE = 'application/x-inksplat-items';
const CLIP_FORMAT = 'inksplat-items';
/** What can be selected, to be changed or locked with the bar over it. */
const SELECTABLE = new Set(['note', 'pin', 'arrow', 'image', 'link']);
/** Drawn items, selected (to be removed with Delete or locked) with the pointer or the tool that makes them. */
const DRAWN = new Set(['ink', 'text', 'sticker']);
/** The elements that carry a pin, and can be attached to another element by it. */
const ELEMENTS = new Set(['note', 'image', 'link']);
const NOTE_HANG = 1.6; // a hanging baseline sits this far below the top of a text box line (at the usual size)

/** The stored size and ratio of a note `width` by `height` units, kept within a note's limits. */
function noteBounds(width, height) {
  const size = Math.round(Math.min(600, Math.max(60, Math.abs(width) || 0)));
  const ratio = Math.round(Math.min(3, Math.max(0.3, (Math.abs(height) || 0) / size)) * 10000) / 10000;
  return { size, ratio };
}

/** The width a note's text may take, in units. */
const noteTextWidth = (item) => item.size * SHAPE_INSET[item.shape ?? 'square'] - 2 * NOTE_PAD;
/** The top of a note's text (from the top of the note): centred in the shape, never above the top padding. */
const noteTextTop = (item, lines) => {
  const h = item.size * item.ratio;
  return Math.max(NOTE_PAD, (h - lines * noteFont(item) * 1.25) / 2);
};
let noteContext;

/** The lines of a note's text for a paper `width` units wide (words kept whole, long words broken). */
function wrapNote(text, width, font = NOTE_TEXT) {
  if (noteContext === undefined) {
    noteContext = (typeof document !== 'undefined' && document.createElement('canvas').getContext?.('2d')) || null;
  }
  if (noteContext) {
    noteContext.font = `${font}px ${NOTE_FONT}`;
  }
  const measure = (str) => (noteContext ? noteContext.measureText(str).width : str.length * font * 0.55);
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (let word of paragraph.split(' ')) {
      while (measure(word) > width && word.length > 1) {
        if (line) {
          lines.push(line);
          line = '';
        }
        let n = word.length - 1;
        while (n > 1 && measure(word.slice(0, n)) > width) {
          --n;
        }
        lines.push(word.slice(0, n));
        word = word.slice(n);
      }
      if (line && measure(`${line} ${word}`) > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Puts text on the clipboard; resolves false when the browser refuses. */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const decodeSafe = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const degrees = (a) => Math.round((((a + 180) % 360) + 360) % 360 * 10 - 1800) / 10;

/** Labels a host can translate (`strings` option). */
const STRINGS = {
  canvas: 'Canvas',
  canvases: 'Canvases',
  peopleHere: 'here',
  pointer: 'Pointer: use the page below, drag over the board to select (Esc)',
  pointerModeNames: {
    cursor: 'Cursor',
    laser: 'Laser pointer: drag to leave a trail',
    emote: 'Emotes: press, pick one and let go (click one to make it bigger)',
    magnify: 'Magnifier: the wheel changes how much it enlarges',
  },
  magnifier: 'Magnifier',
  pen: 'Pen',
  text: 'Text note',
  sticker: 'Sticker (Shift+drag scales, Ctrl+drag turns)',
  eraser: 'Eraser',
  note: 'Sticky note (press again for another shape)',
  pin: 'Pin',
  arrow: 'Thread between pins (press again for other heads)',
  shapeNames: { square: 'Square', rounded: 'Rounded', oval: 'Oval', diamond: 'Diamond', hexagon: 'Hexagon' },
  headNames: { none: 'No heads', start: 'Head at the source', end: 'Head at the destination', both: 'Heads at both ends' },
  shapeLabel: 'Shape',
  pinShapeNames: { round: 'Round', square: 'Square', diamond: 'Diamond', triangle: 'Triangle', star: 'Star' },
  lockNames: {
    open: 'Unlocked: anybody can change it (click to lock it for the others)',
    owner: 'Locked: only its owner can change it (click to lock it for everybody)',
    all: 'Locked for everybody (click to unlock it)',
  },
  locked: 'That element is locked',
  someLocked: 'Some of them are locked',
  selectedCount: 'selected',
  copyText: 'Copy the text',
  noteCopied: 'Note copied to the clipboard',
  noteNotCopied: 'The browser did not allow copying',
  undo: 'Undo (Ctrl+Z)',
  redo: 'Redo (Ctrl+Y)',
  clear: 'Clear the whiteboard for everyone',
  color: 'Colour',
  readOnly: 'Drawing is locked',
  typeHere: 'Type, then Enter (Shift+Enter for a new line)',
  ask: 'Ask for a turn',
  endTurn: 'End my turn',
  leaveQueue: 'Leave the queue',
  queue: 'Speaking order',
  speaking: 'speaking',
  you: 'you',
  yourTurn: 'Your turn to speak',
  removeFromQueue: 'Remove from the queue',
  fileArriving: 'The file is still arriving\u2026',
  dragFile: 'Shift+drag it to copy it out, double click to save',
};

const ICONS = {
  pointer: '<path d="M5 3l14 7-6 1.8L10.5 18z" fill="currentColor"/>',
  pen: '<path d="M4 20l1-4L16 5l3 3L8 19z M14 7l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  sticker: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  eraser: '<path d="M8 20h12M4.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 18H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  note: '<path d="M5 4h14v10l-5 6H5z M14 20v-6h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  pin: '<circle cx="12" cy="9" r="5" fill="currentColor"/><path d="M12 14v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  arrow: '<path d="M4 17Q12 22 20 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="4" cy="17" r="2.5" fill="currentColor"/><circle cx="20" cy="7" r="2.5" fill="currentColor"/>',
  undo: '<path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" transform="translate(0 -3)"/>',
  redo: '<path d="M15 7l5 5-5 5M20 12H10a6 6 0 0 0 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" transform="translate(0 -3)"/>',
  clear: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
};

const STYLE = `
:host { all: initial; position: absolute; inset: 0; pointer-events: none; z-index: 5;
  --wb-bg: #ffffff; --wb-fg: #1c2024; --wb-border: #d9d9e0; --wb-accent: #0f9f86; --wb-hover: #f0f0f3;
  font: 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (prefers-color-scheme: dark) { :host { --wb-bg: #18191b; --wb-fg: #edeef0; --wb-border: #363a3f; --wb-hover: #272a2d; } }
svg.board { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
svg.board.active { pointer-events: auto; touch-action: none; }
svg.board .item { pointer-events: visiblePainted; touch-action: none; }
svg.board .item .hit { pointer-events: stroke; }
svg.board .item .hit.box { pointer-events: fill; }
svg.board .link-item { cursor: pointer; }
svg.board.pen { cursor: crosshair; } svg.board.text { cursor: text; } svg.board.sticker { cursor: copy; }
svg.board.eraser { cursor: cell; }
svg.board:not(.pen):not(.eraser):not(.laser):not(.emote) .item.own { cursor: move; }
svg.board.laser, svg.board.laser .item { cursor: crosshair; } svg.board.emote, svg.board.emote .item { cursor: default; }
.fx { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.fx .emote { position: absolute; left: 0; top: 0; will-change: transform, opacity; filter: drop-shadow(0 2px 3px rgba(0,0,0,.3)); }
.fx .emote svg { display: block; width: 100%; height: 100%; }
.wheel { position: absolute; width: 0; height: 0; pointer-events: none; }
.wheel .ring { position: absolute; left: -92px; top: -92px; width: 184px; height: 184px; border-radius: 50%; background: var(--wb-bg); opacity: .88; box-shadow: 0 2px 14px rgba(0,0,0,.3); }
.wheel .hub { position: absolute; left: -5px; top: -5px; width: 10px; height: 10px; border-radius: 50%; background: var(--wb-border); }
.wheel .slot { position: absolute; width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%; display: grid; place-items: center; transition: transform 80ms; }
.wheel .slot.on { transform: scale(1.4); background: var(--wb-hover); }
.wheel .slot svg { width: 32px; height: 32px; }
.lens { position: absolute; left: 0; top: 0; box-sizing: border-box; overflow: hidden; border-radius: 50%; pointer-events: none; background: #ffffff;
  border: 3px solid var(--wb-fg); box-shadow: 0 4px 18px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.6); }
.lens[hidden] { display: none; }
.lens .view { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.lens .view > svg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; }
.lens .aim { position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; }
.capture { fill: transparent; }
.item text { white-space: pre; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; paint-order: stroke; stroke: #ffffff; stroke-width: 0.25em; stroke-linejoin: round; }
.item.erasing { opacity: 0.3; }
.sweep { fill: none; stroke: var(--wb-accent); stroke-width: 2; stroke-dasharray: 5 4; stroke-linecap: round; stroke-linejoin: round; opacity: .7; pointer-events: none; }
.cursors { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.cursor { position: absolute; left: 0; top: 0; will-change: transform; transition: transform 60ms linear; }
.cursor .shape { position: absolute; }
.cursor svg { display: block; filter: drop-shadow(0 0 1px #fff) drop-shadow(0 1px 1px rgba(0,0,0,.35)); }
.cursor svg.pointer path { stroke: #fff; stroke-width: 1.4; stroke-linejoin: round; }
.cursor.active .shape { transform: scale(1.7); transform-origin: var(--hx) var(--hy); }
@keyframes pulse { 0%, 100% { box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--c); } 50% { box-shadow: 0 0 0 3px #fff, 0 0 0 7px var(--c), 0 0 14px 6px var(--c); } }
.cursor.active img, .cursor.active span { animation: pulse 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .cursor.active img, .cursor.active span { animation: none; } }
.cursor img { position: absolute; left: 14px; top: 14px; width: 26px; height: 26px; box-sizing: border-box; border-radius: 50%; border: 2px solid #8b8d98; object-fit: cover; background: #fff; }
.cursor img[hidden], .cursor span[hidden] { display: none; }
.cursor.active img { left: 22px; top: 24px; width: 44px; height: 44px; border-width: 3px; }
.cursor.active span { left: 26px; top: 30px; font-size: 14px; font-weight: 600; }
.cursor span { position: absolute; left: 14px; top: 16px; padding: 1px 6px; border-radius: 6px; color: #fff; font-size: 11px; white-space: nowrap; max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.toolbar { position: absolute; left: 8px; top: 8px; display: flex; flex-direction: column; gap: 2px; padding: 4px; border-radius: 10px;
  background: var(--wb-bg); color: var(--wb-fg); border: 1px solid var(--wb-border); box-shadow: 0 2px 10px rgba(0,0,0,.15); pointer-events: auto; }
.toolbar button { all: unset; box-sizing: border-box; position: relative; width: 32px; height: 32px; border-radius: 7px; display: grid; place-items: center; cursor: pointer; color: inherit; }
.toolbar button:hover { background: var(--wb-hover); }
.toolbar button:focus-visible { outline: 2px solid var(--wb-accent); outline-offset: -2px; }
.toolbar button[aria-pressed="true"] { background: var(--wb-accent); color: #fff; }
.toolbar button:disabled { opacity: .35; cursor: default; background: none; }
.toolbar hr { border: 0; border-top: 1px solid var(--wb-border); margin: 3px 2px; }
.toolbar .swatch { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--wb-bg); box-shadow: 0 0 0 1px var(--wb-border); }
.toolbar svg { width: 20px; height: 20px; }
.locked { font-size: 11px; padding: 4px; max-width: 32px; text-align: center; opacity: .75; }
.pop { position: absolute; left: 52px; display: grid; grid-template-columns: repeat(4, 34px); gap: 2px; padding: 4px; border-radius: 10px;
  background: var(--wb-bg); border: 1px solid var(--wb-border); box-shadow: 0 2px 10px rgba(0,0,0,.15); pointer-events: auto; }
.pop[hidden] { display: none; }
.pop button { all: unset; width: 34px; height: 34px; border-radius: 7px; display: grid; place-items: center; cursor: pointer; }
.pop button:hover, .pop button[aria-pressed="true"] { background: var(--wb-hover); }
.pop .swatch { width: 20px; height: 20px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(128,128,128,.55); }
.drag { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.drag .proxy { position: absolute; left: 0; top: 0; pointer-events: none; }
.drag.shift:not(.off) .proxy { pointer-events: auto; cursor: copy; }
.toolbar button[data-key]::after { content: attr(data-key); position: absolute; right: 3px; bottom: 1px; font: 9px/1 system-ui, sans-serif; opacity: .6; pointer-events: none; }
.hint { position: absolute; padding: 3px 8px; border-radius: 6px; background: var(--wb-fg); color: var(--wb-bg); font-size: 12px; white-space: nowrap; pointer-events: none; }
.hint[hidden] { display: none; }
.pages { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; padding: 4px 10px; border-radius: 999px; background: var(--wb-bg); color: var(--wb-fg); box-shadow: 0 1px 6px rgba(0,0,0,.35); pointer-events: auto; }
.pages[hidden] { display: none; }
.pages .cell { position: relative; display: grid; }
.pages button { all: unset; box-sizing: border-box; width: 26px; height: 26px; border-radius: 50%; border: 2px solid currentColor; display: grid; place-items: center; font-size: 12px; font-weight: 700; cursor: pointer; opacity: .65; }
.pages button:hover { opacity: 1; }
.pages button[aria-current="true"] { background: var(--wb-accent); border-color: var(--wb-accent); color: #fff; opacity: 1; }
.pages button:focus-visible { outline: 2px solid var(--wb-accent); outline-offset: 2px; }
.pages .n { position: absolute; right: -7px; bottom: -7px; min-width: 14px; height: 14px; padding: 0 3px; box-sizing: border-box; border-radius: 7px; pointer-events: none; background: var(--wb-fg); color: var(--wb-bg); font-size: 10px; font-weight: 700; line-height: 14px; text-align: center; }
.queue { position: absolute; left: 8px; bottom: 8px; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; max-width: min(260px, 70%); pointer-events: none; }
.queue[hidden] { display: none; }
.queue .entry { display: flex; align-items: center; gap: 6px; max-width: 100%; box-sizing: border-box; padding: 3px 10px 3px 4px; border-radius: 999px; font-size: 12px;
  box-shadow: 0 1px 6px rgba(0,0,0,.3); pointer-events: auto; }
.queue .entry.first { font-size: 14px; font-weight: 700; box-shadow: 0 0 0 3px #fff, 0 2px 12px rgba(0,0,0,.45); }
.queue .entry img, .queue .entry .initial { width: 24px; height: 24px; flex: none; border-radius: 50%; object-fit: cover; background: rgba(255,255,255,.4); display: grid; place-items: center; font-weight: 700; }
.queue .entry.first img, .queue .entry.first .initial { width: 30px; height: 30px; }
.queue .entry .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.queue .entry .num { opacity: .75; font-variant-numeric: tabular-nums; }
.queue .entry button { all: unset; cursor: pointer; padding: 0 4px; opacity: .75; }
.queue .entry button:hover { opacity: 1; }
.queue .entry button:focus-visible, .queue .turn:focus-visible { outline: 2px solid var(--wb-accent); outline-offset: 1px; }
.queue .turn { all: unset; box-sizing: border-box; cursor: pointer; padding: 5px 12px; border-radius: 999px; background: var(--wb-bg); color: var(--wb-fg);
  border: 1px solid var(--wb-border); box-shadow: 0 2px 8px rgba(0,0,0,.2); pointer-events: auto; }
.queue .turn:hover { background: var(--wb-hover); }
svg.board .note-item { cursor: default; }
svg.board .arrow-item, svg.board .pin-item { cursor: pointer; }
svg.board.arrow, svg.board.pin { cursor: crosshair; }
.item.selected .paper { stroke: var(--wb-accent); stroke-width: 2.5; }
.item.selected .cut-edge, .item.drop-target .cut-edge { flood-color: var(--wb-accent); flood-opacity: 1; }
.ink-item.selected, .text-item.selected, .sticker-item.selected { filter: drop-shadow(0 0 2px var(--wb-accent)) drop-shadow(0 0 2px var(--wb-accent)); }
.item.by-pin .paper { stroke: rgba(0,0,0,0.25); stroke-width: 0.75; }
.item.by-pin .cut-edge { flood-color: #000000; flood-opacity: 0.25; }
.item.drop-target .paper { stroke: var(--wb-accent); stroke-width: 2.5; stroke-dasharray: 7 4; }
.sticker-item.drop-target use { outline: 2.5px dashed var(--wb-accent); outline-offset: 3px; }
.pin-ring { stroke: var(--wb-accent, #3e63dd); stroke-width: 2.5; }
.item.editing text { visibility: hidden; }
.selbar { position: absolute; display: flex; align-items: center; gap: 3px; padding: 4px; border-radius: 8px; transform: translate(-50%, -100%);
  background: var(--wb-bg); border: 1px solid var(--wb-border); box-shadow: 0 2px 10px rgba(0,0,0,.2); pointer-events: auto; }
.selbar[hidden], .selbar.moving { display: none; }
.selbar button { width: 28px; height: 28px; padding: 3px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--wb-fg); cursor: pointer; }
.selbar button[aria-pressed="true"] { border-color: var(--wb-accent); background: var(--wb-hover, rgba(0,0,0,.08)); }
.selbar hr { width: 1px; height: 20px; margin: 0 2px; border: 0; background: var(--wb-border); }
.selbar .count { padding: 0 6px; color: var(--wb-fg); font-size: 12px; white-space: nowrap; }
.selbar .swatch { display: block; width: 18px; height: 18px; margin: auto; border-radius: 50%; border: 1px solid rgba(0,0,0,.3); }
textarea.note { position: absolute; margin: 0; padding: 2px 4px; border: 1px dashed var(--wb-accent); border-radius: 4px; background: rgba(255,255,255,.92);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.2; resize: none; overflow: hidden; outline: none; pointer-events: auto; min-width: 4em; transform-origin: 0 0; }
`;

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, String(v));
  }
  return node;
}

function htmlEl(tag, attrs = {}, html) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null && v !== false) {
      node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (html !== undefined) {
    node.innerHTML = html; // only the package's own icons and the host's stickers
  }
  return node;
}

/** The smoothed path of a flat polyline (quadratic curves through midpoints). */
function inkPath(p) {
  if (p.length < 4) {
    return `M${p[0]} ${p[1]}l0.01 0`;
  }
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i < p.length - 2; i += 2) {
    const mx = round1((p[i] + p[i + 2]) / 2);
    const my = round1((p[i + 1] + p[i + 3]) / 2);
    d += `Q${p[i]} ${p[i + 1]} ${mx} ${my}`;
  }
  return `${d}L${p[p.length - 2]} ${p[p.length - 1]}`;
}

/** The default adapter: the container's box, one unit per CSS pixel at the start. */
/**
 * A copy of an element and what is in it that looks the same outside its page's style sheets (its
 * computed style is copied onto it), with every video playing the same stream; for the magnifier.
 */
function copyLive(element) {
  const copy = element.cloneNode(true);
  const from = [element, ...element.querySelectorAll('*')];
  const to = [copy, ...copy.querySelectorAll('*')];
  from.forEach((el, i) => {
    const c = to[i];
    c.removeAttribute('id');
    const cs = getComputedStyle(el);
    for (let j = 0; j < cs.length; j++) {
      c.style.setProperty(cs[j], cs.getPropertyValue(cs[j]));
    }
    if (el instanceof HTMLVideoElement && c instanceof HTMLVideoElement) {
      c.muted = true;
      c.autoplay = true;
      c.playsInline = true;
      if (el.srcObject) {
        c.srcObject = el.srcObject;
      }
      c.play?.()?.catch?.(() => {});
    }
  });
  return copy;
}

function boxAdapter(element) {
  const r = element.getBoundingClientRect();
  const w0 = r.width || 1;
  return {
    element,
    transform: () => {
      const s = (element.getBoundingClientRect().width || w0) / w0;
      return { a: s, b: 0, c: 0, d: s, e: 0, f: 0 };
    },
    onChange: (cb) => {
      if (typeof ResizeObserver !== 'function') {
        return () => {};
      }
      const ro = new ResizeObserver(() => cb());
      ro.observe(element);
      return () => ro.disconnect();
    },
  };
}

/**
 * The whiteboard over `container` (DESIGN.md section 5.2).
 */
export class Whiteboard {
  /**
   * @param {HTMLElement} container the element drawn over (made a positioning parent)
   * @param {{adapter?, session, channel?: string, toolbar?: boolean, tools?: string[],
   *          stickers?: {name: string, svg: string}[], strings?: object,
   *          color?: string, readOnly?: boolean}} options
   */
  constructor(container, options = {}) {
    if (!options.session) {
      throw new WhiteboardError('a whiteboard needs a session (me, peers(), on(), channel())');
    }
    this.container = container;
    this.session = options.session;
    this.strings = { ...STRINGS, ...(options.strings ?? {}) };
    this.tools = (options.tools ?? ['pointer', 'pen', 'text', 'sticker', 'eraser', 'note', 'pin', 'arrow']).filter((t) => t in ICONS);
    if (!this.tools.includes('pointer')) {
      this.tools.unshift('pointer');
    }
    this.stickers = new Map(Object.entries(STICKERS));
    for (const s of options.stickers ?? []) {
      if (STICKER.test(s.name ?? '') && typeof s.svg === 'string') {
        this.stickers.set(s.name, s.svg); // the host's, never a peer's
      }
    }
    this.model = new WhiteboardModel(this.session.me.id);
    this.listeners = new Map();
    this.tool = 'pointer';
    const own = this.session.me.color;
    this.style = { color: COLOR.test(own ?? '') ? own : PALETTE[0], width: WIDTHS[1], size: SIZES[1], sticker: 'check', shape: 'square', pinShape: 'round', heads: 'end', pointerMode: 'cursor' };
    this.readOnlyFlag = !!options.readOnly;
    this.nodes = new Map(); // item id -> SVG node
    this.liveInk = new Map(); // `${peer}:${id}` -> {node, points, seq}
    this.cursors = new Map(); // peer id -> {node, x, y, timer}
    this.page = 0; // the canvas shown here; each person chooses their own
    this.pages = new Map(); // peer id -> the canvas they are on (absent: the first)
    this.showPages = options.pages !== false;
    this.cleanups = [];
    this.lastCursorSent = 0;
    this.lastPoint = null;
    this.inkSeq = 0;
    this.trails = new Map(); // `${peer}:${id}` -> laser trail {node, pts: [{x, y, t}], seq, color}
    this.emotes = new Map(); // emote id -> {name, x, y, level, born, rise, node}
    this.fxSeq = 0;
    this.lasing = null; // the laser trail being drawn here
    this.emoteWheel = null; // the emote wheel while it is open
    this.lensPower = 2.5;
    this.lensSig = ''; // what the copy of the content in the lens was made from
    // The pointer is in hand without its key or button (at the start, after a note was put down,
    // Esc...): the next press of its key only confirms it instead of going to the next mode.
    this.pointerUnchosen = true;
    // The numbered tools (1 is the first); the colour comes last and is not a tool.
    this.slots = [...this.tools, 'color'];
    this.avatar = cleanImageData(options.avatar, LIMITS.avatarChars) ?? '';
    this.avatars = new Map(); // peer id -> data URL
    this.queue = []; // peer ids waiting to speak; the first has the turn
    this.queueKey = '';
    this.turns = options.turns !== false;
    this.prepare = options.prepareFile ?? prepareFile;
    this.filePreview = options.filePreview ?? null;
    this.random = options.random ?? Math.random;
    this.selected = null;
    this.group = new Set(); // the ids of a selection of two or more items (then `selected` is null)
    this.sweeping = null; // the drag over the board that selects what it passes over
    this.groupDrag = null; // the selection being moved
    this.clipboard = null; // what was copied here last: {key, blobs} (the items go on the system clipboard)
    this.spaceHeld = false; // Space held: a drag on the board pans it (when zoomed in)
    this.threading = null;
    this.lookup = (id) => this.model.get(id);
    this.copyText = options.copyText ?? copyToClipboard;
    this.openUrl = options.openUrl ?? ((url) => window.open(url, '_blank', 'noopener,noreferrer'));
    this.files = new Map(); // item id -> Blob of the file shared with the item
    this.motion = new Map(); // item id -> {blob, url} of an animated GIF drawn from its file
    this.proxies = new Map(); // item id -> {el, img}: what a copy is dragged from
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    this.buildDom(options.toolbar !== false);
    this.setAdapter(options.adapter ?? boxAdapter(container));
    this.wireSession(options.channel ?? 'wb');
    this.wireInput();
    this.render();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** `pointer` lets input through to the page; the others draw. */
  setTool(name) {
    if (!this.tools.includes(name) || (this.readOnlyFlag && name !== 'pointer')) {
      return;
    }
    this.finishText();
    this.tool = name;
    this.closeWheel(false);
    this.showLens(null);
    this.syncBoardClass();
    this.popover.hidden = true;
    this.renderToolbar();
    this.pointerUnchosen = name === 'pointer';
    this.emit('tool', name);
    this.sendCursorAgain();
  }

  /**
   * The shortcut of the `n`th tool (1 is the first): selects it, and pressing the tool in use
   * again goes through its options (line: thin, normal, thick; text: small, medium, large;
   * sticker: each sticker). The colour is last: it only changes the colour. When the pointer was put
   * in hand by something else (the start, a note put down, Esc), its key first only confirms it.
   */
  chooseSlot(n) {
    const name = this.slots[n - 1];
    if (name === 'color') {
      this.cycle('color');
    } else if (name && this.tool !== name) {
      this.setTool(name);
      this.pointerUnchosen = false;
    } else if (name === 'pointer' && this.pointerUnchosen) {
      this.pointerUnchosen = false;
      this.flash(this.strings.pointerModeNames[this.style.pointerMode]);
    } else if (name) {
      this.cycle(name);
    }
  }

  /** @private The next option of a tool, shown for a moment. */
  cycle(what) {
    const s = this.strings;
    if (what === 'color') {
      const i = (PALETTE.indexOf(this.style.color) + 1) % PALETTE.length;
      this.setStyle({ color: PALETTE[i] });
      this.flash(`${s.color}: ${COLOR_NAMES[i]}`);
    } else if (what === 'pointer') {
      const mode = POINTER_MODES[(POINTER_MODES.indexOf(this.style.pointerMode) + 1) % POINTER_MODES.length];
      this.setStyle({ pointerMode: mode });
      this.flash(s.pointerModeNames[mode]);
    } else if (what === 'pen') {
      const i = (nearest(WIDTHS, this.style.width) + 1) % WIDTHS.length;
      this.setStyle({ width: WIDTHS[i] });
      this.flash(`${s.pen}: ${WIDTH_NAMES[i]}`);
    } else if (what === 'text') {
      const i = (nearest(SIZES, this.style.size) + 1) % SIZES.length;
      this.setStyle({ size: SIZES[i] });
      this.flash(`${s.text}: ${SIZE_NAMES[i]}`);
    } else if (what === 'note') {
      const shape = NOTE_SHAPES[(NOTE_SHAPES.indexOf(this.style.shape) + 1) % NOTE_SHAPES.length];
      this.style.shape = shape;
      this.renderToolbar();
      this.flash(`${s.shapeLabel}: ${s.shapeNames[shape]}`);
    } else if (what === 'pin') {
      const shape = PIN_SHAPES[(PIN_SHAPES.indexOf(this.style.pinShape) + 1) % PIN_SHAPES.length];
      this.style.pinShape = shape;
      this.renderToolbar();
      this.flash(`${s.shapeLabel}: ${s.pinShapeNames[shape]}`);
    } else if (what === 'arrow') {
      const heads = ARROW_HEADS[(ARROW_HEADS.indexOf(this.style.heads) + 1) % ARROW_HEADS.length];
      this.style.heads = heads;
      this.renderToolbar();
      this.flash(s.headNames[heads]);
    } else if (what === 'sticker') {
      const names = [...this.stickers.keys()];
      const next = names[(names.indexOf(this.style.sticker) + 1) % names.length];
      this.setStyle({ sticker: next });
      this.flash(`Sticker: ${next}`);
    }
  }

  /** @private A short note beside the toolbar. */
  flash(text) {
    this.hintBox.textContent = text;
    this.hintBox.hidden = false;
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => (this.hintBox.hidden = true), 1400);
  }

  /** Sets (or, with null, removes) this person's avatar: a small image data URL shown in place of the name. */
  setAvatar(data) {
    this.avatar = cleanImageData(data, LIMITS.avatarChars) ?? '';
    this.send({ t: 'avatar', data: this.avatar });
    this.renderQueue();
  }

  /** Puts this person at the end of the speaking queue (nothing if already in it). */
  requestTurn() {
    this.turnAction('join');
  }

  /** Takes this person out of the queue; when they had the turn, the next one has it. */
  endTurn() {
    this.turnAction('leave');
  }

  /** The people waiting to speak, as peer ids; the first has the turn. */
  turnQueue() {
    return [...this.queue];
  }

  /** The host only: takes someone out of the queue. */
  removeFromQueue(id) {
    if (this.session.role === 'host') {
      this.hubTurn(id, 'leave');
    }
  }

  /**
   * Pins a file on the board at (x, y) (content units) and sends it to everyone. Pictures show
   * themselves, other files a preview with their name and size.
   * @returns {Promise<string | null>} the id of the item, null if it was refused
   * @throws {WhiteboardError} when the file is empty or too large to share
   */
  async addFile(file, at = { x: 500, y: 300 }) {
    if (this.readOnlyFlag) {
      return null;
    }
    const p = await this.prepare(file, { room: LIMITS.filesTotal - this.fileTotal(), preview: this.filePreview });
    const size = p.card ? 170 : Math.max(40, Math.min(300, p.width));
    const op = this.local(() => this.model.add({ kind: 'image', x: round1(at.x), y: round1(at.y), size, ratio: Math.round((p.height / p.width) * 10000) / 10000, data: p.data, ...(p.file ? { file: p.file } : {}), ...(p.cutout && !p.card ? { cutout: true } : {}), ...turned(this.tilt()) }));
    if (!op) {
      return null;
    }
    if (p.file && p.blob) {
      this.keepFile(op.item.id, p.blob);
      this.sendFile(op.item.id, p.blob);
    } else {
      this.flash(`${p.name}: shared as a picture only (too big to send)`);
    }
    return op.item.id;
  }

  /**
   * Pins a web link on the board at (x, y) (content units): a card with its address that opens the
   * page in a new tab when clicked.
   * @returns {string | null} the id of the item, null if it was refused (read only)
   * @throws {WhiteboardError} when `url` is not a http or https address
   */
  addLink(url, at = { x: 500, y: 300 }) {
    const clean = cleanUrl(url);
    if (!clean) {
      throw new WhiteboardError('That is not a web address (http or https).');
    }
    if (this.readOnlyFlag) {
      return null;
    }
    const op = this.local(() => this.model.add({ kind: 'link', x: round1(at.x), y: round1(at.y), size: 200, url: clean, ...turned(this.tilt()) }));
    return op ? op.item.id : null;
  }

  /**
   * Pins a sticky note at (x, y) (content units) and returns its id; its paper is a pale version of
   * the current colour. Only its author edits, moves or deletes it; others can copy its text.
   * @param {{ width: number, height: number }} [size] its width and height (kept within a note's
   *   limits); then it is put straight, not turned. Without one it is the usual size, a little turned.
   * @returns {string | null} null when the board is read only
   */
  addNote(at = { x: 500, y: 300 }, text = '', size = undefined) {
    if (this.readOnlyFlag) {
      return null;
    }
    const dims = size ? noteBounds(size.width, size.height) : { size: NOTE_SIZE, ratio: 1 };
    const op = this.local(() => this.model.add({ kind: 'note', x: round1(at.x), y: round1(at.y), ...dims, text: String(text).slice(0, LIMITS.text), color: pastel(this.style.color), ...(this.style.shape === 'square' ? {} : { shape: this.style.shape }), ...(size ? {} : turned(this.tilt())) }));
    return op ? op.item.id : null;
  }

  /**
   * Pins a bare pin at (x, y) (content units), in the current colour: something to tie threads to.
   * @returns {string | null} its id, null when read only
   */
  addPin(at = { x: 500, y: 300 }) {
    if (this.readOnlyFlag) {
      return null;
    }
    const op = this.local(() => this.model.add({ kind: 'pin', x: round1(at.x), y: round1(at.y), color: this.style.color, ...(this.style.pinShape === 'round' ? {} : { shape: this.style.pinShape }), ...this.attachment(at, null) }));
    return op ? op.item.id : null;
  }

  /**
   * @private The item (a note, picture, link or sticker, the one on top) under a content point, with
   * where the point is on it: the fields of a pin put there, so it keeps its place when that item
   * moves. `except` is an item to ignore (the pin being moved). Without one, the fields that detach.
   */
  attachment(p, except) {
    const live = this.pageItems();
    for (let i = live.length - 1; i >= 0; --i) {
      const frame = live[i].id === except ? null : hostFrame(live[i]);
      const at = frame ? frameOf(frame, p) : null;
      if (at) {
        return { on: live[i].id, u: at.u, v: at.v };
      }
    }
    return { on: undefined, u: undefined, v: undefined };
  }

  /**
   * Ties a thread from the pin of the item `from` to that of `to`, in the current colour and heads.
   * @returns {string | null} its id, null when read only or when either item has no pin
   */
  addArrow(from, to) {
    if (this.readOnlyFlag || from === to || !pinPoint(this.model.get(from), this.lookup) || !pinPoint(this.model.get(to), this.lookup)) {
      return null;
    }
    const op = this.local(() => this.model.add({ kind: 'arrow', from, to, color: this.style.color, heads: this.style.heads }));
    return op ? op.item.id : null;
  }

  /** @private The item whose pin is within reach of a content point, the nearest on top; not `except`. */
  pinAt(p, except = null) {
    const scale = Math.hypot(this.matrix?.a ?? 1, this.matrix?.b ?? 0) || 1;
    const reach = 15 / scale;
    let best = null;
    let bestD = reach;
    for (const item of this.pageItems()) {
      const at = item.id === except ? null : pinPoint(item, this.lookup);
      const d = at ? Math.hypot(at.x - p.x, at.y - p.y) : Infinity;
      if (d <= bestD) {
        best = item;
        bestD = d;
      }
    }
    return best;
  }

  /** @private Copies the text of a note to the clipboard, and says so. */
  async copyNote(item) {
    this.flash((await this.copyText(item.text)) ? this.strings.noteCopied : this.strings.noteNotCopied);
  }

  /** @private A small random turn (up to 7 degrees either way) for what is pinned, as if by hand. */
  tilt() {
    return Math.round((this.random() * 2 - 1) * 70) / 10;
  }

  /** The file of an image item as {blob, name, mime}: the shared file, else its picture; null while it arrives. */
  fileOf(id) {
    const item = this.model.get(id);
    if (item?.kind !== 'image') {
      return null;
    }
    const blob = this.files.get(id);
    if (item.file) {
      return blob ? { blob, name: item.file.name, mime: item.file.mime } : null;
    }
    const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(item.data);
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[m?.[1]] ?? 'png';
    return m ? { blob: new Blob([fromBase64(m[2])], { type: m[1] }), name: `picture.${ext}`, mime: m[1] } : null;
  }

  /** Saves a file of the board in the browser's downloads. */
  downloadFile(id) {
    const f = this.fileOf(id);
    if (!f) {
      this.flash(this.strings.fileArriving);
      return;
    }
    const url = URL.createObjectURL(f.blob);
    const a = htmlEl('a', { href: url, download: f.name });
    this.root.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /** Zoom back to the whole frame (when the adapter can zoom). */
  resetZoom() {
    this.adapter.resetView?.();
  }

  /** The style of new items: {color, width, size, sticker, shape, pinShape, heads}. */
  setStyle(style) {
    if (style.color && COLOR.test(style.color)) {
      this.style.color = style.color;
    }
    for (const k of ['width', 'size']) {
      if (finite(style[k], 0.5, 400)) {
        this.style[k] = style[k];
      }
    }
    if (style.sticker && this.stickers.has(style.sticker)) {
      this.style.sticker = style.sticker;
    }
    if (NOTE_SHAPES.includes(style.shape)) {
      this.style.shape = style.shape;
    }
    if (PIN_SHAPES.includes(style.pinShape)) {
      this.style.pinShape = style.pinShape;
    }
    if (ARROW_HEADS.includes(style.heads)) {
      this.style.heads = style.heads;
    }
    if (POINTER_MODES.includes(style.pointerMode) && style.pointerMode !== this.style.pointerMode) {
      this.style.pointerMode = style.pointerMode;
      this.pointerUnchosen = false;
      this.closeWheel(false);
      this.syncBoardClass();
      this.sendCursorAgain();
      this.showLens(null);
    }
    this.renderToolbar();
  }

  /**
   * @private The classes of the board: the tool, the pointer's mode, and `active` when the board
   * takes the input (every tool but the plain cursor, which lets it through to the page).
   */
  syncBoardClass() {
    const mode = this.pointerMode();
    const active = this.tool !== 'pointer' || !PASSIVE_MODES.has(mode);
    this.board.setAttribute('class', `board ${this.tool}${mode === 'cursor' ? '' : ` ${mode}`}${active ? ' active' : ''}`);
    this.dragLayer.classList.toggle('off', active);
  }

  /** @private The mode of the pointer tool while it is in use, else `cursor`. */
  pointerMode() {
    return this.tool === 'pointer' ? this.style.pointerMode : 'cursor';
  }

  /** The overlay element (a host that replaces the container's children puts it back). */
  get element() {
    return this.host;
  }

  get readOnly() {
    return this.readOnlyFlag;
  }

  /** A read-only whiteboard shows everything and draws nothing. */
  set readOnly(on) {
    this.readOnlyFlag = !!on;
    if (this.readOnlyFlag) {
      this.setTool('pointer');
    }
    this.renderToolbar();
  }

  /** Swaps the adapter (the host's figure moved to another element). */
  setAdapter(adapter) {
    this.unadapt?.();
    this.adapter = adapter;
    this.unadapt = adapter.onChange(() => this.place());
    this.place();
  }

  undo() {
    this.local(() => this.model.undo());
  }

  redo() {
    this.local(() => this.model.redo());
  }

  /** Clears the whiteboard for everyone. */
  clear() {
    if (this.readOnlyFlag) {
      return;
    }
    if (this.model.live().every((i) => (i.page ?? 0) === this.page)) {
      this.local(() => this.model.clear());
      return;
    }
    // The other canvases keep what they have: the items of this one go one by one.
    this.removeAll(this.pageItems());
  }

  /**
   * @private Deletes the given items (quietly: not undo steps) and tells the others.
   * @returns {number} how many
   */
  removeAll(items) {
    const ops = items.map((old) => this.model.put(old, { id: old.id, author: old.author, deleted: true }, { record: false }));
    for (const op of ops) {
      this.send({ t: 'op', op });
    }
    if (ops.length > 0) {
      this.finishText(false);
      this.render();
      this.emit('change', { source: 'local' });
    }
    return ops.length;
  }

  /**
   * Takes down only the drawings (lines, texts and stickers, whoever made them) and leaves the
   * elements (notes, pins, threads, pictures, files, links) where they are.
   * @returns {number} how many were removed
   */
  clearDrawings() {
    if (this.readOnlyFlag) {
      return 0;
    }
    return this.removeAll(this.pageItems().filter((i) => i.kind === 'ink' || i.kind === 'text' || i.kind === 'sticker'));
  }

  snapshot() {
    return this.model.snapshot();
  }

  /** Merges a snapshot (it does not replace what is here) and tells the others. */
  load(snapshot) {
    const ops = this.model.merge(snapshot) ?? [];
    for (const op of ops) {
      this.send({ t: 'op', op });
    }
    this.render();
    if (ops.length) {
      this.emit('change', { source: 'load' });
    }
  }

  /** The canvas shown here (0 to {@link PAGES} - 1). */
  currentPage() {
    return this.page;
  }

  /**
   * Shows another canvas, only here: the others stay where they are, and are told so they can count
   * who is on each. A text being written is finished first.
   * @param {number} n 0 to PAGES - 1; anything else is ignored
   */
  setPage(n) {
    if (!Number.isInteger(n) || n < 0 || n >= PAGES || n === this.page) {
      return;
    }
    this.finishText();
    this.deselect();
    this.page = n;
    this.model.page = n;
    for (const key of [...this.liveInk.keys()]) {
      const [author, id] = key.split(/:(.+)/);
      this.dropLive(author, id);
    }
    this.clearFx();
    this.syncCursors();
    this.send({ t: 'pg', n });
    this.render();
    this.renderPages();
    this.sendCursorAgain();
    this.emit('page', { page: n });
  }

  /** The number of people on each canvas (this person included), as an array of {@link PAGES} numbers. */
  pageCounts() {
    const counts = new Array(PAGES).fill(0);
    const me = this.session.me.id;
    const here = new Set([me, ...this.session.peers().map((p) => p.id)]);
    for (const id of here) {
      counts[id === me ? this.page : (this.pages.get(id) ?? 0)] += 1;
    }
    return counts;
  }

  /** @private The items on the canvas shown here, oldest first. */
  pageItems() {
    return this.model.live().filter((i) => (i.page ?? 0) === this.page);
  }

  /** The live items, oldest first (for hosts: counts, notes), on every canvas. */
  items() {
    return this.model.live();
  }

  /**
   * The area saved by default, in content units: the whole frame (when the adapter has one, as
   * the video frame or the sheet), else the bounds of the items, else a 16:9 frame.
   */
  exportArea() {
    const aspect = this.adapter.aspect?.();
    if (aspect > 0) {
      return { x: 0, y: 0, width: FRAME_UNITS, height: FRAME_UNITS / aspect };
    }
    return this.contentBounds() ?? { x: 0, y: 0, width: FRAME_UNITS, height: (FRAME_UNITS * 9) / 16 };
  }

  /**
   * The items as a standalone SVG document in content units: the viewBox is `box`
   * ({x, y, width, height}) or the exported area.
   *
   * @param {{x: number, y: number, width: number, height: number}} [box]
   * @param {{background?: Record<string, string>, backdrop?: string}} [options] `background` the CSS
   *   (property to value) of a box drawn behind the items, as the board's sheet; `backdrop` a picture
   *   (a data URL) to fill the area behind them, as the video frame
   * @returns {string}
   */
  toSvg(box, options = {}) {
    const items = this.pageItems();
    const b = box ?? this.exportArea();
    const svg = svgEl('svg', { viewBox: `${b.x} ${b.y} ${b.width} ${b.height}`, width: b.width, height: b.height }); // the serializer adds the namespace
    const defs = svgEl('defs');
    for (const name of new Set(items.filter((i) => i.kind === 'sticker').map((i) => i.name))) {
      defs.append(this.symbol(name));
    }
    defs.append(this.shadowFilter());
    const style = svgEl('style');
    style.textContent = `.item text { white-space: pre; font-family: ${NOTE_FONT}; paint-order: stroke; stroke: #ffffff; stroke-width: 0.25em; stroke-linejoin: round; }`;
    svg.append(defs, style);
    if (options.background) {
      const css = Object.entries({ width: '100%', height: '100%', 'box-sizing': 'border-box', ...options.background }).map(([k, v]) => `${k}:${v}`).join(';');
      const fo = svgEl('foreignObject', { x: b.x, y: b.y, width: b.width, height: b.height });
      const div = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
      div.setAttribute('style', css);
      fo.append(div);
      svg.append(fo);
    }
    if (options.backdrop && cleanImageData(options.backdrop, Infinity)) {
      svg.append(svgEl('image', { href: options.backdrop, x: b.x, y: b.y, width: b.width, height: b.height, preserveAspectRatio: 'none' }));
    }
    const keep = [this.selected, this.editing, this.group];
    this.selected = null;
    this.editing = null;
    this.group = new Set();
    this.stills = true; // a blob address means nothing outside this page
    try {
      for (const item of items) {
        const node = this.itemNode(item);
        node.querySelectorAll('.hit, .grip, .lock').forEach((h) => h.remove()); // what only helps to use the board
        node.querySelectorAll('[data-id]').forEach((n) => n.removeAttribute('data-id'));
        node.removeAttribute('data-id');
        svg.append(node);
      }
    } finally {
      [this.selected, this.editing, this.group] = keep;
      this.stills = false;
    }
    return new XMLSerializer().serializeToString(svg);
  }

  /**
   * The board as a PNG picture (the same as {@link toSvg}), `width` pixels wide (at most 4096 high).
   * When the browser will not draw the background box into a picture it is left out.
   *
   * @param {{box?: object, background?: Record<string, string>, backdrop?: string, width?: number}} [options]
   * @returns {Promise<Blob>}
   * @throws {WhiteboardError} when the browser cannot make the picture
   */
  async toPng({ box, background, backdrop, width = 2000 } = {}) {
    const b = box ?? this.exportArea();
    const scale = Math.min(width / b.width, 4096 / b.height);
    const attempt = async (bg) => {
      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(this.toSvg(b, { background: bg, backdrop }))}`;
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('the picture could not be drawn'));
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(b.width * scale));
      canvas.height = Math.max(1, Math.round(b.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) {
        throw new Error('the picture could not be saved');
      }
      return blob;
    };
    try {
      return await attempt(background);
    } catch (first) {
      try {
        if (!background) {
          throw first;
        }
        return await attempt(undefined);
      } catch {
        throw new WhiteboardError('This browser could not make a picture of the board.');
      }
    }
  }

  /**
   * The board as a plain object to keep in a file: the items (and the files pinned on them, as
   * bytes: a Uint8Array) so a later session can pick it up with {@link loadBoard}. Files that have not arrived
   * yet, or were too big to share, are left out: their pictures stay.
   *
   * @param {object} [meta] anything the page wants back when the file is loaded (a background)
   */
  async saveBoard(meta = {}) {
    const items = this.model.live();
    const files = [];
    for (const item of items) {
      const blob = item.kind === 'image' && item.file ? this.files.get(item.id) : null;
      if (blob) {
        files.push({ id: item.id, data: await blobBytes(blob) });
      }
    }
    return { format: BOARD_FORMAT, version: 1, saved: new Date().toISOString(), meta, items, files };
  }

  /**
   * Adds the contents of a saved board to this one. Everything added is the loader's: new ids, so
   * it can be moved and changed here, and threads keep their pins. Files pinned on it are shared
   * again with everyone; a file that is missing or does not fit (the 25 MB of the board) keeps
   * only its picture. Not an undo step.
   *
   * @param {unknown} data a board file (its files as bytes, a Uint8Array)
   * @returns {Promise<{added: number, skipped: number, files: number, meta: object}>}
   * @throws {WhiteboardError} when `data` is not a board file, or the board is read only
   */
  async loadBoard(data) {
    if (this.readOnlyFlag) {
      throw new WhiteboardError('The board is locked: nothing can be added.');
    }
    if (data?.format !== BOARD_FORMAT || data.version !== 1 || !Array.isArray(data.items) || data.items.length > LIMITS.items * 2) {
      throw new WhiteboardError('That is not an inksplat board file.');
    }
    const bytes = new Map();
    for (const f of Array.isArray(data.files) ? data.files : []) {
      if (typeof f?.id === 'string' && f.data instanceof Uint8Array && f.data.length <= LIMITS.fileBytes) {
        bytes.set(f.id, f.data);
      }
    }
    const kept = data.items.map((raw) => cleanItem(raw)).filter(Boolean);
    const blobOf = (id, info) => {
      const raw = bytes.get(id);
      return raw && raw.length === info.bytes ? new Blob([raw], { type: info.mime }) : null;
    };
    const { ops, files, skipped: left } = this.placeCopies(kept, blobOf);
    const skipped = data.items.length - kept.length + left;
    this.render();
    this.emit('change', { source: 'load' });
    const added = ops.length;
    this.drip(ops, files);
    return { added, skipped, files: files.length, meta: data.meta && typeof data.meta === 'object' ? data.meta : {} };
  }

  /**
   * @private Adds copies of `kept` (clean items) as new items of this person: what sits on an
   * element, pins and threads are tied to the copies (a thread whose pins are not among them is
   * left out), the files of pictures come from `blobOf(id, file)` when it has them. Nothing is sent.
   * @param {object[]} kept
   * @param {(id: string, file: {bytes: number, mime: string}) => Blob | null} blobOf
   * @param {{dx?: number, dy?: number, page?: number, record?: boolean}} [opts] a shift, the canvas
   *   for all of them (else each keeps its own), and whether they are undo steps
   * @returns {{ops: object[], files: {id: string, blob: Blob}[], skipped: number, ids: Map<string, string>}}
   */
  placeCopies(kept, blobOf, { dx = 0, dy = 0, page = undefined, record = false } = {}) {
    const ids = new Map();
    const ops = [];
    const files = [];
    let skipped = 0;
    const place = (item) => {
      const { id, author, stamp, deleted, ...fields } = item;
      if (this.model.live().length >= LIMITS.items || (fields.kind === 'image' && this.model.live().filter((i) => i.kind === 'image').length >= LIMITS.images)) {
        skipped += 1;
        return;
      }
      if (page !== undefined) {
        fields.page = page > 0 ? page : undefined;
      }
      if (fields.kind === 'ink') {
        fields.points = fields.points.map((v, k) => round1(v + (k % 2 ? dy : dx)));
      } else if (fields.kind !== 'arrow' && finite(fields.x) && finite(fields.y)) {
        fields.x = round1(fields.x + dx);
        fields.y = round1(fields.y + dy);
      }
      let blob = null;
      if (fields.kind === 'image' && fields.file) {
        blob = blobOf(id, fields.file);
        if (blob && this.fileTotal() + files.reduce((n, f) => n + f.blob.size, 0) + blob.size > LIMITS.filesTotal) {
          blob = null;
        }
        if (!blob) {
          delete fields.file;
        }
      }
      if ((fields.kind === 'pin' || ELEMENTS.has(fields.kind)) && fields.on) {
        const on = ids.get(fields.on);
        if (on) {
          fields.on = on;
        } else {
          delete fields.on;
          delete fields.u;
          delete fields.v;
          delete fields.dr;
        }
      }
      if (fields.kind === 'arrow') {
        const from = ids.get(fields.from);
        const to = ids.get(fields.to);
        if (!from || !to) {
          skipped += 1;
          return;
        }
        Object.assign(fields, { from, to });
      }
      let mine;
      do {
        this.model.counter += 1;
        mine = `${this.model.peerId}.${this.model.counter}`;
      } while (this.model.items.has(mine));
      ids.set(id, mine);
      const op = this.model.put(null, { ...fields, id: mine, author: this.model.peerId }, { record });
      ops.push(op);
      if (blob) {
        files.push({ id: mine, blob });
        this.keepFile(mine, blob);
      }
    };
    const things = kept.filter((i) => i.kind !== 'arrow' && i.kind !== 'pin');
    const queue = [...things];
    for (let pass = 0; pass < 8 && queue.length > 0; ++pass) {
      // Whatever is on nothing, or on what is already here, then what is on those, and so on.
      const now = queue.filter((i) => !i.on || ids.has(i.on) || !things.some((o) => o.id === i.on));
      now.forEach(place);
      queue.splice(0, queue.length, ...queue.filter((i) => !now.includes(i)));
    }
    queue.forEach(place);
    kept.filter((i) => i.kind === 'pin').forEach(place);
    kept.filter((i) => i.kind === 'arrow').forEach(place);
    return { ops, files, skipped, ids };
  }

  /**
   * @private Sends the operations of a loaded board, and then its files. A host sends them at once;
   * a guest stays under the host's limit of operations a second.
   */
  drip(ops, files) {
    const batch = this.session.role === 'host' ? Infinity : 40;
    const next = () => {
      if (this.destroyed) {
        return;
      }
      for (const op of ops.splice(0, batch)) {
        this.send({ t: 'op', op });
      }
      if (ops.length > 0) {
        const timer = setTimeout(next, 1000);
        this.cleanups.push(() => clearTimeout(timer));
      } else {
        for (const f of files) {
          this.sendFile(f.id, f.blob);
        }
      }
    };
    next();
  }

  /** The drawings' bounds in content units ({x, y, width, height}), or null when there are none. */
  contentBounds() {
    const items = this.pageItems();
    return items.length ? this.bounds(items) : null;
  }

  /** "change" ({source: 'local' | 'remote' | 'load'}), "tool" (name). Returns an unsubscribe function. */
  on(event, cb) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  destroy() {
    this.finishText();
    for (const c of this.cleanups) {
      c();
    }
    this.unadapt?.();
    for (const c of this.cursors.values()) {
      clearTimeout(c.timer);
    }
    clearTimeout(this.hintTimer);
    this.clearFx();
    this.dropMotion(true);
    this.host.remove();
    this.destroyed = true;
  }

  // ── Session ──────────────────────────────────────────────────────────────

  /** @private */
  wireSession(name) {
    this.channel = this.session.channel(name);
    this.cleanups.push(
      this.channel.on('message', (m, from) => this.received(m, from)),
      // A peer joined (or this guest reached the host): swap snapshots,
      // so both sides end up with everything (DESIGN.md section 3.6).
      this.channel.on('join', (peer) => {
        this.send({ t: 'sync', snapshot: this.model.snapshot() }, { to: peer.id });
        this.sendExtras(peer.id);
      }),
      this.session.on('peers', () => this.prunePeers()),
    );
    // Made after the session opened: ask the host for what it has.
    const host = this.session.role === 'guest' ? this.session.host?.() : null;
    if (host) {
      this.send({ t: 'sync', snapshot: this.model.snapshot(), want: true }, { to: host.id });
    }
    if (this.avatar) {
      this.send({ t: 'avatar', data: this.avatar });
    }
  }

  /** @private */
  send(message, opts = {}) {
    try {
      this.channel.send(message, opts);
    } catch {
      // a closed session: the change stays local
    }
  }

  /** @private A message from a peer: validated before anything uses it. */
  received(m, from) {
    if (!m || typeof m !== 'object' || typeof from !== 'string') {
      return;
    }
    if (m.t === 'op') {
      const changed = this.model.apply(m.op);
      if (changed?.length) {
        if (m.op.t === 'put') {
          this.dropLive(m.op.item.author, m.op.item.id);
        }
        this.render();
        this.emit('change', { source: 'remote' });
      }
    } else if (m.t === 'sync') {
      if (m.want === true && this.session.role === 'host') {
        this.send({ t: 'sync', snapshot: this.model.snapshot() }, { to: from });
        this.sendExtras(from);
      }
      const before = this.model.items.size;
      const ops = this.model.merge(m.snapshot);
      if (ops?.length) {
        // The hub tells everyone else what this peer brought (a reconnect).
        if (this.session.role === 'host') {
          for (const op of ops) {
            this.send({ t: 'op', op });
          }
        }
        this.render();
        this.emit('change', { source: 'remote', added: this.model.items.size - before });
      }
    } else if (m.t === 'pg') {
      this.remotePage(from, m);
    } else if (m.t === 'cur') {
      this.remoteCursor(from, m);
    } else if (m.t === 'ink') {
      this.remoteInk(from, m);
    } else if (m.t === 'laser') {
      this.remoteLaser(from, m);
    } else if (m.t === 'emote') {
      this.remoteEmote(m);
    } else if (m.t === 'file') {
      this.remoteFile(from, m);
    } else if (m.t === 'avatar') {
      this.remoteAvatar(from, m);
    } else if (m.t === 'queue') {
      this.remoteQueue(from, m);
    } else if (m.t === 'turn') {
      this.remoteTurn(from, m);
    }
  }

  /** @private Runs a local change and sends its operation. */
  local(make) {
    let op;
    try {
      op = make();
    } catch (e) {
      if (e instanceof WhiteboardError) {
        this.emit('error', e);
        return null;
      }
      throw e;
    }
    if (op) {
      this.send({ t: 'op', op });
      this.render();
      this.emit('change', { source: 'local' });
    }
    return op;
  }

  /** @private Forget cursors and live ink of peers who left. */
  prunePeers() {
    const here = new Set(this.session.peers().map((p) => p.id));
    for (const id of this.avatars.keys()) {
      if (!here.has(id)) {
        this.avatars.delete(id);
      }
    }
    this.pruneQueue(here);
    for (const id of [...this.pages.keys()]) {
      if (!here.has(id)) {
        this.pages.delete(id);
      }
    }
    this.renderPages();
    for (const [id, c] of this.cursors) {
      if (!here.has(id)) {
        clearTimeout(c.timer);
        c.node.remove();
        this.cursors.delete(id);
      }
    }
    for (const [key, ink] of this.liveInk) {
      if (!here.has(key.split(':')[0])) {
        ink.node.remove();
        this.liveInk.delete(key);
      }
    }
    for (const [id, c] of this.cursors) {
      const p = this.session.peers().find((q) => q.id === id);
      if (p) {
        this.styleCursor(c, p);
      }
    }
    this.renderQueue();
  }

  // ── DOM ──────────────────────────────────────────────────────────────────

  /** @private */
  buildDom(withToolbar) {
    this.host = document.createElement('collab-whiteboard');
    this.host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;display:block';
    this.root = this.host.attachShadow({ mode: 'open' });
    this.root.append(htmlEl('style', {}, STYLE));
    this.board = svgEl('svg', { class: 'board' });
    this.defs = svgEl('defs');
    this.capture = svgEl('rect', { class: 'capture', x: '-50000', y: '-50000', width: '100000', height: '100000' });
    this.layer = svgEl('g', { class: 'layer', id: 'wb-layer' });
    this.itemsGroup = svgEl('g', { class: 'items' });
    this.liveGroup = svgEl('g', { class: 'live' });
    this.layer.append(this.itemsGroup, this.liveGroup);
    this.board.append(this.defs, this.capture, this.layer);
    this.cursorLayer = htmlEl('div', { class: 'cursors' });
    this.fxLayer = htmlEl('div', { class: 'fx' });
    this.lens = htmlEl('div', { class: 'lens', hidden: true, 'aria-hidden': 'true' });
    this.dragLayer = htmlEl('div', { class: 'drag' });
    this.toolbarBox = htmlEl('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Whiteboard', hidden: !withToolbar });
    this.popover = htmlEl('div', { class: 'pop', hidden: true });
    this.hintBox = htmlEl('div', { class: 'hint', hidden: true, role: 'status' });
    this.selbar = htmlEl('div', { class: 'selbar', role: 'toolbar', 'aria-label': 'Selected item', hidden: true });
    this.queueBox = htmlEl('div', { class: 'queue', role: 'group', 'aria-label': this.strings.queue, hidden: !this.turns });
    this.pagesBox = htmlEl('div', { class: 'pages', role: 'group', 'aria-label': this.strings.canvases, hidden: !this.showPages });
    this.root.append(this.board, this.dragLayer, this.fxLayer, this.cursorLayer, this.lens, this.toolbarBox, this.popover, this.selbar, this.hintBox, this.queueBox, this.pagesBox);
    this.container.append(this.host);
    this.defs.append(this.shadowFilter());
    for (const [name, svg] of this.stickers) {
      this.defs.append(this.symbol(name, svg));
    }
    this.renderToolbar();
    this.renderQueue();
    this.renderPages();
  }

  /** @private The buttons that choose the canvas, each with the number of people on it. */
  renderPages() {
    if (!this.pagesBox || !this.showPages) {
      return;
    }
    const counts = this.pageCounts();
    const key = `${this.page}|${counts.join(',')}`;
    if (key === this.pagesKey) {
      return;
    }
    this.pagesKey = key;
    const s = this.strings;
    this.pagesBox.replaceChildren(
      ...counts.map((count, n) => {
        const b = htmlEl('button', { type: 'button', 'aria-current': String(n === this.page), title: `${s.canvas} ${n + 1}${count ? ` \u00b7 ${count} ${s.peopleHere}` : ''}`, 'aria-label': `${s.canvas} ${n + 1}, ${count} ${s.peopleHere}` });
        b.append(String(n + 1));
        b.addEventListener('click', () => this.setPage(n));
        const cell = htmlEl('span', { class: 'cell' });
        cell.append(b);
        if (count > 0) {
          const badge = htmlEl('span', { class: 'n', 'aria-hidden': 'true' });
          badge.textContent = String(count);
          cell.append(badge);
        }
        return cell;
      }),
    );
  }

  /** @private The soft shadow of the pinned pictures. */
  shadowFilter() {
    const f = svgEl('filter', { id: 'wb-shadow', x: '-20%', y: '-20%', width: '140%', height: '150%' });
    f.append(svgEl('feDropShadow', { dx: 2, dy: 4, stdDeviation: 3.5, 'flood-color': '#000000', 'flood-opacity': 0.38 }));
    return f;
  }

  /** @private A sticker as a <symbol id="sticker-name">. */
  symbol(name, svg = this.stickers.get(name) ?? PLACEHOLDER) {
    const s = svgEl('symbol', { id: `sticker-${name}`, viewBox: '0 0 24 24' });
    s.innerHTML = svg;
    return s;
  }

  /** @private */
  renderToolbar() {
    if (!this.toolbarBox || this.toolbarBox.hidden) {
      return;
    }
    const s = this.strings;
    const button = (label, title, icon, key, opts = {}) => {
      const b = htmlEl('button', { type: 'button', title, 'aria-label': label, 'aria-keyshortcuts': key, 'data-key': key, 'aria-pressed': opts.pressed === undefined ? undefined : String(opts.pressed), disabled: opts.disabled }, icon);
      b.addEventListener('click', opts.run);
      return b;
    };
    const parts = [];
    this.tools.forEach((t, i) => {
      parts.push(
        button(s[t], `${s[t]} (${i + 1})`, `<svg viewBox="0 0 24 24">${this.toolIcon(t)}</svg>`, String(i + 1), {
          pressed: this.tool === t,
          disabled: this.readOnlyFlag && t !== 'pointer',
          run: () => {
            // A tool with options opens their panel (the number key goes through them); the others just select.
            if (this.tool !== t) {
              this.setTool(t);
            }
            this.pointerUnchosen = false;
            if (this.optionsOf(t).length > 0) {
              this.togglePopover(t);
            }
          },
        }),
      );
    });
    if (this.readOnlyFlag) {
      parts.push(htmlEl('div', { class: 'locked' }, ''));
      parts[parts.length - 1].textContent = s.readOnly;
    } else {
      parts.push(htmlEl('hr'));
      const n = this.slots.length;
      parts.push(button(s.color, `${s.color} (${n})`, `<span class="swatch" style="background:${this.style.color}"></span>`, String(n), { run: () => this.togglePopover('color') }));
      parts.push(button(s.undo, s.undo, `<svg viewBox="0 0 24 24">${ICONS.undo}</svg>`, undefined, { disabled: !this.model.undoStack.length, run: () => this.undo() }));
      parts.push(button(s.redo, s.redo, `<svg viewBox="0 0 24 24">${ICONS.redo}</svg>`, undefined, { disabled: !this.model.redoStack.length, run: () => this.redo() }));
    }
    this.toolbarBox.replaceChildren(...parts);
  }

  /** @private A tool's icon; the pen, the text and the sticker show the option in use. */
  toolIcon(t) {
    if (t === 'pointer') {
      return MODE_ICONS[this.style.pointerMode] ?? ICONS.pointer;
    }
    if (t === 'pen') {
      const w = [1, 2.5, 4][nearest(WIDTHS, this.style.width)];
      return `${ICONS.pen}<path d="M5 22h14" stroke="currentColor" stroke-width="${w}" stroke-linecap="round"/>`;
    }
    if (t === 'text') {
      const size = [12, 16, 21][nearest(SIZES, this.style.size)];
      return `<text x="12" y="${12 + size * 0.35}" font-size="${size}" font-weight="700" text-anchor="middle" fill="currentColor" font-family="system-ui, sans-serif">A</text>`;
    }
    if (t === 'note') {
      const el = shapeElement(this.style.shape, 4, 4, 16, 16, { fill: pastel(this.style.color), stroke: 'currentColor', 'stroke-width': 1.8 });
      return el.outerHTML;
    }
    if (t === 'pin') {
      return `${pinHead(this.style.pinShape, 12, 9, 5, { fill: 'currentColor' }).outerHTML}<path d="M12 15v7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
    }
    if (t === 'arrow') {
      // The thread of the icon, and a filled head at an end, turned along the curve there.
      const h = this.style.heads;
      const A = { x: 4, y: 17 };
      const C = { x: 12, y: 17 };
      const B = { x: 20, y: 7 };
      const dot = (p) => `<circle cx="${p.x}" cy="${p.y}" r="2" fill="currentColor"/>`;
      const head = (tip, from) => {
        const len = Math.hypot(tip.x - from.x, tip.y - from.y);
        const ux = (tip.x - from.x) / len;
        const uy = (tip.y - from.y) / len;
        const bx = tip.x - ux * 6;
        const by = tip.y - uy * 6;
        const pts = [tip, { x: bx - uy * 3, y: by + ux * 3 }, { x: bx + uy * 3, y: by - ux * 3 }];
        return `<polygon points="${pts.map((p) => `${round1(p.x)},${round1(p.y)}`).join(' ')}" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>`;
      };
      return `<path d="M${A.x} ${A.y}Q${C.x} ${C.y} ${B.x} ${B.y}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>${h === 'start' || h === 'both' ? head(A, C) : dot(A)}${h === 'end' || h === 'both' ? head(B, C) : dot(B)}`;
    }
    if (t === 'sticker') {
      return `<use href="#sticker-${this.style.sticker}" x="1" y="1" width="22" height="22"/>`;
    }
    return ICONS[t];
  }

  /**
   * @private The options of a tool, for its panel: {label, icon (SVG inner), pressed, run}. Only
   * tools that have some are listed (the pointer's modes, the pen, text, stickers, notes, pins and
   * threads) and the colour.
   */
  optionsOf(kind) {
    const s = this.strings;
    const style = this.style;
    if (kind === 'color') {
      return PALETTE.map((c, i) => ({ label: `${s.color}: ${COLOR_NAMES[i]}`, swatch: c, pressed: c === style.color, run: () => this.setStyle({ color: c }) }));
    }
    if (kind === 'pointer') {
      return POINTER_MODES.map((mode) => ({ label: s.pointerModeNames[mode], icon: MODE_ICONS[mode] ?? ICONS.pointer, pressed: style.pointerMode === mode, run: () => this.setStyle({ pointerMode: mode }) }));
    }
    if (kind === 'pen') {
      return WIDTHS.map((w, i) => ({ label: `${s.pen}: ${WIDTH_NAMES[i]}`, icon: `<path d="M4 12h16" stroke="currentColor" stroke-width="${[1.5, 3, 5.5][i]}" stroke-linecap="round"/>`, pressed: nearest(WIDTHS, style.width) === i, run: () => this.setStyle({ width: w }) }));
    }
    if (kind === 'text') {
      return SIZES.map((size, i) => ({ label: `${s.text}: ${SIZE_NAMES[i]}`, icon: `<text x="12" y="${12 + [12, 16, 21][i] * 0.35}" font-size="${[12, 16, 21][i]}" font-weight="700" text-anchor="middle" fill="currentColor" font-family="system-ui, sans-serif">A</text>`, pressed: nearest(SIZES, style.size) === i, run: () => this.setStyle({ size }) }));
    }
    if (kind === 'sticker') {
      return [...this.stickers.keys()].map((name) => ({ label: name, icon: `<use href="#sticker-${name}"/>`, pressed: name === style.sticker, run: () => this.setStyle({ sticker: name }) }));
    }
    if (kind === 'note') {
      return NOTE_SHAPES.map((shape) => ({ label: `${s.shapeLabel}: ${s.shapeNames[shape]}`, icon: shapeElement(shape, 3, 4, 18, 16, { fill: pastel(style.color), stroke: 'currentColor', 'stroke-width': 1.8 }).outerHTML, pressed: style.shape === shape, run: () => this.setStyle({ shape }) }));
    }
    if (kind === 'pin') {
      return PIN_SHAPES.map((shape) => ({ label: `${s.shapeLabel}: ${s.pinShapeNames[shape]}`, icon: pinHead(shape, 12, 12, 7, { fill: style.color, stroke: 'currentColor', 'stroke-width': 1.6 }).outerHTML, pressed: style.pinShape === shape, run: () => this.setStyle({ pinShape: shape }) }));
    }
    if (kind === 'arrow') {
      return ARROW_HEADS.map((heads) => {
        const saved = style.heads;
        style.heads = heads;
        const icon = this.toolIcon('arrow');
        style.heads = saved;
        return { label: s.headNames[heads], icon, pressed: saved === heads, run: () => this.setStyle({ heads }) };
      });
    }
    return [];
  }

  /** @private The panel with the options of a tool (or the colours) beside the toolbar; again closes it. */
  togglePopover(kind) {
    if (!this.popover.hidden && this.popover.dataset.kind === kind) {
      this.popover.hidden = true;
      return;
    }
    this.popover.dataset.kind = kind;
    const items = this.optionsOf(kind).map((o) => {
      const inner = o.swatch ? `<span class="swatch" style="background:${o.swatch}"></span>` : `<svg viewBox="0 0 24 24" width="24" height="24">${o.icon}</svg>`;
      const b = htmlEl('button', { type: 'button', 'aria-label': o.label, title: o.label, 'aria-pressed': String(o.pressed) }, inner);
      b.addEventListener('click', () => {
        o.run();
        this.popover.hidden = true;
      });
      return b;
    });
    this.popover.replaceChildren(...items);
    this.popover.style.gridTemplateColumns = `repeat(${items.length <= 5 ? items.length : 4}, 34px)`;
    const at = kind === 'color' ? this.toolbarBox.querySelector('[aria-label="' + this.strings.color + '"]') : this.toolbarBox.children[this.tools.indexOf(kind)];
    this.popover.style.top = `${this.toolbarBox.offsetTop + (at?.offsetTop ?? 0)}px`;
    this.popover.hidden = false;
  }

  /** @private The adapter's transform on the drawing layer, and the cursors. */
  place() {
    const t = this.adapter.transform() ?? { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    this.matrix = t;
    // The adapter says the content is not shown now (an editor's data tab).
    this.host.style.display = t.hidden ? 'none' : 'block';
    if (t.hidden && this.tool !== 'pointer') {
      this.setTool('pointer');
    }
    this.layer.setAttribute('transform', `matrix(${t.a} ${t.b} ${t.c} ${t.d} ${t.e} ${t.f})`);
    // Drawings and cursors only inside the adapter's clip rectangle, if any.
    const clip = this.adapter.clip?.() ?? null;
    let path = '';
    if (clip) {
      const r = this.host.getBoundingClientRect();
      const right = Math.max(0, r.width - clip.x - clip.width);
      const bottom = Math.max(0, r.height - clip.y - clip.height);
      path = `inset(${Math.max(0, clip.y)}px ${right}px ${bottom}px ${Math.max(0, clip.x)}px)`;
    }
    this.board.style.clipPath = path;
    this.cursorLayer.style.clipPath = path;
    if (this.lensAt) {
      this.showLens(this.lensAt);
    }
    this.dragLayer.style.clipPath = path;
    // The toolbar sits at the side of the area the chart is shown in (the
    // window's edge, below an editor's tab bar), never over the chart.
    const left = Math.round(clip ? Math.max(0, clip.x) : 0) + 8;
    const top = Math.round(clip ? Math.max(0, clip.y) : 0) + 8;
    this.toolbarBox.style.left = `${left}px`;
    this.toolbarBox.style.top = `${top}px`;
    this.popover.style.left = `${left + 44}px`;
    this.hintBox.style.left = `${left + 44}px`;
    this.hintBox.style.top = `${top + 6}px`;
    for (const c of this.cursors.values()) {
      this.moveCursor(c);
    }
    this.placeProxies();
    this.placeSelbar();
    if (this.editing) {
      this.placeTextarea();
    }
  }

  /** @private Element-box CSS pixels to content units. */
  toContent(x, y) {
    const { a, b, c, d, e, f } = this.matrix;
    const det = a * d - b * c || 1;
    const px = x - e;
    const py = y - f;
    return { x: (d * px - c * py) / det, y: (a * py - b * px) / det };
  }

  /** @private Content units to element-box CSS pixels. */
  toBox(x, y) {
    const { a, b, c, d, e, f } = this.matrix;
    return { x: a * x + c * y + e, y: b * x + d * y + f };
  }

  /** @private Pointer event to content units. */
  eventPoint(ev) {
    const r = this.host.getBoundingClientRect();
    return this.toContent(ev.clientX - r.left, ev.clientY - r.top);
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  /** @private Redraws the items that changed (by comparing stamps). */
  render() {
    if (this.destroyed) {
      return;
    }
    const all = this.pageItems();
    const things = all.filter((i) => i.kind !== 'arrow' && i.kind !== 'pin');
    const byId = new Map(things.map((i) => [i.id, i]));
    const ordered = [];
    const placed = new Set();
    const place = (i, depth = 0) => {
      if (placed.has(i.id) || depth > 8) {
        return;
      }
      placed.add(i.id);
      const host = i.on ? byId.get(i.on) : null;
      if (host) {
        place(host, depth + 1); // what is on an element is drawn after it
      }
      ordered.push(i);
    };
    things.forEach((i) => place(i));
    const live = [...ordered, ...all.filter((i) => i.kind === 'arrow'), ...all.filter((i) => i.kind === 'pin')];
    const seen = new Set();
    let previous = null;
    for (const item of live) {
      seen.add(item.id);
      let entry = this.nodes.get(item.id);
      const sig = this.signature(item);
      if (!entry || entry.sig !== sig) {
        const node = this.itemNode(item);
        if (entry) {
          entry.node.replaceWith(node);
        }
        entry = { node, sig };
        this.nodes.set(item.id, entry);
      }
      // Drawing order: oldest stamp first.
      const want = previous ? previous.nextSibling : this.itemsGroup.firstChild;
      if (want !== entry.node) {
        this.itemsGroup.insertBefore(entry.node, want);
      }
      previous = entry.node;
    }
    for (const [id, entry] of this.nodes) {
      if (!seen.has(id)) {
        entry.node.remove();
        this.nodes.delete(id);
      }
    }
    if (this.selected && !seen.has(this.selected)) {
      this.selected = null;
    }
    if (this.group.size > 0 && [...this.group].some((id) => !seen.has(id))) {
      const left = [...this.group].filter((id) => seen.has(id));
      this.group = new Set(left.length > 1 ? left : []);
      if (left.length === 1) {
        this.selected = left[0];
        this.nodes.get(left[0])?.node.classList.add('selected');
      }
    }
    this.dropLooseThreads(all);
    this.renderSelbar();
    for (const id of this.files.keys()) {
      const item = this.model.items.get(id);
      if (!item || (item.deleted && item.author !== this.model.peerId)) {
        this.files.delete(id);
      }
    }
    this.dropMotion();
    this.syncProxies();
    this.renderToolbar();
  }

  /** @private What a node was drawn from: the item's stamp, and for a pin that of what it is on, for a thread those of its pins; and whether it is selected. */
  signature(item) {
    const st = (i) => (i ? `${i.stamp[0]}.${i.stamp[1]}` : '-');
    const pinned = (i) => (i?.kind === 'pin' && i.on ? `${st(i)}@${st(this.model.get(i.on))}` : st(i));
    const moving = item.kind === 'image' && this.motion.has(item.id) ? '|gif' : '';
    return `${pinned(item)}|${item.kind === 'arrow' ? `${pinned(this.model.get(item.from))}|${pinned(this.model.get(item.to))}` : ''}${moving}`;
  }

  /** @private Threads of yours whose pin is gone, and pins of yours whose item is gone, are taken down (quietly: not an undo step). */
  dropLooseThreads(live) {
    const gone = (i) => (i.kind === 'arrow' && (!this.model.get(i.from) || !this.model.get(i.to))) || (i.kind === 'pin' && i.on && !this.model.get(i.on));
    const loose = live.filter((i) => i.author === this.model.peerId && !i.lock && gone(i));
    if (loose.length > 0) {
      queueMicrotask(() => {
        for (const t of loose) {
          const old = this.model.get(t.id);
          if (old && gone(old)) {
            this.local(() => this.model.put(old, { id: old.id, author: old.author, deleted: true }, { record: false }));
          }
        }
      });
    }
  }

  /**
   * @private Every picture gets an invisible HTML box over it that the browser can drag out as a
   * copy (an SVG image cannot be dragged). It takes the pointer only while Shift is held, so a plain
   * drag moves the picture like any other element and Shift+drag copies it out.
   */
  syncProxies() {
    const want = new Map(this.pageItems().filter((i) => i.kind === 'image').map((i) => [i.id, i]));
    for (const [id, entry] of this.proxies) {
      if (!want.has(id)) {
        entry.el.remove();
        this.proxies.delete(id);
      }
    }
    for (const [id, item] of want) {
      let entry = this.proxies.get(id);
      if (!entry) {
        const el = htmlEl('div', { class: 'proxy', draggable: 'true' });
        const img = new Image();
        img.src = item.data;
        entry = { el, img };
        el.addEventListener('dragstart', (ev) => this.dragOut(id, ev));
        el.addEventListener('dblclick', () => this.downloadFile(id));
        this.dragLayer.append(el);
        this.proxies.set(id, entry);
      }
      entry.el.title = `${item.file?.name ?? 'Picture'}: ${this.strings.dragFile}`;
    }
    this.placeProxies();
  }

  /** @private Puts each proxy over its picture. */
  placeProxies() {
    const scale = Math.hypot(this.matrix?.a ?? 1, this.matrix?.b ?? 0) || 1;
    for (const [id, entry] of this.proxies) {
      const item = this.model.get(id);
      if (!item) {
        continue;
      }
      const w = (item.size + 12) * scale;
      const h = (item.size * item.ratio + 12) * scale;
      const p = this.toBox(centre(item).x, centre(item).y);
      entry.el.style.width = `${w}px`;
      entry.el.style.height = `${h}px`;
      entry.el.style.transform = `translate(${p.x - w / 2}px, ${p.y - h / 2}px) rotate(${item.rot ?? 0}deg)`;
    }
  }

  /** @private Starts dragging a copy of a picture or file out of the board. */
  dragOut(id, ev) {
    const f = this.fileOf(id);
    const dt = ev.dataTransfer;
    if (!f || !dt) {
      ev.preventDefault();
      this.flash(this.strings.fileArriving);
      return;
    }
    dt.effectAllowed = 'copy';
    try {
      dt.items.add(new File([f.blob], f.name, { type: f.mime })); // for pages and apps that take files
    } catch {
      // not supported
    }
    try {
      const url = URL.createObjectURL(f.blob);
      dt.setData('DownloadURL', `${f.mime}:${f.name}:${url}`); // for the desktop and folders (Chromium)
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      // not supported
    }
    const entry = this.proxies.get(id);
    if (entry?.img.complete) {
      try {
        dt.setDragImage(entry.img, entry.img.width / 2, entry.img.height / 2);
      } catch {
        // the browser picks the image
      }
    }
  }

  /**
   * @private The thread of an arrow, a physical object: hangs between two pins, with a soft shadow,
   * and a head at either end when asked. `resolve` finds the items it is tied to (a preview moves them).
   */
  threadNode(item, g, resolve) {
    const a = pinPoint(resolve(item.from), resolve);
    const b = pinPoint(resolve(item.to), resolve);
    if (!a || !b) {
      return;
    }
    const seed = [...item.id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 1000, 7) / 1000;
    const { c, d } = threadCurve(a, b, seed);
    const heads = [];
    const head = (tip, from) => {
      const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
      const ux = (tip.x - from.x) / len;
      const uy = (tip.y - from.y) / len;
      const bx = tip.x - ux * PIN_RADIUS * 1.25;
      const by = tip.y - uy * PIN_RADIUS * 1.25;
      const tx = bx - ux * 13;
      const ty = by - uy * 13;
      heads.push(svgEl('polygon', { points: `${round1(bx)},${round1(by)} ${round1(tx - uy * 5.5)},${round1(ty + ux * 5.5)} ${round1(tx + uy * 5.5)},${round1(ty - ux * 5.5)}`, fill: item.color, stroke: 'rgba(0,0,0,0.35)', 'stroke-width': 0.6, 'stroke-linejoin': 'round' }));
    };
    if (item.heads === 'end' || item.heads === 'both') {
      head(b, c);
    }
    if (item.heads === 'start' || item.heads === 'both') {
      head(a, c);
    }
    const thread = svgEl('g', { filter: 'url(#wb-shadow)' });
    thread.append(svgEl('path', { class: 'paper', d, fill: 'none', stroke: item.color, 'stroke-width': 2.6, 'stroke-linecap': 'round' }), ...heads);
    g.append(svgEl('path', { class: 'hit', d, fill: 'none', stroke: 'transparent', 'stroke-width': 14, 'stroke-linecap': 'round' }), thread);
    if (item.lock) {
      g.append(lockBadge((a.x + 2 * c.x + b.x) / 4, (a.y + 2 * c.y + b.y) / 4 - 4, item.lock));
    }
  }

  /**
   * @private A print pinned on the board around `content`: border, pin, and a shadow that stays put
   * when turned. A null `paper` draws no border (the content brings its own, as a cutout does).
   */
  printNode(item, h, turn, content, paper = '#ffffff', shape = 'square') {
    const { pad, r, y: py, head } = pinMetrics(item, h);
    const left = item.x - item.size / 2;
    const top = item.y - h / 2;
    const print = svgEl('g', { ...turn });
    const pin = svgEl('g', { class: 'pin', 'data-id': item.id });
    if (item.lock) {
      content = [...content, lockBadge(left - pad + 8, top - pad + 4, item.lock)];
    }
    if (paper !== null) {
      print.append(shapeElement(shape, left - pad, top - pad, item.size + 2 * pad, h + 2 * pad, { class: 'paper', fill: paper, stroke: 'rgba(0,0,0,0.25)', 'stroke-width': 0.75 }));
    }
    print.append(...content);
    pin.append(
      svgEl('circle', { class: 'hit box', cx: item.x, cy: py, r, fill: 'transparent' }),
      svgEl('ellipse', { cx: item.x + head * 0.9, cy: py + head * 1.4, rx: head * 0.95, ry: head * 0.6, fill: 'rgba(0,0,0,0.3)' }),
      svgEl('circle', { cx: item.x, cy: py, r: head, fill: pinColor(item.id), stroke: 'rgba(0,0,0,0.4)', 'stroke-width': 0.6 }),
      svgEl('circle', { cx: item.x - head * 0.3, cy: py - head * 0.32, r: head * 0.3, fill: 'rgba(255,255,255,0.6)' }),
    );
    print.append(pin);
    const shadow = svgEl('g', { filter: 'url(#wb-shadow)' });
    shadow.append(print);
    return shadow;
  }

  /** @private One item's SVG. Text goes in as textContent only. */
  itemNode(item, resolve = (id) => this.model.get(id)) {
    const own = item.author === this.model.peerId ? ' own' : '';
    const g = svgEl('g', { class: `item ${item.kind}-item${own}${item.id === this.selected || this.group.has(item.id) ? ' selected' : ''}${this.editing?.item?.id === item.id && this.editing.note ? ' editing' : ''}`, 'data-id': item.id });
    const turn = item.rot ? { transform: `rotate(${item.rot} ${item.x} ${item.y + pinOffset(item)})` } : {};
    if (item.kind === 'ink') {
      const d = inkPath(item.points);
      g.append(
        svgEl('path', { class: 'hit', d, fill: 'none', stroke: 'transparent', 'stroke-width': item.width + 10, 'stroke-linecap': 'round' }),
        svgEl('path', { d, fill: 'none', stroke: item.color, 'stroke-width': item.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      );
    } else if (item.kind === 'text') {
      const text = svgEl('text', { x: item.x, y: item.y, 'font-size': item.size, fill: item.color, 'dominant-baseline': 'hanging' });
      if (item.color.toLowerCase() === '#ffffff') {
        text.style.stroke = '#1c2024';
      }
      item.text.split('\n').forEach((line, i) => {
        const span = svgEl('tspan', { x: item.x, dy: i === 0 ? 0 : '1.2em' });
        span.textContent = line || ' ';
        text.append(span);
      });
      g.append(text);
    } else if (item.kind === 'image') {
      // A print pinned on the board: a white border, a shadow that stays put when it is turned, a pin.
      const h = item.size * item.ratio;
      const left = item.x - item.size / 2;
      const top = item.y - h / 2;
      const grip = this.canEdit(item) ? [gripNode(item)] : [];
      const tip = svgEl('title');
      tip.textContent = `${item.file?.name ?? 'Picture'}: ${this.strings.dragFile}`;
      const picture = svgEl('image', { href: this.pictureHref(item), x: left, y: top, width: item.size, height: h, preserveAspectRatio: 'none' });
      if (item.cutout) {
        // A cutout: the border and the shadow go around what shows, not around the rectangle.
        const { pad } = pinMetrics(item, h);
        const filter = cutoutFilter(`wb-cut-${item.id}`, left, top, item.size, h, pad);
        picture.setAttribute('filter', `url(#${filter.id})`);
        const hit = svgEl('rect', { class: 'hit box', x: left - pad, y: top - pad, width: item.size + 2 * pad, height: h + 2 * pad, fill: 'transparent' }); // grabbed anywhere, as a print
        g.append(this.printNode(item, h, turn, [hit, filter, picture, ...grip, tip], null));
      } else {
        g.append(this.printNode(item, h, turn, [picture, ...grip, tip]));
      }
    } else if (item.kind === 'pin') {
      const at = pinPoint(item, resolve);
      const shadow = svgEl('g', { filter: 'url(#wb-shadow)' });
      shadow.append(
        svgEl('ellipse', { cx: at.x + 2, cy: at.y + 3, rx: PIN_RADIUS * 0.95, ry: PIN_RADIUS * 0.6, fill: 'rgba(0,0,0,0.3)' }),
        pinHead(item.shape ?? 'round', at.x, at.y, PIN_RADIUS, { class: 'paper', fill: item.color, stroke: 'rgba(0,0,0,0.4)', 'stroke-width': 0.6 }),
        svgEl('circle', { cx: at.x - PIN_RADIUS * 0.3, cy: at.y - PIN_RADIUS * 0.32, r: PIN_RADIUS * 0.3, fill: 'rgba(255,255,255,0.6)' }),
      );
      g.append(svgEl('circle', { class: 'hit box', cx: at.x, cy: at.y, r: PIN_HIT, fill: 'transparent' }), shadow);
      if (item.lock) {
        g.append(lockBadge(at.x + 8, at.y - 10, item.lock));
      }
    } else if (item.kind === 'arrow') {
      this.threadNode(item, g, resolve);
    } else if (item.kind === 'note') {
      const w = item.size;
      const h = w * item.ratio;
      const left = item.x - w / 2;
      const top = item.y - h / 2;
      const shape = item.shape ?? 'square';
      const font = noteFont(item);
      const lines = wrapNote(item.text, noteTextWidth(item), font);
      const body = svgEl('svg', { x: left, y: top, width: w, height: h, overflow: 'hidden' });
      const text = svgEl('text', { x: w / 2, y: noteTextTop(item, lines.length) + (NOTE_HANG * font) / NOTE_TEXT, 'font-size': font, fill: '#1c2024', 'text-anchor': 'middle', 'dominant-baseline': 'hanging', 'font-family': NOTE_FONT });
      text.style.stroke = 'none'; // not the halo of text notes
      lines.forEach((line, i) => {
        const span = svgEl('tspan', { x: w / 2, dy: i === 0 ? 0 : font * 1.25 });
        span.textContent = line || ' ';
        text.append(span);
      });
      body.append(text);
      const grip = this.canEdit(item) ? [gripNode(item)] : [];
      g.append(this.printNode(item, h, turn, [body, ...grip], item.color, shape));
    } else if (item.kind === 'link') {
      // A card of the page's address, drawn here from the link itself (not from a picture the sender made).
      const u = new URL(item.url);
      const w = item.size;
      const h = w * 0.5;
      const left = item.x - w / 2;
      const top = item.y - h / 2;
      let hue = 0;
      for (const ch of u.hostname) {
        hue = (hue * 31 + ch.charCodeAt(0)) % 360;
      }
      const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}\u2026` : text);
      const label = (str, x, y, size, fill, weight) => {
        const t = svgEl('text', { x, y, 'font-size': size, fill, 'font-weight': weight, 'font-family': 'system-ui, -apple-system, "Segoe UI", sans-serif' });
        t.style.stroke = 'none'; // not the halo of text notes
        t.textContent = str;
        return t;
      };
      const path = decodeSafe(u.pathname + u.search) || '/';
      const title = svgEl('title');
      title.textContent = item.url;
      const gx = left + w * 0.09;
      const gy = top + h * 0.17;
      const parts = [
        svgEl('rect', { x: left, y: top, width: w, height: h * 0.34, fill: `hsl(${hue} 55% 42%)` }),
        svgEl('circle', { cx: gx, cy: gy, r: h * 0.11, fill: 'none', stroke: '#ffffff', 'stroke-width': w * 0.01 }),
        svgEl('ellipse', { cx: gx, cy: gy, rx: h * 0.05, ry: h * 0.11, fill: 'none', stroke: '#ffffff', 'stroke-width': w * 0.008 }),
        svgEl('path', { d: `M${gx - h * 0.11} ${gy}h${h * 0.22}`, fill: 'none', stroke: '#ffffff', 'stroke-width': w * 0.008 }),
        label(fit(u.hostname.replace(/^www\./, ''), 26), left + w * 0.2, top + h * 0.215, w * 0.062, '#ffffff', 700),
        label(fit(path, 34), left + w * 0.06, top + h * 0.6, w * 0.054, '#2b2f36', 400),
        label(u.protocol === 'http:' ? 'http \u00b7 not encrypted' : 'Click to open', left + w * 0.06, top + h * 0.88, w * 0.045, '#60646c', 400),
        title,
      ];
      g.append(this.printNode(item, h, turn, parts));
    } else {
      const known = this.stickers.has(item.name);
      if (!known && !this.defs.querySelector(`#sticker-${item.name}`)) {
        this.defs.append(this.symbol(item.name, PLACEHOLDER));
      }
      // The whole square catches the pointer, not just the drawn strokes: WebKit (iPad) does not
      // reliably hit-test the inside of a <use>, so the eraser, selection and dragging missed it.
      const box = { x: item.x - item.size / 2, y: item.y - item.size / 2, width: item.size, height: item.size, ...turn };
      g.append(svgEl('rect', { class: 'hit box', ...box, fill: 'transparent' }), svgEl('use', { href: `#sticker-${item.name}`, ...box, 'pointer-events': 'none' }));
    }
    return g;
  }

  /** @private The items' bounds in content units, with a margin. */
  bounds(items) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const add = (x, y, pad) => {
      x0 = Math.min(x0, x - pad);
      y0 = Math.min(y0, y - pad);
      x1 = Math.max(x1, x + pad);
      y1 = Math.max(y1, y + pad);
    };
    for (const i of items) {
      if (i.kind === 'ink') {
        for (let k = 0; k < i.points.length; k += 2) {
          add(i.points[k], i.points[k + 1], i.width);
        }
      } else if (i.kind === 'text') {
        const lines = i.text.split('\n');
        add(i.x, i.y, 0);
        add(i.x + Math.max(...lines.map((l) => l.length)) * i.size * 0.6, i.y + lines.length * i.size * 1.2, 0);
      } else if (i.kind === 'image') {
        add(centre(i).x, centre(i).y, (i.size * Math.max(1, i.ratio)) / 2);
      } else if (i.kind === 'link') {
        add(centre(i).x, centre(i).y, i.size / 2);
      } else if (i.kind === 'note') {
        add(centre(i).x, centre(i).y, (i.size * Math.max(1, i.ratio)) / 2);
      } else if (i.kind === 'pin') {
        const at = pinPoint(i, this.lookup);
        add(at.x, at.y, PIN_RADIUS + 2);
      } else if (i.kind === 'arrow') {
        const a = pinPoint(this.model.get(i.from), this.lookup);
        const b = pinPoint(this.model.get(i.to), this.lookup);
        if (a && b) {
          add(a.x, a.y, 0);
          add(b.x, b.y, 0);
          add((a.x + b.x) / 2, (a.y + b.y) / 2 + 40, 0);
        }
      } else {
        add(i.x, i.y, i.size / 2);
      }
    }
    if (!Number.isFinite(x0)) {
      return { x: 0, y: 0, width: 1, height: 1 };
    }
    return { x: x0 - 4, y: y0 - 4, width: x1 - x0 + 8, height: y1 - y0 + 8 };
  }

  // ── Cursors and live ink ─────────────────────────────────────────────────

  /** @private */
  remoteCursor(from, m) {
    let c = this.cursors.get(from);
    if (m.hide === true) {
      if (c) {
        c.node.hidden = true;
      }
      return;
    }
    if (!finite(m.x) || !finite(m.y)) {
      return;
    }
    if (Number.isInteger(m.pg) && m.pg >= 0 && m.pg < PAGES && (this.pages.get(from) ?? 0) !== m.pg) {
      this.remotePage(from, { n: m.pg });
    }
    if ((this.pages.get(from) ?? 0) !== this.page) {
      if (c) {
        c.node.hidden = true;
      }
      return;
    }
    const peer = this.session.peers().find((p) => p.id === from);
    if (!c) {
      const node = htmlEl('div', { class: 'cursor' });
      const shape = htmlEl('div', { class: 'shape' });
      node.append(shape, htmlEl('span'), htmlEl('img', { alt: '', hidden: true }));
      this.cursorLayer.append(node);
      c = { node, shape, tool: '' };
      this.cursors.set(from, c);
      this.styleCursor(c, peer ?? { id: from, name: '', color: '#8b8d98' });
    }
    this.setCursorTool(c, TOOL_NAMES.has(m.tool) || Object.hasOwn(MODE_ICONS, m.tool ?? '') ? m.tool : 'pointer');
    c.node.classList.toggle('active', from === this.queue[0]);
    c.x = m.x;
    c.y = m.y;
    c.node.hidden = false;
    this.moveCursor(c);
    clearTimeout(c.timer);
    c.timer = setTimeout(() => (c.node.hidden = true), from === this.queue[0] ? 30000 : 5000);
  }

  /** @private Where a peer is: the canvas they chose (the host may say so for the others, to a newcomer). */
  remotePage(from, m) {
    let id = from;
    if (m.of !== undefined) {
      const hostId = this.session.role === 'host' ? this.session.me.id : this.session.host?.()?.id;
      if (from !== hostId || !ID.test(m.of ?? '')) {
        return;
      }
      id = m.of;
    }
    if (id === this.session.me.id || !Number.isInteger(m.n) || m.n < 0 || m.n >= PAGES) {
      return;
    }
    if (m.n === 0) {
      this.pages.delete(id);
    } else {
      this.pages.set(id, m.n);
    }
    this.syncCursors();
    this.renderPages();
  }

  /** @private Only the cursors of whoever is on this canvas show. */
  syncCursors() {
    for (const [id, c] of this.cursors) {
      if ((this.pages.get(id) ?? 0) !== this.page) {
        c.node.hidden = true;
      }
    }
  }

  /** @private The cursor's shape is its owner's tool. */
  setCursorTool(c, tool) {
    if (c.tool === tool) {
      return;
    }
    c.tool = tool;
    const [hx, hy] = HOTSPOT[tool];
    c.shape.innerHTML = `<svg class="${tool}" viewBox="0 0 24 24" width="24" height="24">${MODE_ICONS[tool] ?? ICONS[tool]}</svg>`;
    c.shape.style.left = `${-hx}px`;
    c.shape.style.top = `${-hy}px`;
    c.shape.style.setProperty('--hx', `${hx}px`);
    c.shape.style.setProperty('--hy', `${hy}px`);
  }

  /** @private The avatar of a peer (this one's own too), or ''. */
  avatarOf(id) {
    return id === this.session.me.id ? this.avatar : (this.avatars.get(id) ?? '');
  }

  /** @private Colour, and the avatar or else the name. */
  styleCursor(c, peer) {
    const color = COLOR.test(peer.color ?? '') ? peer.color : '#8b8d98';
    c.node.style.setProperty('--c', color);
    c.shape.style.color = color;
    const label = c.node.querySelector('span');
    const img = c.node.querySelector('img');
    const avatar = this.avatarOf(peer.id);
    if (avatar) {
      img.src = avatar;
      img.style.borderColor = color;
    } else {
      img.removeAttribute('src');
    }
    img.hidden = !avatar;
    label.textContent = typeof peer.name === 'string' ? peer.name.slice(0, 40) : '';
    label.style.background = color;
    label.hidden = !!avatar || !label.textContent;
  }

  /** @private The cursor of whoever has the turn stands out. */
  markActiveCursor() {
    for (const [id, c] of this.cursors) {
      c.node.classList.toggle('active', id === this.queue[0]);
    }
  }

  // ── Avatars and the speaking queue ───────────────────────────────────────

  /** @private What a peer who just joined needs: our avatar and, from the host, the others and the queue. */
  sendExtras(to) {
    const host = this.session.role === 'host';
    if (this.avatar) {
      this.send({ t: 'avatar', data: this.avatar }, host ? { to } : {});
    }
    if (this.page > 0) {
      this.send({ t: 'pg', n: this.page }, host ? { to } : {});
    }
    if (host) {
      for (const [id, data] of this.avatars) {
        if (id !== to) {
          this.send({ t: 'avatar', of: id, data }, { to });
        }
      }
      this.send({ t: 'queue', ids: this.queue }, { to });
      for (const [id, n] of this.pages) {
        if (id !== to) {
          this.send({ t: 'pg', of: id, n }, { to });
        }
      }
      for (const item of this.model.live()) {
        const blob = item.kind === 'image' && item.file ? this.files.get(item.id) : null;
        if (blob) {
          this.sendFile(item.id, blob, { to });
        }
      }
    }
  }

  /** @private The bytes of a file, to everyone or to one peer. */
  async sendFile(id, blob, opts = {}) {
    try {
      this.send({ t: 'file', id, data: toBase64(await blobBytes(blob)) }, opts);
    } catch {
      // the file stays here only
    }
  }

  /**
   * @private The bytes of a file pinned on the board. Only the author of the item, or the host
   * (for someone who joined later), may send them; they must be as long as the item says.
   */
  remoteFile(from, m) {
    const item = typeof m.id === 'string' ? this.model.get(m.id) : null;
    const hostId = this.session.role === 'host' ? this.session.me.id : this.session.host?.()?.id;
    if (item?.kind !== 'image' || !item.file || this.files.has(item.id) || (from !== item.author && from !== hostId)) {
      return;
    }
    if (typeof m.data !== 'string' || m.data.length > Math.ceil(LIMITS.fileBytes / 3) * 4 || this.fileTotal() + item.file.bytes > LIMITS.filesTotal) {
      return;
    }
    let bytes;
    try {
      bytes = fromBase64(m.data);
    } catch {
      return;
    }
    if (bytes.length !== item.file.bytes) {
      return;
    }
    this.keepFile(item.id, new Blob([bytes], { type: item.file.mime }), bytes);
  }

  /**
   * @private Keeps the file of a picture item; a GIF is then drawn from it (animated) instead of
   * its still preview. `bytes` the file's bytes when they are at hand.
   */
  keepFile(id, blob, bytes = null) {
    this.files.set(id, blob);
    const check = async () => {
      const head = bytes ? bytes.subarray(0, 6) : await blobBytes(blob.slice(0, 6));
      if (isGif(head) && this.files.get(id) === blob && !this.destroyed) {
        this.motion.set(id, { blob, url: URL.createObjectURL(blob) });
        this.render();
      }
    };
    check().catch(() => {}); // unreadable: the still preview stays
  }

  /** @private The address an image item is drawn from: its animated file once here, else its preview. */
  pictureHref(item) {
    const m = this.stills ? null : this.motion.get(item.id);
    return m && this.files.get(item.id) === m.blob ? m.url : item.data;
  }

  /** @private Lets go of the animated files no longer on the board (all of them with `all`). */
  dropMotion(all = false) {
    for (const [id, m] of this.motion) {
      if (all || this.files.get(id) !== m.blob) {
        URL.revokeObjectURL(m.url);
        this.motion.delete(id);
      }
    }
  }

  /** @private The bytes of the files still on the board. */
  fileTotal() {
    let total = 0;
    for (const [id, blob] of this.files) {
      if (this.model.get(id)) {
        total += blob.size;
      }
    }
    return total;
  }

  /** @private An avatar from its owner, or (`of`) from the host on behalf of someone who joined before. */
  remoteAvatar(from, m) {
    let id = from;
    if (m.of !== undefined) {
      const hostId = this.session.role === 'host' ? this.session.me.id : this.session.host?.()?.id;
      if (from !== hostId || !ID.test(m.of)) {
        return;
      }
      id = m.of;
    }
    if (id === this.session.me.id) {
      return;
    }
    const data = cleanImageData(m.data, LIMITS.avatarChars);
    if (data) {
      this.avatars.set(id, data);
    } else {
      this.avatars.delete(id);
    }
    const c = this.cursors.get(id);
    const peer = this.session.peers().find((p) => p.id === id);
    if (c && peer) {
      this.styleCursor(c, peer);
    }
    this.renderQueue();
  }

  /** @private */
  turnAction(op) {
    if (this.session.role === 'host') {
      this.hubTurn(this.session.me.id, op);
    } else {
      const host = this.session.host?.();
      if (host) {
        this.send({ t: 'turn', op }, { to: host.id });
      }
    }
  }

  /** @private The host keeps the queue: `id` asks for a turn or gives it up. */
  hubTurn(id, op) {
    const at = this.queue.indexOf(id);
    if (op === 'join' && at < 0 && this.queue.length < MAX_QUEUE) {
      this.setQueue([...this.queue, id], true);
    } else if (op === 'leave' && at >= 0) {
      this.setQueue(this.queue.filter((q) => q !== id), true);
    }
  }

  /** @private A guest's request, only the host takes it. */
  remoteTurn(from, m) {
    if (this.session.role === 'host' && (m.op === 'join' || m.op === 'leave')) {
      this.hubTurn(from, m.op);
    }
  }

  /** @private The queue as the host says it. */
  remoteQueue(from, m) {
    const hostId = this.session.host?.()?.id;
    if (this.session.role !== 'guest' || from !== hostId || !Array.isArray(m.ids) || m.ids.length > MAX_QUEUE) {
      return;
    }
    const ids = m.ids.filter((id, i) => ID.test(id ?? '') && m.ids.indexOf(id) === i);
    this.setQueue(ids, false);
  }

  /** @private The host drops people who left from the queue. */
  pruneQueue(here) {
    if (this.session.role === 'host' && this.queue.some((id) => !here.has(id))) {
      this.setQueue(this.queue.filter((id) => here.has(id)), true);
    }
  }

  /** @private */
  setQueue(ids, announce) {
    if (ids.length === this.queue.length && ids.every((id, i) => id === this.queue[i])) {
      return;
    }
    const me = this.session.me.id;
    const wasMine = this.queue[0] === me;
    this.queue = ids;
    if (announce) {
      this.send({ t: 'queue', ids });
    }
    this.markActiveCursor();
    this.renderQueue();
    if (ids[0] === me && !wasMine) {
      this.flash(this.strings.yourTurn);
    }
    this.emit('queue', { ids: [...ids] });
  }

  /** @private The queue in the lower left corner: who speaks and who waits, then the button. */
  renderQueue() {
    if (!this.queueBox || !this.turns) {
      return;
    }
    const s = this.strings;
    const me = this.session.me.id;
    const hub = this.session.role === 'host';
    const peers = new Map(this.session.peers().map((p) => [p.id, p]));
    const key = JSON.stringify([me, this.queue.map((id) => [id, peers.get(id)?.name, peers.get(id)?.color, this.avatarOf(id).length])]);
    if (key === this.queueKey) {
      return;
    }
    this.queueKey = key;
    const parts = this.queue.map((id, i) => {
      const p = peers.get(id);
      const color = COLOR.test(p?.color ?? '') ? p.color : '#8b8d98';
      const name = typeof p?.name === 'string' && p.name ? p.name.slice(0, 40) : '?';
      const entry = htmlEl('div', { class: i === 0 ? 'entry first' : 'entry', title: i === 0 ? `${name} (${s.speaking})` : name });
      entry.style.background = color;
      entry.style.color = readableOn(color);
      const data = this.avatarOf(id);
      let face;
      if (data) {
        face = htmlEl('img', { alt: '' });
        face.src = data;
      } else {
        face = htmlEl('span', { class: 'initial' });
        face.textContent = [...name][0]?.toUpperCase() ?? '?';
      }
      const num = htmlEl('span', { class: 'num' });
      num.textContent = String(i + 1);
      const label = htmlEl('span', { class: 'name' });
      label.textContent = id === me ? `${name} (${s.you})` : name;
      entry.append(face, num, label);
      if (hub && id !== me) {
        const remove = htmlEl('button', { type: 'button', 'aria-label': `${s.removeFromQueue}: ${name}`, title: s.removeFromQueue });
        remove.textContent = '\u00d7';
        remove.addEventListener('click', () => this.removeFromQueue(id));
        entry.append(remove);
      }
      return entry;
    });
    const mine = this.queue.indexOf(me);
    const turn = htmlEl('button', { type: 'button', class: 'turn' });
    turn.textContent = mine < 0 ? s.ask : mine === 0 ? s.endTurn : s.leaveQueue;
    turn.addEventListener('click', () => (mine < 0 ? this.requestTurn() : this.endTurn()));
    this.queueBox.replaceChildren(...parts, turn);
  }

  /** @private */
  moveCursor(c) {
    const p = this.toBox(c.x, c.y);
    c.node.style.transform = `translate(${p.x}px, ${p.y}px)`;
  }

  /** @private Ink a peer is drawing now (lossy; replaced by the item). */
  remoteInk(from, m) {
    if (!ID.test(m.id ?? '') || !Number.isInteger(m.seq) || !Array.isArray(m.pts) || m.pts.length > 400 || m.pts.length % 2 || !m.pts.every((n) => finite(n))) {
      return;
    }
    if (!COLOR.test(m.color ?? '') || !finite(m.width, 0.5, 64) || this.model.items.has(m.id)) {
      return;
    }
    if ((m.pg ?? 0) !== this.page) {
      return; // drawn on another canvas
    }
    const key = `${from}:${m.id}`;
    let ink = this.liveInk.get(key);
    if (!ink) {
      if (this.liveInk.size > 50) {
        return;
      }
      ink = { node: svgEl('path', { fill: 'none', stroke: m.color, 'stroke-width': m.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.8 }), points: [], seq: -1 };
      this.liveGroup.append(ink.node);
      this.liveInk.set(key, ink);
    }
    if (m.seq <= ink.seq || ink.points.length > LIMITS.points * 2) {
      return; // late or out of order
    }
    ink.seq = m.seq;
    ink.points.push(...m.pts);
    ink.node.setAttribute('d', inkPath(ink.points));
    clearTimeout(ink.timer);
    ink.timer = setTimeout(() => this.dropLive(from, m.id), 10000);
  }

  /** @private */
  dropLive(author, id) {
    const key = `${author}:${id}`;
    const ink = this.liveInk.get(key);
    if (ink) {
      clearTimeout(ink.timer);
      ink.node.remove();
      this.liveInk.delete(key);
    }
  }

  // ── Magnifier ─────────────────────────────────────────────────────────────

  /** @private With the magnifier, the lens follows the pointer (and hides over the controls). */
  moveLens(ev) {
    if (this.pointerMode() !== 'magnify' || this.onControls(ev)) {
      this.showLens(null);
      return;
    }
    const r = this.host.getBoundingClientRect();
    this.showLens({ x: ev.clientX - r.left, y: ev.clientY - r.top });
  }

  /**
   * @private Shows the lens for the point `at` (box pixels), or hides it with null. It holds a copy
   * of the content under the board (the adapter's `content()`: the video plays in it too) and the
   * drawings (an SVG <use> of the layer, so they are always current), enlarged about that point.
   */
  showLens(at) {
    this.lensAt = at;
    if (!at) {
      if (!this.lens.hidden) {
        this.lens.hidden = true;
        this.lens.replaceChildren();
        this.lensSig = '';
      }
      return;
    }
    const w = this.host.clientWidth || this.container.clientWidth;
    const h = this.host.clientHeight || this.container.clientHeight;
    const R = LENS_RADIUS;
    const k = this.lensPower;
    this.syncLensContent(w, h);
    // Beside the pointer, up and to the right, unless that leaves the board.
    const cx = at.x + LENS_GAP + R > w ? at.x - LENS_GAP : at.x + LENS_GAP;
    const cy = at.y - LENS_GAP - R < 0 ? at.y + LENS_GAP : at.y - LENS_GAP;
    this.lens.style.width = `${2 * R}px`;
    this.lens.style.height = `${2 * R}px`;
    this.lens.style.transform = `translate(${round1(cx - R)}px, ${round1(cy - R)}px)`;
    const view = this.lens.querySelector('.view');
    // The lens's border is 3px: its inside starts there.
    view.style.transform = `translate(${round1(R - 3 - k * at.x)}px, ${round1(R - 3 - k * at.y)}px) scale(${k})`;
    view.querySelector('svg').style.clipPath = this.board.style.clipPath;
    this.lens.hidden = false;
  }

  /** @private (Re)makes the copy of the content in the lens when the content changed (background, stream, zoom). */
  syncLensContent(w, h) {
    const content = this.adapter.content?.() ?? null;
    const parts = content ? [content, ...content.querySelectorAll('*')] : [];
    const sig = `${w}x${h}|${parts.map((el) => `${el.hidden}:${el.getAttribute('style') ?? ''}:${el.srcObject?.id ?? el.currentSrc ?? ''}`).join('|')}`;
    if (sig === this.lensSig) {
      return;
    }
    this.lensSig = sig;
    const view = htmlEl('div', { class: 'view' });
    view.style.width = `${w}px`;
    view.style.height = `${h}px`;
    if (content) {
      view.append(copyLive(content));
    }
    const svg = svgEl('svg');
    svg.append(svgEl('use', { href: '#wb-layer' }));
    const aim = htmlEl('div', { class: 'aim' }, '<svg viewBox="0 0 14 14" width="14" height="14"><path d="M7 0v5M7 9v5M0 7h5M9 7h5" stroke="#1c2024" stroke-width="1.4"/><path d="M7 1v3.5M7 9.5V13M1 7h3.5M9.5 7H13" stroke="#fff" stroke-width="0.6"/></svg>');
    view.append(svg);
    this.lens.replaceChildren(view, aim);
  }

  // ── Laser and emotes ────────────────────────────────────────────────────

  /** @private A press with the laser (a new trail) or with emotes (a click on one makes it bigger, else the wheel). */
  modeDown(ev) {
    ev.preventDefault();
    this.popover.hidden = true;
    const p = this.eventPoint(ev);
    if (this.pointerMode() === 'laser') {
      this.board.setPointerCapture?.(ev.pointerId);
      this.fxSeq += 1;
      this.lasing = { key: `${this.session.me.id}:l${this.fxSeq}`, id: `l${this.fxSeq}`, seq: 0, pending: [], sentAt: 0 };
      this.laserTo(p);
      return;
    }
    if (this.emoteWheel?.sticky) {
      // The wheel was left open by a click: a click on an emote puts it, anywhere else closes it.
      this.aimWheel(ev);
      this.closeWheel(true);
      return;
    }
    const live = this.emoteAt(ev);
    if (live) {
      this.bumpEmote(live);
      return;
    }
    this.board.setPointerCapture?.(ev.pointerId);
    this.openWheel(ev, p);
  }

  /** @private The laser here moved to `p`: drawn now, and sent to the others at most 30 times a second. */
  laserTo(p) {
    const l = this.lasing;
    const x = round1(p.x);
    const y = round1(p.y);
    this.trailPoints(l.key, [x, y], this.session.me.color);
    l.pending.push(x, y);
    if (performance.now() - l.sentAt >= 33) {
      this.sendLaser();
    }
  }

  /** @private The points of the laser not yet sent. */
  sendLaser() {
    const l = this.lasing;
    if (!l?.pending.length) {
      return;
    }
    this.send({ t: 'laser', id: l.id, seq: l.seq++, pts: l.pending.splice(0, 400), pg: this.page }, { fast: true });
    l.sentAt = performance.now();
  }

  /** @private A peer's laser (lossy: nothing is kept but the fading trail). */
  remoteLaser(from, m) {
    if (!ID.test(m.id ?? '') || !Number.isInteger(m.seq) || !Array.isArray(m.pts) || m.pts.length > 400 || m.pts.length % 2 || !m.pts.every((n) => finite(n))) {
      return;
    }
    if ((m.pg ?? 0) !== this.page) {
      return;
    }
    const key = `${from}:${m.id}`;
    const trail = this.trails.get(key);
    if (trail ? m.seq <= trail.seq : this.trails.size >= 40) {
      return; // late, or too many at once
    }
    const peer = this.session.peers().find((q) => q.id === from);
    const made = this.trailPoints(key, m.pts, peer?.color);
    made.seq = m.seq;
  }

  /** @private Adds points (x, y, x, y...) to a laser trail, made in `color` if new; the trail, or null if refused. */
  trailPoints(key, pts, color) {
    let trail = this.trails.get(key);
    if (!trail) {
      const c = COLOR.test(color ?? '') ? color : '#e5484d';
      trail = { node: svgEl('g', { class: 'laser-trail', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none' }), pts: [], seq: -1, color: c };
      this.liveGroup.append(trail.node);
      this.trails.set(key, trail);
    }
    const t = performance.now();
    for (let i = 0; i + 1 < pts.length && trail.pts.length < 2000; i += 2) {
      trail.pts.push({ x: pts[i], y: pts[i + 1], t });
    }
    this.animate();
    return trail;
  }

  /** @private The emote under the pointer (the newest on top), or null. */
  emoteAt(ev) {
    const r = this.host.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const y = ev.clientY - r.top;
    const now = performance.now();
    let hit = null;
    for (const e of this.emotes.values()) {
      const at = this.emoteFrame(e, now);
      if (Math.hypot(at.x - x, at.y - y) <= at.size / 2) {
        hit = e;
      }
    }
    return hit;
  }

  /** @private Opens the wheel of emotes around the press. */
  openWheel(ev, p) {
    const r = this.host.getBoundingClientRect();
    const box = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    const node = htmlEl('div', { class: 'wheel', role: 'menu', 'aria-label': this.strings.pointerModeNames.emote });
    node.style.left = `${box.x}px`;
    node.style.top = `${box.y}px`;
    node.append(htmlEl('div', { class: 'ring' }), htmlEl('div', { class: 'hub' }));
    EMOTES.forEach((name, i) => {
      const a = (i * 2 * Math.PI) / EMOTES.length;
      const slot = htmlEl('div', { class: 'slot', role: 'menuitem', 'aria-label': name, 'data-name': name }, `<svg viewBox="0 0 24 24"><use href="#sticker-${name}"/></svg>`);
      slot.style.left = `${round1(Math.sin(a) * WHEEL_RADIUS)}px`;
      slot.style.top = `${round1(-Math.cos(a) * WHEEL_RADIUS)}px`;
      node.append(slot);
    });
    this.root.append(node);
    this.emoteWheel = { node, at: { x: round1(p.x), y: round1(p.y) }, box, choice: -1, moved: false, sticky: false };
  }

  /** @private The emote the pointer points at: the one in its direction, once it is away from the middle. */
  aimWheel(ev) {
    const w = this.emoteWheel;
    const r = this.host.getBoundingClientRect();
    const dx = ev.clientX - r.left - w.box.x;
    const dy = ev.clientY - r.top - w.box.y;
    const d = Math.hypot(dx, dy);
    w.moved ||= d > 8;
    // Far outside the wheel is no choice once it was opened by a click.
    const choice = d < 22 || (w.sticky && d > WHEEL_RADIUS + 40) ? -1 : (Math.round(Math.atan2(dx, -dy) / ((2 * Math.PI) / EMOTES.length)) + EMOTES.length) % EMOTES.length;
    if (choice !== w.choice) {
      w.choice = choice;
      w.node.querySelectorAll('.slot').forEach((s, i) => s.classList.toggle('on', i === choice));
    }
  }

  /** @private Closes the wheel; with `put`, the emote chosen (if any) goes on the board. */
  closeWheel(put) {
    const w = this.emoteWheel;
    if (!w) {
      return;
    }
    this.emoteWheel = null;
    w.node.remove();
    if (put && w.choice >= 0) {
      this.addEmote(EMOTES[w.choice], w.at);
    }
  }

  /**
   * Shows an emote at `at` (board units) to everyone on this canvas: it floats up and fades in about
   * two seconds. A click on a live emote (anybody's) makes it bigger and starts its life again.
   * @param {string} name one of {@link EMOTES}
   * @returns {string | null} its id, null for an unknown name
   */
  addEmote(name, at) {
    if (!EMOTES.includes(name) || !finite(at?.x) || !finite(at?.y)) {
      return null;
    }
    this.fxSeq += 1;
    const id = `${this.session.me.id}.e${this.fxSeq}`.slice(-64);
    const m = { t: 'emote', id, name, x: round1(at.x), y: round1(at.y), level: 1, pg: this.page };
    this.remoteEmote(m);
    this.send(m, { fast: true });
    return id;
  }

  /** @private A click on a live emote: one size bigger (up to the largest), for everyone. */
  bumpEmote(e) {
    const m = { t: 'emote', id: e.id, name: e.name, x: e.x, y: e.y, level: Math.min(EMOTE_LEVELS, e.level + 1), pg: this.page };
    e.level = m.level - 1; // so that it grows here as it does for the others
    this.remoteEmote(m);
    this.send(m, { fast: true });
  }

  /** @private An emote, new or grown (the larger size wins); validated, since peers send it. */
  remoteEmote(m) {
    if (!ID.test(m.id ?? '') || !EMOTES.includes(m.name) || !finite(m.x) || !finite(m.y) || !Number.isInteger(m.level) || m.level < 1 || m.level > EMOTE_LEVELS) {
      return;
    }
    if ((m.pg ?? 0) !== this.page) {
      return;
    }
    const now = performance.now();
    let e = this.emotes.get(m.id);
    if (e) {
      if (m.level <= e.level) {
        return;
      }
      // It grows where it is now, and lives again from there.
      e.rise = this.emoteFrame(e, now).rise;
      e.level = m.level;
      e.born = now;
    } else {
      if (this.emotes.size >= 60) {
        return;
      }
      const node = htmlEl('div', { class: 'emote', 'data-name': m.name }, `<svg viewBox="0 0 24 24"><use href="#sticker-${m.name}"/></svg>`);
      this.fxLayer.append(node);
      e = { id: m.id, name: m.name, x: m.x, y: m.y, level: m.level, born: now, rise: 0, node };
      this.emotes.set(m.id, e);
    }
    this.animate();
  }

  /** @private Where an emote is drawn at `now`: its centre in box pixels, size, scale, opacity and how far it rose. */
  emoteFrame(e, now) {
    const age = Math.max(0, now - e.born);
    const k = Math.min(1, age / EMOTE_MS);
    const rise = e.rise + EMOTE_RISE * k * (e.rise > 0 ? 0.5 : 1);
    const at = this.toBox(e.x, e.y);
    const size = EMOTE_PX * EMOTE_GROW ** (e.level - 1);
    const pop = age < 200 ? 1 + 0.3 * Math.sin((Math.PI * age) / 200) : 1;
    return { x: at.x, y: at.y - rise, size, pop, rise, opacity: k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45, done: age >= EMOTE_MS };
  }

  /** @private Draws the laser trails and emotes on the next frame, while there are any. */
  animate() {
    if (this.fxFrame || this.destroyed) {
      return;
    }
    const raf = globalThis.requestAnimationFrame ?? ((cb) => setTimeout(() => cb(performance.now()), 16));
    this.fxFrame = raf(() => {
      this.fxFrame = 0;
      this.drawFx(performance.now());
    });
  }

  /** @private One frame of the laser trails and emotes; what has faded goes. */
  drawFx(now) {
    if (this.destroyed) {
      return;
    }
    const scale = Math.hypot(this.matrix?.a ?? 1, this.matrix?.b ?? 0) || 1;
    for (const [key, trail] of this.trails) {
      while (trail.pts.length && now - trail.pts[0].t > LASER_MS) {
        trail.pts.shift();
      }
      if (!trail.pts.length && key !== this.lasing?.key) {
        trail.node.remove();
        this.trails.delete(key);
        continue;
      }
      // Four pieces, thinner and paler towards the tail; a glow under a bright core.
      const pieces = [];
      const n = trail.pts.length;
      for (let q = 0; q < 4; q++) {
        const part = trail.pts.slice(Math.floor((q * n) / 4), Math.ceil(((q + 1) * n) / 4) + 1);
        if (part.length < 2 && n > 1) {
          continue;
        }
        const d = part.length === 1 ? `M${part[0].x} ${part[0].y}h0.01` : `M${part.map((p) => `${round1(p.x)} ${round1(p.y)}`).join('L')}`;
        const w = (0.4 + 0.2 * q) / scale;
        pieces.push(
          svgEl('path', { d, stroke: trail.color, 'stroke-width': round1(10 * w * 100) / 100, opacity: 0.3 }),
          svgEl('path', { d, stroke: trail.color, 'stroke-width': round1(4 * w * 100) / 100 }),
          svgEl('path', { d, stroke: '#ffffff', 'stroke-width': round1(1.5 * w * 100) / 100, opacity: 0.85 }),
        );
      }
      trail.node.replaceChildren(...pieces);
    }
    for (const [id, e] of this.emotes) {
      const f = this.emoteFrame(e, now);
      if (f.done) {
        e.node.remove();
        this.emotes.delete(id);
        continue;
      }
      e.node.style.width = `${f.size}px`;
      e.node.style.height = `${f.size}px`;
      e.node.style.opacity = String(round1(f.opacity * 100) / 100);
      e.node.style.transform = `translate(${round1(f.x - f.size / 2)}px, ${round1(f.y - f.size / 2)}px) scale(${round1(f.pop * 100) / 100})`;
    }
    if (this.trails.size || this.emotes.size) {
      this.animate();
    }
  }

  /** @private Drops every laser trail and emote (another canvas, or the end). */
  clearFx() {
    for (const t of this.trails.values()) {
      t.node.remove();
    }
    for (const e of this.emotes.values()) {
      e.node.remove();
    }
    this.trails.clear();
    this.emotes.clear();
    this.lasing = null;
    this.closeWheel(false);
  }

  // ── Input ────────────────────────────────────────────────────────────────

  /** @private */
  wireInput() {
    const listen = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this.cleanups.push(() => target.removeEventListener(type, fn, opts));
    };
    // Cursors in every mode: watched on the container, never taken.
    listen(this.container, 'pointermove', (ev) => this.sendCursor(ev), { capture: true, passive: true });
    listen(this.container, 'pointerleave', () => {
      this.send({ t: 'cur', hide: true }, { fast: true });
      this.showLens(null);
    });
    listen(this.container, 'pointermove', (ev) => this.moveLens(ev), { capture: true, passive: true });
    listen(this.board, 'pointerdown', (ev) => this.down(ev));
    listen(this.board, 'pointermove', (ev) => this.move(ev));
    listen(this.board, 'pointerup', (ev) => this.up(ev));
    listen(this.board, 'pointercancel', (ev) => this.up(ev, true));
    listen(window, 'keydown', (ev) => this.key(ev), { capture: true });
    listen(this.board, 'click', (ev) => this.openLink(ev));
    listen(window, 'paste', (ev) => this.pasted(ev));
    listen(this.board, 'dblclick', (ev) => {
      const hit = this.itemAt(ev);
      if (hit?.kind === 'note' && !this.canEdit(hit)) {
        this.copyNote(hit);
      } else if (hit?.kind === 'image') {
        this.downloadFile(hit.id);
      }
    });
    // Zoom with the wheel at the pointer, pan with the middle button (or, zoomed in, the pointer tool).
    listen(this.container, 'wheel', (ev) => this.wheel(ev), { passive: false });
    // Shift over a picture lets it be dragged out as a copy.
    const shift = (on) => this.dragLayer.classList.toggle('shift', on);
    listen(window, 'keydown', (ev) => ev.key === 'Shift' && shift(true), { capture: true });
    listen(window, 'keyup', (ev) => ev.key === 'Shift' && shift(false), { capture: true });
    listen(window, 'blur', () => shift(false));
    listen(this.container, 'pointermove', (ev) => shift(ev.shiftKey), { capture: true, passive: true });
    listen(this.container, 'mousedown', (ev) => ev.button === 1 && this.adapter.panBy && ev.preventDefault());
    listen(this.container, 'pointerdown', (ev) => {
      if (this.selected && !this.onControls(ev) && this.itemAt(ev)?.id !== this.selected) {
        this.deselect();
      } else if (this.group.size > 0 && !this.onControls(ev) && !this.group.has((this.pinAt(this.eventPoint(ev)) ?? this.itemAt(ev))?.id)) {
        this.deselect();
      }
      this.pinGesture(ev);
    }, { capture: true });
    listen(this.container, 'pointerdown', (ev) => this.sweepStart(ev));
    listen(this.container, 'pointermove', (ev) => this.sweepMove(ev));
    listen(this.container, 'pointerup', (ev) => this.sweepEnd(ev));
    listen(this.container, 'pointercancel', (ev) => this.sweepEnd(ev, true));
    listen(this.container, 'pointerdown', (ev) => this.panStart(ev));
    listen(this.container, 'pointermove', (ev) => this.panMove(ev));
    listen(this.container, 'pointerup', (ev) => this.panEnd(ev));
    listen(this.container, 'pointercancel', (ev) => this.panEnd(ev));
    // Space held: a drag on the board pans it, zoomed in (a drag alone selects).
    const typing = (ev) => ev.target?.closest?.('input, textarea, select, [contenteditable]');
    listen(window, 'keydown', (ev) => {
      if (ev.key === ' ' && !this.editing && !typing(ev)) {
        this.spaceHeld = true;
        if (this.adapter.zoomed?.()) {
          ev.preventDefault(); // not a scroll of the page
        }
      }
    }, { capture: true });
    listen(window, 'keyup', (ev) => ev.key === ' ' && (this.spaceHeld = false), { capture: true });
    listen(window, 'blur', () => (this.spaceHeld = false));
    // The selection is copied, cut and pasted with the clipboard.
    listen(window, 'copy', (ev) => this.copied(ev, false));
    listen(window, 'cut', (ev) => this.copied(ev, true));
    // Images dropped on the board.
    listen(this.container, 'dragover', (ev) => (this.hasFiles(ev) || this.hasLink(ev)) && ev.preventDefault());
    listen(this.container, 'drop', (ev) => this.dropped(ev));
  }

  /** @private At most 30 a second, over the fast channel. */
  sendCursor(ev) {
    const now = performance.now();
    if (now - this.lastCursorSent < 33) {
      return;
    }
    this.lastCursorSent = now;
    const p = this.eventPoint(ev);
    this.lastPoint = { x: round1(p.x), y: round1(p.y) };
    this.sendCursorAgain();
  }

  /** @private The cursor with the tool in use (again when the tool changes). */
  sendCursorAgain() {
    if (this.lastPoint) {
      const mode = this.pointerMode();
      this.send({ t: 'cur', ...this.lastPoint, tool: mode === 'cursor' ? this.tool : mode, pg: this.page }, { fast: true });
    }
  }

  /** @private Over the toolbar, the chooser or the queue, the page's own gestures stay. */
  onControls(ev) {
    const path = ev.composedPath();
    return path.includes(this.toolbarBox) || path.includes(this.popover) || path.includes(this.selbar) || path.includes(this.queueBox) || path.includes(this.pagesBox);
  }

  /** @private */
  wheel(ev) {
    if (this.pointerMode() === 'magnify' && !ev.ctrlKey && !this.onControls(ev)) {
      // With the magnifier, the wheel changes how much it enlarges, not the zoom of the board.
      ev.preventDefault();
      const i = nearest(LENS_POWERS, this.lensPower) + (ev.deltaY < 0 ? 1 : -1);
      this.lensPower = LENS_POWERS[Math.min(LENS_POWERS.length - 1, Math.max(0, i))];
      this.flash(`${this.strings.magnifier}: \u00d7${this.lensPower}`);
      this.moveLens(ev);
      return;
    }
    if (!this.adapter.zoomAt || this.onControls(ev)) {
      return;
    }
    const r = this.host.getBoundingClientRect();
    ev.preventDefault();
    this.adapter.zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0015)));
  }

  /** @private */
  panStart(ev) {
    const middle = ev.button === 1;
    // On the board itself, with the pointer: by touch, or with Space held (a drag alone selects).
    const empty = ev.button === 0 && this.tool === 'pointer' && !ev.composedPath().includes(this.board) && (ev.pointerType === 'touch' || this.spaceHeld);
    if (this.sweeping || !this.adapter.panBy || this.onControls(ev) || !(middle || (empty && this.adapter.zoomed?.()))) {
      return;
    }
    this.pan = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
    this.container.setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
  }

  /** @private */
  panMove(ev) {
    if (this.pan && ev.pointerId === this.pan.id) {
      this.adapter.panBy(ev.clientX - this.pan.x, ev.clientY - this.pan.y);
      this.pan.x = ev.clientX;
      this.pan.y = ev.clientY;
    }
  }

  /** @private */
  panEnd(ev) {
    if (this.pan && ev.pointerId === this.pan.id) {
      this.container.releasePointerCapture?.(ev.pointerId);
      this.pan = null;
    }
  }

  /** @private */
  hasFiles(ev) {
    return !this.readOnlyFlag && [...(ev.dataTransfer?.types ?? [])].includes('Files');
  }

  /** @private Whether a drag carries a web address (a link dragged from a page or the address bar). */
  hasLink(ev) {
    const types = [...(ev.dataTransfer?.types ?? [])];
    return !this.readOnlyFlag && !types.includes('Files') && (types.includes('text/uri-list') || types.includes('text/x-moz-url'));
  }

  /** @private The web address on a drag or paste, or null. */
  linkIn(data) {
    const text = (data?.getData('text/uri-list') || data?.getData('text/plain') || '').split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) ?? '';
    return cleanUrl(text);
  }

  /** @private A web address pasted (not into a note) is pinned as a link card. */
  pasted(ev) {
    const t = ev.target;
    if (this.readOnlyFlag || t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? '')) {
      return;
    }
    if (this.pasteItems(ev.clipboardData)) {
      ev.preventDefault();
      return;
    }
    const url = this.linkIn(ev.clipboardData);
    if (url) {
      ev.preventDefault();
      this.pinLink(url, this.lastPoint ?? undefined);
    }
  }

  /** @private Pins a link, reporting a refusal (a full board) as an error event. */
  pinLink(url, at) {
    try {
      this.addLink(url, at);
    } catch (e) {
      if (!(e instanceof WhiteboardError)) {
        throw e;
      }
      this.emit('error', e);
    }
  }

  /** @private A click on a link card (with the pointer tool, and not at the end of a drag) opens the page in a new tab. */
  openLink(ev) {
    if (this.noClick || this.tool !== 'pointer' || !PASSIVE_MODES.has(this.style.pointerMode)) {
      return;
    }
    const hit = this.itemAt(ev);
    if (hit?.kind === 'link') {
      this.openUrl(hit.url);
    }
  }

  /** @private Files dropped on the board are pinned where they landed, a dropped web address as a link. */
  async dropped(ev) {
    if (this.hasLink(ev)) {
      const url = this.linkIn(ev.dataTransfer);
      if (url) {
        ev.preventDefault();
        this.pinLink(url, this.eventPoint(ev));
      }
      return;
    }
    if (!this.hasFiles(ev)) {
      return;
    }
    ev.preventDefault();
    const files = [...ev.dataTransfer.files].slice(0, 5);
    const at = this.eventPoint(ev);
    for (const [n, file] of files.entries()) {
      try {
        await this.addFile(file, { x: at.x + n * 24, y: at.y + n * 24 });
      } catch (e) {
        if (!(e instanceof WhiteboardError)) {
          throw e;
        }
        this.emit('error', e);
      }
    }
  }

  /** @private The item under a pointer event (not the capture rectangle). */
  itemAt(ev) {
    for (const node of this.root.elementsFromPoint(ev.clientX, ev.clientY)) {
      const g = node.closest?.('.item');
      if (g && this.itemsGroup.contains(g)) {
        return this.model.get(g.dataset.id);
      }
    }
    return null;
  }

  /** @private */
  down(ev) {
    if (ev.button > 0 || this.threading) {
      return;
    }
    if (!PASSIVE_MODES.has(this.pointerMode())) {
      this.modeDown(ev); // the laser and emotes change nothing on the board: they work read only too
      return;
    }
    if (this.readOnlyFlag) {
      return;
    }
    const hit = this.pinAt(this.eventPoint(ev)) ?? this.itemAt(ev); // a pin wins over what lies on it
    if (hit && this.group.has(hit.id) && this.tool === 'pointer') {
      this.beginGroupDrag(ev, this.eventPoint(ev));
      this.groupDrag.pressed = hit.id;
      return;
    }
    const mine = hit && this.canEdit(hit) ? hit : null; // what can be changed by this peer
    const drawn = hit && DRAWN.has(hit.kind) && (this.tool === 'pointer' || this.tool === hit.kind);
    if (hit && (drawn || (SELECTABLE.has(hit.kind) && ['pointer', 'note', 'pin', 'sticker'].includes(this.tool)))) {
      this.select(hit.id);
      if (hit.kind === 'arrow') {
        ev.preventDefault();
        return;
      }
    }
    // Your own items move with the pointer tool, and with the tool that makes them.
    const grab = mine && (this.tool === 'pointer' || (this.tool === 'text' && mine.kind === 'text') || (this.tool === 'note' && mine.kind === 'note') || (this.tool === 'pin' && mine.kind === 'pin') || (this.tool === 'sticker' && (mine.kind === 'sticker' || mine.kind === 'image' || mine.kind === 'link' || mine.kind === 'note')));
    if (this.tool === 'pointer' && !grab) {
      return;
    }
    ev.preventDefault();
    this.popover.hidden = true;
    this.board.setPointerCapture?.(ev.pointerId);
    const p = this.eventPoint(ev);
    if (grab) {
      // A pin on an item is moved from where it is drawn, not from where it was first put.
      const grabbed = mine.kind === 'pin' && mine.on ? { ...mine, ...pinPoint(mine, this.lookup) } : mine;
      const byPin = ELEMENTS.has(mine.kind) && this.pinAt(p)?.id === mine.id;
      this.dragging = { item: grabbed, from: p, moved: false, fields: null, preview: false, dx: 0, dy: 0, corner: (mine.kind === 'note' || mine.kind === 'image') && this.onCorner(mine, p), byPin };
      if (byPin) {
        // The pin is what is being dragged: it gets the outline, not the element.
        this.nodes.get(mine.id)?.node.classList.add('by-pin');
        this.dragging.ring = svgEl('circle', { class: 'pin-ring', r: PIN_RADIUS + 4, fill: 'none', 'pointer-events': 'none' });
        this.liveGroup.append(this.dragging.ring);
        this.showPinDrag(this.dragging, 0, 0, p);
      }
    } else if (this.tool === 'pen') {
      this.inkSeq += 1;
      this.drawing = { id: `${this.model.peerId}.${this.model.counter + 1}`, points: [p.x, p.y], sent: 0, seq: 0 };
      this.drawing.node = svgEl('path', { fill: 'none', stroke: this.style.color, 'stroke-width': this.style.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      this.liveGroup.append(this.drawing.node);
      this.drawing.node.setAttribute('d', inkPath(this.drawing.points));
    } else if (this.tool === 'eraser') {
      this.erasing = new Set();
      this.eraseAt(ev);
    } else if (this.tool === 'text') {
      this.pendingText = p;
    } else if (this.tool === 'note') {
      this.pendingNote = { from: p, x0: ev.clientX, y0: ev.clientY, rect: null };
    } else if (this.tool === 'pin') {
      this.addPin(p);
    } else if (this.tool === 'arrow') {
      const source = this.pinAt(p);
      const host = source ? null : this.attachment(p, null).on;
      if (source) {
        this.beginThread(source.id, ev, null);
      } else if (host) {
        // Pressed on an element away from its pins: the thread starts from a pin put there, made
        // only once the thread is tied (let go anywhere else, and there is no pin).
        this.beginThread(null, ev, null, { at: p, host });
      }
    } else if (this.tool === 'sticker') {
      this.local(() => this.model.add({ kind: 'sticker', x: round1(p.x), y: round1(p.y), size: 32, name: this.style.sticker }));
    }
  }

  /** @private */
  move(ev) {
    if (this.lasing) {
      this.laserTo(this.eventPoint(ev));
    } else if (this.emoteWheel) {
      this.aimWheel(ev);
    } else if (this.drawing) {
      const p = this.eventPoint(ev);
      const pts = this.drawing.points;
      const lx = pts[pts.length - 2];
      const ly = pts[pts.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) < 0.5 || pts.length >= LIMITS.points * 2) {
        return;
      }
      pts.push(p.x, p.y);
      this.drawing.node.setAttribute('d', inkPath(pts));
      // The new points to the others, a few at a time (lossy is fine).
      if (pts.length - this.drawing.sent >= 8) {
        this.sendInk();
      }
    } else if (this.erasing) {
      this.eraseAt(ev);
    } else if (this.threading) {
      this.dragThread(ev);
    } else if (this.dragging) {
      this.drag(ev);
    } else if (this.groupDrag) {
      this.dragGroup(ev);
    } else if (this.pendingNote) {
      this.dragNote(ev);
    }
  }

  /**
   * @private The bounds of the note being put down by dragging, from where the press was to the
   * pointer (the note grows from that corner), or null while it is still a click.
   */
  noteDrag(ev) {
    const n = this.pendingNote;
    if (Math.hypot(ev.clientX - n.x0, ev.clientY - n.y0) < 6) {
      return null;
    }
    const p = this.eventPoint(ev);
    const { size, ratio } = noteBounds(p.x - n.from.x, p.y - n.from.y);
    const w = size;
    const h = size * ratio;
    const x = p.x >= n.from.x ? n.from.x : n.from.x - w;
    const y = p.y >= n.from.y ? n.from.y : n.from.y - h;
    return { x, y, w, h };
  }

  /** @private While a note is dragged out: a dashed outline of where it will be. */
  dragNote(ev) {
    const n = this.pendingNote;
    const b = this.noteDrag(ev);
    if (!b) {
      n.rect?.remove();
      n.rect = null;
      return;
    }
    if (!n.rect) {
      n.rect = svgEl('rect', { class: 'note-outline', fill: pastel(this.style.color), 'fill-opacity': 0.5, stroke: 'var(--wb-accent, #3e63dd)', 'stroke-width': 1.5, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' });
      this.liveGroup.append(n.rect);
    }
    for (const [k, v] of Object.entries({ x: b.x, y: b.y, width: b.w, height: b.h })) {
      n.rect.setAttribute(k, String(v));
    }
  }

  /** @private Whether this peer may change, move or delete an element: anybody, unless it is locked. */
  canEdit(item) {
    return !this.readOnlyFlag && mayChange(item, { ...item, stamp: [item.stamp[0], this.model.peerId], deleted: true });
  }

  /** @private The Delete key: takes down the selected elements, but not those locked against this person. */
  removeSelected() {
    if (this.group.size > 0) {
      const items = [...this.group].map((id) => this.model.get(id)).filter(Boolean);
      const free = items.filter((i) => this.canEdit(i));
      for (const i of free) {
        this.local(() => this.model.remove(i.id));
      }
      if (free.length < items.length) {
        this.flash(this.strings.someLocked);
      }
      return;
    }
    const item = this.model.get(this.selected);
    if (!item) {
      return;
    }
    if (this.canEdit(item)) {
      this.local(() => this.model.remove(item.id));
    } else {
      this.flash(this.strings.locked);
    }
  }

  /** @private Selects one of your items (a note, a pin or a thread): a bar to change it appears over it. */
  select(id) {
    if (this.group.size > 0) {
      this.markGroup(false);
      this.group = new Set();
      if (this.selected === id) {
        this.renderSelbar();
      }
    }
    if (this.selected === id) {
      return;
    }
    const before = this.selected;
    this.selected = id;
    // Only the mark changes: the nodes stay, or the click that follows the press would be lost.
    for (const key of [before, id]) {
      this.nodes.get(key)?.node.classList.toggle('selected', key === id);
    }
    this.renderSelbar();
  }

  /** @private Nothing selected. */
  deselect() {
    if (this.selected || this.group.size > 0) {
      this.select(null);
    }
  }

  /** @private Marks the items of the selection as selected (or not), leaving their nodes in place. */
  markGroup(on) {
    for (const id of this.group) {
      this.nodes.get(id)?.node.classList.toggle('selected', on);
    }
  }

  /**
   * Selects the items with these ids on the canvas shown (those not there are left out): one is
   * selected as a click selects it, more become a selection that is moved by dragging any of them,
   * coloured from the bar over it, removed with Delete, and copied, cut and pasted (Ctrl+C, X, V).
   * @param {Iterable<string>} ids
   * @returns {string[]} the ids now selected
   */
  selectItems(ids) {
    const here = new Set(this.pageItems().map((i) => i.id));
    const list = [...new Set(ids)].filter((id) => here.has(id));
    if (list.length < 2) {
      this.select(list[0] ?? null);
      return list;
    }
    this.select(null);
    this.group = new Set(list);
    this.markGroup(true);
    this.renderSelbar();
    return list;
  }

  /** The ids of the items selected here (none, one, or a selection of several). */
  selection() {
    return this.group.size > 0 ? [...this.group] : this.selected ? [this.selected] : [];
  }

  /**
   * @private The bar over the selected element: for a note its shapes, text sizes and paper colours;
   * for a thread its heads and colours; for a pin its colours; for anybody the copy of a note's text,
   * and for its owner the lock. Only what the person may change is offered.
   */
  renderSelbar() {
    if (this.group.size > 0) {
      this.renderGroupBar();
      return;
    }
    const item = this.selected ? this.model.get(this.selected) : null;
    const mine = item?.author === this.model.peerId;
    const editable = !!item && this.canEdit(item);
    if (!item || this.readOnlyFlag || !(editable || mine || item.kind === 'note')) {
      this.selbar.hidden = true;
      this.selbar.replaceChildren();
      delete this.selbar.dataset.sig; // built again when something is selected, the same item too
      delete this.selbar.dataset.id;
      return;
    }
    const sig = `${item.stamp[0]}.${item.stamp[1]}`;
    if (this.selbar.dataset.sig !== sig || this.selbar.dataset.id !== item.id) {
      const s = this.strings;
      const parts = [];
      const button = (label, content, pressed, run) => {
        const b = htmlEl('button', { type: 'button', title: label, 'aria-label': label, 'aria-pressed': String(pressed) }, content);
        b.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the focus (and a note's text box) where it is
        b.addEventListener('click', run);
        return b;
      };
      const change = (fields) => this.local(() => this.model.change(item.id, fields));
      const rule = () => parts.length > 0 && parts.push(htmlEl('hr'));
      const swatches = (colors, current, field) => {
        for (const [i, c] of colors.entries()) {
          parts.push(button(`${s.color}: ${COLOR_NAMES[i]}`, `<span class="swatch" style="background:${c}"></span>`, c.toLowerCase() === current.toLowerCase(), () => change({ [field]: c })));
        }
      };
      if (item.kind === 'note') {
        parts.push(button(s.copyText, '<svg viewBox="0 0 24 24"><path d="M8 8V4h12v12h-4M4 8h12v12H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>', false, () => this.copyNote(item)));
      }
      if (editable && item.kind === 'note') {
        rule();
        for (const shape of NOTE_SHAPES) {
          const icon = shapeElement(shape, 3, 4, 18, 16, { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }).outerHTML;
          parts.push(button(`${s.shapeLabel}: ${s.shapeNames[shape]}`, `<svg viewBox="0 0 24 24">${icon}</svg>`, (item.shape ?? 'square') === shape, () => change({ shape: shape === 'square' ? undefined : shape })));
        }
        rule();
        for (const [i, size] of NOTE_SIZES.entries()) {
          const px = [10, 14, 19][i];
          parts.push(button(`${s.text}: ${SIZE_NAMES[i]}`, `<svg viewBox="0 0 24 24"><text x="12" y="${12 + px * 0.35}" font-size="${px}" font-weight="700" text-anchor="middle" fill="currentColor" font-family="system-ui, sans-serif">A</text></svg>`, noteFont(item) === size, () => change({ fs: size === NOTE_TEXT ? undefined : size })));
        }
        rule();
        swatches(PALETTE.map(pastel), item.color, 'color');
      } else if (editable && item.kind === 'arrow') {
        for (const heads of ARROW_HEADS) {
          const saved = this.style.heads;
          this.style.heads = heads;
          const icon = this.toolIcon('arrow');
          this.style.heads = saved;
          parts.push(button(s.headNames[heads], `<svg viewBox="0 0 24 24">${icon}</svg>`, item.heads === heads, () => change({ heads })));
        }
        rule();
        swatches(PALETTE, item.color, 'color');
      } else if (editable && item.kind === 'pin') {
        for (const shape of PIN_SHAPES) {
          const icon = pinHead(shape, 12, 12, 7, { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }).outerHTML;
          parts.push(button(`${s.shapeLabel}: ${s.pinShapeNames[shape]}`, `<svg viewBox="0 0 24 24">${icon}</svg>`, (item.shape ?? 'round') === shape, () => change({ shape: shape === 'round' ? undefined : shape })));
        }
        rule();
        swatches(PALETTE, item.color, 'color');
      }
      if (mine) {
        rule();
        const level = item.lock ?? 'open';
        const next = { open: 'owner', owner: 'all', all: undefined }[level];
        const body = { open: '<path d="M8 11V8a4 4 0 0 1 7.6-1.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>', owner: '<path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>', all: '<path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="#c42b31" stroke-width="2" stroke-linecap="round"/><rect x="5" y="11" width="14" height="9" rx="2" fill="#c42b31"/>' }[level];
        parts.push(button(s.lockNames[level], `<svg viewBox="0 0 24 24">${body}</svg>`, level !== 'open', () => change({ lock: next })));
      }
      this.selbar.replaceChildren(...parts);
      this.selbar.dataset.sig = sig;
      this.selbar.dataset.id = item.id;
    }
    this.selbar.hidden = this.selbar.childElementCount === 0;
    this.placeSelbar(item);
  }

  /**
   * @private The bar over a selection of several items: how many there are and the colours, which
   * change those of them that have one and may be changed (a note takes the pale version).
   */
  renderGroupBar() {
    const items = [...this.group].map((id) => this.model.get(id)).filter(Boolean);
    const coloured = items.filter((i) => COLORED.has(i.kind) && this.canEdit(i));
    const sig = items.map((i) => `${i.id}@${i.stamp[0]}.${i.stamp[1]}`).join(' ');
    if (this.readOnlyFlag || items.length === 0) {
      this.selbar.hidden = true;
      this.selbar.replaceChildren();
      delete this.selbar.dataset.sig;
      delete this.selbar.dataset.id;
      return;
    }
    if (this.selbar.dataset.sig !== sig || this.selbar.dataset.id !== '*') {
      const s = this.strings;
      const parts = [htmlEl('span', { class: 'count' }, `${items.length} ${s.selectedCount}`)];
      const tone = (i, c) => (i.kind === 'note' ? pastel(c) : c);
      const colours = new Set(coloured.map((i) => i.color.toLowerCase()));
      if (coloured.length > 0) {
        parts.push(htmlEl('hr'));
        for (const [n, c] of PALETTE.entries()) {
          const pressed = coloured.every((i) => i.color.toLowerCase() === tone(i, c).toLowerCase()) && colours.size > 0;
          const b = htmlEl('button', { type: 'button', title: `${s.color}: ${COLOR_NAMES[n]}`, 'aria-label': `${s.color}: ${COLOR_NAMES[n]}`, 'aria-pressed': String(pressed) }, `<span class="swatch" style="background:${c}"></span>`);
          b.addEventListener('pointerdown', (e) => e.preventDefault());
          b.addEventListener('click', () => {
            for (const i of coloured) {
              const now = this.model.get(i.id);
              if (now && this.canEdit(now)) {
                this.local(() => this.model.change(i.id, { color: tone(now, c) }));
              }
            }
          });
          parts.push(b);
        }
      }
      this.selbar.replaceChildren(...parts);
      this.selbar.dataset.sig = sig;
      this.selbar.dataset.id = '*';
    }
    this.selbar.hidden = false;
    this.placeSelbar();
  }

  /**
   * @private The selection bar sits over the middle top of the item (a thread: the middle of it).
   * It is kept inside the board's visible area: moved sideways near the left or right edge, and
   * put under the item when there is no room over it.
   */
  placeSelbar(item = this.selected ? this.model.get(this.selected) : null) {
    const group = this.group.size > 0 ? [...this.group].map((id) => this.model.get(id)).filter(Boolean) : [];
    if ((!item && group.length === 0) || this.selbar.hidden) {
      return;
    }
    let above;
    let below;
    if (group.length > 0) {
      const b = this.bounds(group);
      above = { x: b.x + b.width / 2, y: b.y - 22 };
      below = { x: above.x, y: b.y + b.height + 22 };
    } else if (item.kind === 'arrow') {
      const a = pinPoint(this.model.get(item.from), this.lookup);
      const b = pinPoint(this.model.get(item.to), this.lookup);
      above = a && b ? { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + 30 } : null;
      below = above;
    } else if (DRAWN.has(item.kind)) {
      const b = this.bounds([item]);
      above = { x: b.x + b.width / 2, y: b.y - 22 };
      below = { x: above.x, y: b.y + b.height + 22 };
    } else {
      const h = item.kind === 'pin' ? 0 : item.size * (item.kind === 'link' ? 0.5 : item.ratio);
      const where = item.kind === 'pin' ? pinPoint(item, this.lookup) : item; // a pin on something is where it is drawn
      above = { x: where.x, y: where.y - h / 2 - 22 };
      below = { x: where.x, y: where.y + h / 2 + 22 };
    }
    if (!above) {
      return;
    }
    // The area the board is shown in: the host, cut to the adapter's clip if any.
    const clip = this.adapter.clip?.() ?? null;
    const W = this.host.clientWidth;
    const H = this.host.clientHeight;
    const x0 = clip ? Math.max(0, clip.x) : 0;
    const y0 = clip ? Math.max(0, clip.y) : 0;
    const x1 = clip ? Math.min(W || Infinity, clip.x + clip.width) : W;
    const y1 = clip ? Math.min(H || Infinity, clip.y + clip.height) : H;
    const margin = 4;
    // Its size (none before layout, as in tests without one: then a usual bar's).
    const w = this.selbar.offsetWidth || 240;
    const h = this.selbar.offsetHeight || 38;
    const p = this.toBox(above.x, above.y);
    const q = this.toBox(below.x, below.y);
    // The bar's anchor is its bottom middle (it is moved up by its height and left by half its width).
    let top = p.y;
    if (y1 > y0 && top - h < y0 + margin) {
      top = q.y + h <= y1 - margin ? q.y + h : y0 + margin + h; // under the item, or else at the top edge
    }
    let left = p.x;
    if (x1 > x0) {
      left = Math.max(x0 + margin + w / 2, Math.min(x1 - margin - w / 2, left));
    }
    this.selbar.style.left = `${left}px`;
    this.selbar.style.top = `${top}px`;
  }

  /**
   * @private While an element is dragged by its pin, or a bare pin is dragged: the element it would
   * be attached to if it were dropped now (if any) is outlined, and for an element the ring is
   * around its pin.
   */
  showPinDrag(d, dx, dy, p) {
    let target = null;
    if (d.byPin) {
      const at = pinPoint(d.item, this.lookup);
      d.ring.setAttribute('cx', at.x + dx);
      d.ring.setAttribute('cy', at.y + dy);
      target = this.hostUnder(d.item, p);
    } else if (d.item.kind === 'pin') {
      // Where the pin would be dropped, as `up` attaches it.
      target = this.model.get(this.attachment({ x: d.item.x + dx, y: d.item.y + dy }, d.item.id).on);
    } else {
      return;
    }
    if (target?.id !== d.target) {
      this.nodes.get(d.target)?.node.classList.remove('drop-target');
      this.nodes.get(target?.id)?.node.classList.add('drop-target');
      d.target = target?.id;
    }
  }

  /** @private Takes the outlines of a pin drag away. */
  endPinDrag(d) {
    if (d.byPin) {
      d.ring.remove();
      this.nodes.get(d.item.id)?.node.classList.remove('by-pin');
    }
    this.nodes.get(d.target)?.node.classList.remove('drop-target');
  }

  /**
   * @private Changes an element and moves what is attached to it along (their places on it are
   * kept). What is locked against this person stays where it is.
   */
  commit(item, fields) {
    const old = this.model.get(item.id);
    if (!old) {
      return;
    }
    const live = this.model.live();
    const next = { ...old, ...fields };
    if (!this.local(() => this.model.change(item.id, fields))) {
      return;
    }
    for (const [id, moved] of followers(live, old, next)) {
      const c = this.model.get(id);
      if (c && this.canEdit(c)) {
        this.local(() => this.model.change(id, { x: moved.x, y: moved.y, rot: moved.rot }));
      }
    }
  }

  /** @private The element under `drop` that `item` would be attached to if dropped there, or null (never one that sits on `item`). */
  hostUnder(item, drop) {
    const live = this.pageItems();
    const held = followers(live, item, item);
    for (let i = live.length - 1; i >= 0; --i) {
      const frame = live[i].id === item.id || held.has(live[i].id) ? null : hostFrame(live[i]);
      if (frame && frameOf(frame, drop)) {
        return live[i];
      }
    }
    return null;
  }

  /**
   * @private What an element holds about the one it is on, once it is as `geometry` says: when it
   * was grabbed by its pin and dropped at `drop` it is attached to the element under that point (or
   * detached from the one it was on, if none); else, if it is attached, its place on it is
   * updated (it was moved, scaled or turned). Fields that are not changed are not returned.
   */
  anchorFields(item, geometry, drop) {
    const none = { on: undefined, u: undefined, v: undefined, dr: undefined };
    let host = null;
    if (drop) {
      host = this.hostUnder(item, drop);
    } else if (item.on) {
      host = this.model.get(item.on);
    }
    const frame = hostFrame(host);
    if (!frame) {
      return item.on ? none : {};
    }
    const at = frameCoords(frame, centre(geometry));
    return { on: host.id, u: at.u, v: at.v, dr: degrees((geometry.rot ?? 0) - (host.rot ?? 0)) || undefined };
  }

  /** @private The pointer position in a note's own frame (origin at its centre, turned back). */
  inNote(item, p) {
    const a = ((item.rot ?? 0) * Math.PI) / 180;
    const c = centre(item);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return { x: dx * Math.cos(a) + dy * Math.sin(a), y: -dx * Math.sin(a) + dy * Math.cos(a) };
  }

  /** @private Whether `p` is on the bottom right corner of a note, the handle that resizes it. */
  onCorner(item, p) {
    const l = this.inNote(item, p);
    const g = gripOf(item);
    return Math.hypot(l.x - g.x, l.y - g.y) <= 14;
  }

  /**
   * @private Moves the item grabbed; for a sticker or an image, Shift scales it and Ctrl (or Alt)
   * turns it about its centre instead.
   */
  drag(ev) {
    const d = this.dragging;
    const it = d.item;
    const p = this.eventPoint(ev);
    const dx = p.x - d.from.x;
    const dy = p.y - d.from.y;
    if (!d.moved && Math.hypot(dx, dy) < 2) {
      return;
    }
    if (!d.moved) {
      this.selbar.classList.add('moving'); // out of the way of where it is put down
    }
    d.moved = true;
    if (d.corner) {
      // The top left corner stays where it is; the pointer pulls the bottom right one.
      const a = ((it.rot ?? 0) * Math.PI) / 180;
      const l = this.inNote(it, p);
      // The grip follows the pointer: its place on the new size is (s + 1) / 2 of it, less 9, from the top left.
      const picture = it.kind === 'image'; // a picture keeps its proportions
      const k = 2 / (1 + gripOf(it).s);
      const wide = (l.x + it.size / 2 + 9) * k;
      const high = (l.y + (it.size * it.ratio) / 2 + 9) * k;
      const w = picture ? Math.min(2000, Math.max(8, wide, high / it.ratio)) : Math.min(600, Math.max(60, wide));
      const h = picture ? w * it.ratio : Math.min(600, Math.max(0.3 * w, high));
      const cx = w / 2 - it.size / 2;
      const cy = h / 2 - (it.size * it.ratio) / 2;
      const c = centre(it);
      const ratio = picture ? it.ratio : Math.round(Math.min(3, Math.max(0.3, h / w)) * 1000) / 1000;
      const to = fromCentre({ ...it, size: w, ratio }, { x: c.x + cx * Math.cos(a) - cy * Math.sin(a), y: c.y + cx * Math.sin(a) + cy * Math.cos(a) }, it.rot ?? 0);
      d.fields = { size: round1(w), ratio, x: round1(to.x), y: round1(to.y) };
      d.preview = true;
      this.showPreview(it, d.fields);
      this.followThreads({ ...it, ...d.fields });
      return;
    }
    const flat = it.kind === 'sticker' || it.kind === 'image' || it.kind === 'link' || it.kind === 'note';
    const scaling = flat && ev.shiftKey && it.kind !== 'image'; // a picture is resized from its corner: Shift copies it out
    const turning = flat && (ev.ctrlKey || ev.metaKey || ev.altKey);
    if (scaling || turning) {
      const fields = {};
      if (scaling) {
        const c = centre(it);
        const grown = (it.size * Math.max(1, Math.hypot(p.x - c.x, p.y - c.y))) / Math.max(1, Math.hypot(d.from.x - c.x, d.from.y - c.y));
        const [lo, hi] = { image: [8, 2000], link: [40, 1000], note: [60, 600] }[it.kind] ?? [4, 400];
        fields.size = round1(Math.min(hi, Math.max(lo, grown)));
      }
      if (turning) {
        const pivot = pinPoint(it) ?? it; // what is pinned turns about its pin
        const a = Math.atan2(p.y - pivot.y, p.x - pivot.x) - Math.atan2(d.from.y - pivot.y, d.from.x - pivot.x);
        fields.rot = degrees((it.rot ?? 0) + (a * 180) / Math.PI);
      }
      d.fields = fields;
      d.preview = true;
      this.showPreview(it, fields);
      this.followThreads({ ...it, ...fields });
    } else {
      if (d.preview) {
        d.preview = false;
        this.showPreview(it, {});
      }
      d.fields = null;
      d.dx = dx;
      d.dy = dy;
      this.showPinDrag(d, dx, dy, p);
      this.nodes.get(it.id)?.node.setAttribute('transform', `translate(${dx} ${dy})`);
      this.followThreads(it.kind === 'ink' ? it : { ...it, x: it.x + dx, y: it.y + dy, ...(it.kind === 'pin' ? { on: undefined } : {}) });
    }
  }

  /**
   * @private Redraws what hangs on `item` as if it were as given (it is being moved or changed): the
   * elements attached to it, the pins on those, and the threads tied to any of them.
   */
  followThreads(item) {
    if (this.editing?.note && this.editing.item.id === item.id) {
      this.editing.preview = item; // the text box follows the note
      this.placeTextarea();
    }
    const live = this.model.live();
    const old = this.model.get(item.id);
    const same = !old || ['x', 'y', 'rot', 'size', 'ratio'].every((k) => old[k] === item[k]);
    const over = new Map([[item.id, item]]);
    if (!same) {
      for (const [id, moved] of followers(live, old, item)) {
        over.set(id, moved);
      }
    }
    const resolve = (id) => over.get(id) ?? this.model.get(id);
    const moved = new Set([...over.keys(), ...live.filter((i) => i.kind === 'pin' && over.has(i.on)).map((i) => i.id)]);
    const redraw = (i) => {
      const entry = this.nodes.get(i.id);
      if (entry) {
        const node = this.itemNode(i, resolve);
        entry.node.replaceWith(node);
        entry.node = node;
      }
    };
    for (const i of live) {
      if (i.id === item.id) {
        continue;
      }
      if (over.has(i.id)) {
        redraw(over.get(i.id));
      } else if ((i.kind === 'pin' && moved.has(i.id)) || (i.kind === 'arrow' && (moved.has(i.from) || moved.has(i.to)))) {
        redraw(i);
      }
    }
  }

  /** @private Shows an item with other fields until the change is made (or given up). */
  showPreview(item, fields) {
    const entry = this.nodes.get(item.id);
    if (entry) {
      const node = this.itemNode({ ...item, ...fields });
      entry.node.replaceWith(node);
      entry.node = node;
    }
  }

  /** @private */
  sendInk() {
    const d = this.drawing;
    const from = Math.max(0, d.sent - 2); // overlap one point so segments join
    const pts = d.points.slice(from, from + 400).map(round1);
    d.sent = from + pts.length;
    this.send({ t: 'ink', id: d.id, seq: d.seq++, pts, color: this.style.color, width: this.style.width, pg: this.page }, { fast: true });
  }

  /** @private */
  up(ev, cancelled = false) {
    if (this.lasing) {
      this.sendLaser();
      this.lasing = null;
    } else if (this.emoteWheel && !this.emoteWheel.sticky) {
      // Let go on an emote: it is put where the wheel opened. Let go in the middle, after a click:
      // the wheel stays open for a click on one (and closes on a click anywhere else).
      if (!cancelled && this.emoteWheel.choice < 0 && !this.emoteWheel.moved) {
        this.emoteWheel.sticky = true;
      } else {
        this.closeWheel(!cancelled);
      }
    } else if (this.drawing) {
      const d = this.drawing;
      this.drawing = null;
      d.node.remove();
      if (!cancelled) {
        this.local(() => this.model.add({ kind: 'ink', points: simplifyPoints(d.points), color: this.style.color, width: this.style.width }));
      }
    } else if (this.threading) {
      const t = this.threading;
      this.threading = null;
      this.selbar.classList.remove('moving');
      t.node.remove();
      t.ring.remove();
      t.dot?.remove();
      const end = this.eventPoint(ev);
      const target = cancelled ? null : this.threadTarget(end, t);
      const host = cancelled || target ? null : this.threadHost(end, t);
      // The pin the thread starts from: the one pressed on, or a new one where the element was pressed.
      const from = () => t.from ?? this.addPin(t.origin.at);
      if (target) {
        const source = from();
        if (source) {
          this.addArrow(source, target.id);
        }
      } else if (host) {
        // Let go over an element: a pin is put there, on it, and the thread is tied to that pin.
        const source = from();
        const pin = source ? this.addPin(end) : null;
        if (pin) {
          this.addArrow(source, pin);
        }
      } else if (t.from && !cancelled && Math.hypot(ev.clientX - t.x0, ev.clientY - t.y0) < 4) {
        // Pressed and let go on the pin: it is selected, if it is yours and can be changed.
        const source = this.model.get(t.from);
        if (source && SELECTABLE.has(source.kind)) {
          this.select(source.id);
        }
      }
      if (t.restore) {
        this.setTool(t.restore);
      }
    } else if (this.erasing) {
      const ids = [...this.erasing];
      this.erasing = null;
      for (const id of ids) {
        this.nodes.get(id)?.node.classList.remove('erasing');
        if (!cancelled) {
          this.local(() => this.model.remove(id));
        }
      }
    } else if (this.dragging) {
      const d = this.dragging;
      const it = d.item;
      this.dragging = null;
      this.selbar.classList.remove('moving');
      this.endPinDrag(d);
      this.nodes.get(it.id)?.node.removeAttribute('transform');
      if (d.preview) {
        this.showPreview(it, {});
      }
      if (d.moved) {
        this.followThreads(it);
      }
      if (d.moved) {
        this.noClick = true;
        setTimeout(() => {
          this.noClick = false;
        }, 50);
      }
      if (d.moved && !cancelled) {
        if (d.fields) {
          this.commit(it, { ...d.fields, ...this.anchorFields(it, { ...it, ...d.fields }, null) });
        } else if (it.kind === 'ink') {
          this.local(() => this.model.change(it.id, { points: it.points.map((v, i) => round1(v + (i % 2 ? d.dy : d.dx))) }));
        } else if (it.kind === 'pin') {
          const to = { x: round1(it.x + d.dx), y: round1(it.y + d.dy) };
          this.local(() => this.model.change(it.id, { ...to, ...this.attachment(to, it.id) }));
        } else {
          const to = { x: round1(it.x + d.dx), y: round1(it.y + d.dy) };
          this.commit(it, { ...to, ...this.anchorFields(it, { ...it, ...to }, d.byPin ? this.eventPoint(ev) : null) });
        }
      } else if (!d.moved && it.kind === 'text' && this.tool === 'text' && !cancelled) {
        this.editText(it);
      } else if (!d.moved && it.kind === 'note' && !cancelled && this.canEdit(it)) {
        this.editNote(it);
      }
      if (this.editing?.note && this.editing.item.id === it.id) {
        this.editing.preview = null; // the note is where it was put: the text box follows it there
        this.placeTextarea();
      }
    } else if (this.groupDrag) {
      this.endGroupDrag(ev, cancelled);
    } else if (this.pendingNote) {
      const n = this.pendingNote;
      const b = cancelled ? null : this.noteDrag(ev);
      this.pendingNote = null;
      n.rect?.remove();
      if (cancelled) {
        return;
      }
      // A click puts a note of the usual size there; a drag puts one over the dragged bounds.
      const id = b ? this.addNote({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, '', { width: b.w, height: b.h }) : this.addNote(n.from);
      this.setTool('pointer');
      if (id) {
        this.select(id); // its bar is there to change it as it is written
        this.editNote(this.model.get(id));
      }
    } else if (this.pendingText && !cancelled) {
      const p = this.pendingText;
      this.pendingText = null;
      this.editText(null, p);
    }
  }

  /**
   * @private Starts a thread from the pin of `source`. `restore` is the tool to go back to when it
   * is let go (a thread pulled from a pin with another tool in hand), or null. With `origin` (a
   * point `at` on the element `host`) and no source, it starts from a pin not put yet, shown there.
   */
  beginThread(source, ev, restore, origin = null) {
    this.popover.hidden = true;
    this.board.setPointerCapture?.(ev.pointerId);
    const node = svgEl('path', { fill: 'none', stroke: this.style.color, 'stroke-width': 2.6, 'stroke-linecap': 'round', opacity: 0.8 });
    const ring = svgEl('circle', { r: PIN_RADIUS + 4, fill: 'none', stroke: 'var(--wb-accent, #3e63dd)', 'stroke-width': 2, 'pointer-events': 'none' });
    this.threading = { from: source, origin, node, ring, restore, x0: ev.clientX, y0: ev.clientY };
    this.selbar.classList.add('moving');
    if (origin) {
      this.threading.dot = svgEl('circle', { class: 'pending-pin', cx: origin.at.x, cy: origin.at.y, r: PIN_RADIUS, fill: this.style.color, stroke: 'rgba(0,0,0,0.4)', 'stroke-width': 0.8, opacity: 0.8, 'pointer-events': 'none' });
      this.liveGroup.append(this.threading.dot);
    }
    this.liveGroup.append(node, ring);
    this.dragThread(ev);
  }

  /**
   * @private Shift+press on a pin and drag pulls a thread from it, whatever tool is in hand (the
   * thread tool for as long as the button is down); a plain drag moves the pin, as with any item.
   * The pin wins over what is under it (a thread, the note it is on), so it is easy to hit.
   */
  pinGesture(ev) {
    if (this.readOnlyFlag || ev.button !== 0 || !ev.shiftKey || this.threading || this.tool === 'pen' || this.tool === 'eraser' || this.tool === 'arrow' || this.onControls(ev)) {
      return;
    }
    const source = this.pinAt(this.eventPoint(ev));
    if (!source) {
      return;
    }
    const restore = this.tool;
    this.setTool('arrow');
    ev.preventDefault();
    ev.stopPropagation();
    this.beginThread(source.id, ev, restore);
  }

  /** @private While a thread is being pulled: it hangs from the source pin to the pointer, snapping to a pin in reach. */
  dragThread(ev) {
    const t = this.threading;
    const from = t.origin ? t.origin.at : pinPoint(this.model.get(t.from), this.lookup);
    if (!from) {
      return;
    }
    const p = this.eventPoint(ev);
    const target = this.threadTarget(p, t);
    const end = target ? pinPoint(target, this.lookup) : p;
    t.node.setAttribute('d', threadCurve(from, end, 0.5).d);
    t.ring.setAttribute('cx', end.x);
    t.ring.setAttribute('cy', end.y);
    // The ring shows where it will be tied: a pin in reach, or a new pin on the element under it.
    t.ring.style.display = target || this.threadHost(p, t) ? '' : 'none';
  }

  /** @private The element the thread being pulled `t` starts on (its source, or what its pin is on), or null. */
  threadElement(t) {
    if (t.origin) {
      return t.origin.host;
    }
    const source = this.model.get(t.from);
    return source?.kind === 'pin' ? (source.on ?? null) : (source?.id ?? null);
  }

  /**
   * @private The pin in reach of `p` that the thread being pulled `t` would be tied to. A thread
   * from a pin not put yet is not tied to its own element, nor to a pin on it.
   */
  threadTarget(p, t) {
    const target = this.pinAt(p, t.from);
    if (target && t.origin && (target.id === t.origin.host || (target.kind === 'pin' && target.on === t.origin.host))) {
      return null;
    }
    return target;
  }

  /**
   * @private The element (a note, picture, link or sticker) under `p` that the thread being pulled
   * `t` would get a new pin on when let go there; null over the board, or over the element the
   * thread starts on (a thread from an element to itself).
   */
  threadHost(p, t) {
    const host = this.attachment(p, null).on;
    if (!host || host === this.threadElement(t)) {
      return null;
    }
    return host;
  }

  /**
   * @private A press with the pointer (the cursor or the magnifier) on the board where there is no
   * item starts a sweep: what the pointer passes over while it is held is selected, as the eraser
   * marks what it passes over. Touch is left to the page (and pans the board when zoomed in), and
   * Space+drag pans.
   */
  sweepStart(ev) {
    const path = ev.composedPath();
    if (ev.button !== 0 || this.tool !== 'pointer' || !PASSIVE_MODES.has(this.style.pointerMode) || this.readOnlyFlag || this.editing || this.threading || this.spaceHeld || ev.pointerType === 'touch' || path.includes(this.host) || this.onControls(ev)) {
      return;
    }
    this.sweeping = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, active: false, ids: new Set(), points: [], node: null };
    this.container.setPointerCapture?.(ev.pointerId);
  }

  /** @private The sweep goes on: every few pixels along the way, the item under the pointer is taken. */
  sweepMove(ev) {
    const w = this.sweeping;
    if (!w || ev.pointerId !== w.id) {
      return;
    }
    if (!w.active) {
      if (Math.hypot(ev.clientX - w.x, ev.clientY - w.y) < 4) {
        return;
      }
      w.active = true;
      w.node = svgEl('path', { class: 'sweep', 'vector-effect': 'non-scaling-stroke' });
      this.liveGroup.append(w.node);
      this.takeAt(w.x, w.y);
    }
    // Along the segment, so a quick move does not jump over a small item.
    const steps = Math.max(1, Math.ceil(Math.hypot(ev.clientX - w.x, ev.clientY - w.y) / 4));
    for (let k = 1; k <= steps; ++k) {
      this.takeAt(w.x + ((ev.clientX - w.x) * k) / steps, w.y + ((ev.clientY - w.y) * k) / steps);
    }
    w.x = ev.clientX;
    w.y = ev.clientY;
    w.node.setAttribute('d', inkPath(w.points));
  }

  /** @private The item under the screen point (x, y) joins the sweep (a pin wins over what it is on). */
  takeAt(x, y) {
    const w = this.sweeping;
    const at = { clientX: x, clientY: y };
    const p = this.eventPoint(at);
    w.points.push(round1(p.x), round1(p.y));
    const hit = this.pinAt(p) ?? this.itemAt(at);
    if (hit && !w.ids.has(hit.id)) {
      w.ids.add(hit.id);
      this.nodes.get(hit.id)?.node.classList.add('selected');
    }
  }

  /** @private Letting go ends the sweep: what it passed over is selected (nothing, if it was cancelled). */
  sweepEnd(ev, cancelled = false) {
    const w = this.sweeping;
    if (!w || ev.pointerId !== w.id) {
      return;
    }
    this.sweeping = null;
    this.container.releasePointerCapture?.(ev.pointerId);
    w.node?.remove();
    for (const id of w.ids) {
      this.nodes.get(id)?.node.classList.remove('selected');
    }
    if (w.active && !cancelled) {
      this.selectItems(w.ids);
    }
  }

  /**
   * @private A press on an item of a selection of several starts moving them all. What is locked
   * against this person stays, and what sits on an item that moves goes along with it (as when
   * that item is moved alone), so it is not moved twice.
   */
  beginGroupDrag(ev, p) {
    const movable = new Map([...this.group].map((id) => this.model.get(id)).filter((i) => i && i.kind !== 'arrow' && this.canEdit(i)).map((i) => [i.id, i]));
    const carried = (i) => {
      let on = i.on;
      for (let k = 0; on && k < 8; ++k) {
        if (movable.has(on)) {
          return true;
        }
        on = this.model.get(on)?.on;
      }
      return false;
    };
    const roots = [...movable.values()].filter((i) => !carried(i));
    // What is drawn moving: the items, what sits on them, and the pins on any of those.
    const live = this.model.live();
    const shown = new Set(roots.map((i) => i.id));
    for (const r of roots) {
      if (hostFrame(r)) {
        for (const id of followers(live, r, r).keys()) {
          shown.add(id);
        }
      }
    }
    for (const i of live) {
      if (i.kind === 'pin' && shown.has(i.on)) {
        shown.add(i.id);
      }
    }
    const threads = live.filter((i) => i.kind === 'arrow' && (shown.has(i.from) || shown.has(i.to)));
    this.groupDrag = { id: ev.pointerId, from: p, x0: ev.clientX, y0: ev.clientY, dx: 0, dy: 0, moved: false, roots: roots.map((i) => i.id), shown, threads: threads.map((i) => i.id), pressed: null };
    ev.preventDefault();
    this.popover.hidden = true;
    this.board.setPointerCapture?.(ev.pointerId);
  }

  /** @private How an item of the selection being moved is drawn for now, `dx`, `dy` away. */
  movedBy(i, dx, dy) {
    if (i.kind === 'ink') {
      return { ...i, points: i.points.map((v, k) => v + (k % 2 ? dy : dx)) };
    }
    if (i.kind === 'pin') {
      const at = pinPoint(i, this.lookup);
      return { ...i, x: at.x + dx, y: at.y + dy, on: undefined };
    }
    return { ...i, x: i.x + dx, y: i.y + dy };
  }

  /** @private While the selection is moved: its nodes are shifted and the threads tied to them redrawn. */
  dragGroup(ev) {
    const g = this.groupDrag;
    const p = this.eventPoint(ev);
    g.dx = p.x - g.from.x;
    g.dy = p.y - g.from.y;
    if (!g.moved && Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0) < 3) {
      return;
    }
    if (!g.moved) {
      this.selbar.classList.add('moving');
    }
    g.moved = true;
    this.showGroupAt(g.dx, g.dy);
  }

  /** @private Draws the selection being moved `dx`, `dy` away from where it is (0, 0: where it is). */
  showGroupAt(dx, dy) {
    const g = this.groupDrag;
    for (const id of g.shown) {
      const node = this.nodes.get(id)?.node;
      if (dx || dy) {
        node?.setAttribute('transform', `translate(${dx} ${dy})`);
      } else {
        node?.removeAttribute('transform');
      }
    }
    const resolve = (id) => {
      const i = this.model.get(id);
      return i && g.shown.has(id) ? this.movedBy(i, dx, dy) : i;
    };
    for (const id of g.threads) {
      const entry = this.nodes.get(id);
      const item = this.model.get(id);
      if (entry && item) {
        const node = this.itemNode(item, resolve);
        entry.node.replaceWith(node);
        entry.node = node;
      }
    }
  }

  /**
   * @private Letting go puts the selection where it was moved to. A press and release without a
   * move selects just the item pressed on.
   */
  endGroupDrag(ev, cancelled) {
    const g = this.groupDrag;
    this.showGroupAt(0, 0);
    this.groupDrag = null;
    this.selbar.classList.remove('moving');
    if (!g.moved) {
      if (!cancelled && g.pressed) {
        this.select(g.pressed);
      }
      return;
    }
    this.noClick = true;
    setTimeout(() => {
      this.noClick = false;
    }, 50);
    if (cancelled) {
      return;
    }
    const roots = g.roots.map((id) => this.model.get(id)).filter((i) => i && this.canEdit(i));
    // The elements first, so the pins are attached to where those are now.
    for (const it of roots.filter((i) => i.kind !== 'pin')) {
      if (it.kind === 'ink') {
        this.local(() => this.model.change(it.id, { points: it.points.map((v, k) => round1(v + (k % 2 ? g.dy : g.dx))) }));
      } else {
        const to = { x: round1(it.x + g.dx), y: round1(it.y + g.dy) };
        this.commit(it, { ...to, ...this.anchorFields(it, { ...it, ...to }, null) });
      }
    }
    for (const it of roots.filter((i) => i.kind === 'pin')) {
      const at = pinPoint(it, this.lookup);
      const to = { x: round1(at.x + g.dx), y: round1(at.y + g.dy) };
      this.local(() => this.model.change(it.id, { ...to, ...this.attachment(to, it.id) }));
    }
    this.render();
  }

  /**
   * @private What a copy of the selection takes: the items selected, what sits on them and the pins
   * on those, and the threads between any two of them; in drawing order. A pin on something left
   * behind is taken where it is drawn.
   */
  copySet() {
    const ids = new Set(this.selection());
    const live = this.pageItems();
    for (let grew = true; grew; ) {
      grew = false;
      for (const i of live) {
        if (!ids.has(i.id) && i.on && ids.has(i.on) && (i.kind === 'pin' || ELEMENTS.has(i.kind))) {
          ids.add(i.id);
          grew = true;
        }
      }
    }
    for (const i of live) {
      if (i.kind === 'arrow' && ids.has(i.from) && ids.has(i.to)) {
        ids.add(i.id);
      }
    }
    return live.filter((i) => ids.has(i.id) && !(i.kind === 'arrow' && !(ids.has(i.from) && ids.has(i.to)))).map((i) => (i.kind === 'pin' && i.on && !ids.has(i.on) ? { ...i, ...pinPoint(i, this.lookup) } : i));
  }

  /**
   * @private Ctrl+C (and Ctrl+X, which then takes down what may be): the selection goes on the
   * clipboard as items (their texts as plain text), and the files of its pictures are kept here to
   * go with what is pasted on this board.
   */
  copied(ev, cut) {
    const t = ev.target;
    const text = typeof document.getSelection === 'function' ? document.getSelection() : null;
    if (this.editing || this.selection().length === 0 || !ev.clipboardData || t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? '') || (text && !text.isCollapsed)) {
      return;
    }
    const items = this.copySet();
    const key = `${this.model.peerId}.${Math.floor(this.random() * 1e9)}`;
    const blobs = new Map();
    for (const i of items) {
      if (i.kind === 'image' && this.files.has(i.id)) {
        blobs.set(i.id, this.files.get(i.id));
      }
    }
    this.clipboard = { key, blobs };
    ev.clipboardData.setData(CLIP_TYPE, JSON.stringify({ format: CLIP_FORMAT, key, items }));
    ev.clipboardData.setData('text/plain', items.filter((i) => i.kind === 'note' || i.kind === 'text').map((i) => i.text).filter(Boolean).join('\n'));
    ev.preventDefault();
    if (cut && !this.readOnlyFlag) {
      this.removeSelected();
    }
  }

  /**
   * @private Pastes items copied from a board: new ones of this person on the canvas shown, put
   * around the pointer (or a little away from the originals), and selected.
   * @returns {boolean} whether the clipboard held items
   */
  pasteItems(data) {
    let raw;
    try {
      raw = JSON.parse(data?.getData(CLIP_TYPE) || 'null');
    } catch {
      return false;
    }
    if (raw?.format !== CLIP_FORMAT || !Array.isArray(raw.items) || raw.items.length > LIMITS.items) {
      return false;
    }
    const kept = raw.items.map((i) => cleanItem(i)).filter((i) => i && !i.deleted);
    if (kept.length === 0) {
      return true;
    }
    const b = this.bounds(kept);
    const at = this.lastPoint;
    const dx = at ? round1(at.x - (b.x + b.width / 2)) : 20;
    const dy = at ? round1(at.y - (b.y + b.height / 2)) : 20;
    const blobs = raw.key === this.clipboard?.key ? this.clipboard.blobs : new Map();
    const { ops, files, ids } = this.placeCopies(kept, (id) => blobs.get(id) ?? null, { dx, dy, page: this.page, record: true });
    if (ops.length < kept.length) {
      this.emit('error', new WhiteboardError(`The whiteboard is full (${LIMITS.items} items, ${LIMITS.images} images): not everything was pasted.`));
    }
    this.render();
    this.emit('change', { source: 'local' });
    this.drip(ops, files);
    this.selectItems(ids.values());
    return true;
  }

  /** @private Marks the items under the eraser; they go on pointer up. */
  eraseAt(ev) {
    const hit = this.itemAt(ev);
    if (hit && this.canEdit(hit) && !this.erasing.has(hit.id)) {
      this.erasing.add(hit.id);
      this.nodes.get(hit.id)?.node.classList.add('erasing');
    }
  }

  /** @private A text box over the note being written (a new one at `at`). */
  editText(item, at) {
    this.finishText();
    const ta = htmlEl('textarea', { class: 'note', maxlength: String(LIMITS.text), rows: '1', 'aria-label': this.strings.typeHere, placeholder: this.strings.typeHere });
    ta.value = item?.text ?? '';
    this.editing = { item, x: item?.x ?? at.x, y: item?.y ?? at.y, size: item?.size ?? this.style.size, color: item?.color ?? this.style.color, node: ta };
    if (item) {
      this.nodes.get(item.id)?.node.setAttribute('opacity', '0');
    }
    ta.style.color = this.editing.color;
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.finishText(false);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.finishText(true);
      }
    });
    ta.addEventListener('input', () => this.sizeTextarea());
    ta.addEventListener('blur', () => this.finishText(true));
    this.root.append(ta);
    this.placeTextarea();
    ta.focus();
  }

  /** @private A text box over the sticky note being written. Escape drops the change, Ctrl+Enter or a click away keeps it. */
  editNote(item) {
    this.finishText();
    const ta = htmlEl('textarea', { class: 'note sticky', maxlength: String(LIMITS.text), 'aria-label': this.strings.note, placeholder: this.strings.typeHere });
    ta.value = item.text;
    this.editing = { item, note: true, x: item.x, y: item.y, node: ta };
    this.nodes.get(item.id)?.node.classList.add('editing');
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.finishText(false);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.finishText(true);
      }
    });
    ta.addEventListener('input', () => this.padNote());
    ta.addEventListener('blur', () => this.finishText(true));
    this.root.append(ta);
    this.placeTextarea();
    ta.focus();
  }

  /** @private Centres the text of the note being written, the way the drawn note does. */
  padNote() {
    const e = this.editing;
    const it = e?.note ? (e.preview ?? this.model.get(e.item.id) ?? e.item) : null;
    if (!it) {
      return;
    }
    const scale = Math.hypot(this.matrix.a, this.matrix.b) || 1;
    const lines = wrapNote(e.node.value, noteTextWidth(it), noteFont(it)).length;
    const inset = SHAPE_INSET[it.shape ?? 'square'];
    e.node.style.paddingTop = `${Math.max(0, noteTextTop(it, lines) - (it.size * it.ratio * (1 - inset)) / 2) * scale}px`;
  }

  /** @private */
  placeTextarea() {
    const e = this.editing;
    if (e.note) {
      const it = e.preview ?? this.model.get(e.item.id) ?? e.item;
      const scale = Math.hypot(this.matrix.a, this.matrix.b) || 1;
      const here = centre(it);
      const c = this.toBox(here.x, here.y);
      const inset = SHAPE_INSET[it.shape ?? 'square'];
      const w = it.size * inset * scale;
      const h = it.size * it.ratio * inset * scale;
      Object.assign(e.node.style, {
        left: `${c.x - w / 2}px`,
        top: `${c.y - h / 2}px`,
        width: `${w}px`,
        height: `${h}px`,
        fontSize: `${noteFont(it) * scale}px`,
        paddingLeft: `${NOTE_PAD * scale}px`,
        paddingRight: `${NOTE_PAD * scale}px`,
        paddingBottom: '0',
        boxSizing: 'border-box',
        lineHeight: '1.25',
        textAlign: 'center',
        border: 'none',
        borderRadius: '0',
        background: 'transparent',
        color: '#1c2024',
        minWidth: '0',
        transformOrigin: '50% 50%',
        transform: `rotate(${it.rot ?? 0}deg)`,
      });
      this.padNote();
      return;
    }
    const p = this.toBox(e.x, e.y);
    const scale = Math.hypot(this.matrix.a, this.matrix.b) || 1;
    e.node.style.left = `${p.x - 5}px`;
    e.node.style.top = `${p.y - 3}px`;
    e.node.style.fontSize = `${e.size}px`;
    e.node.style.transform = `scale(${scale})`;
    this.sizeTextarea();
  }

  /** @private */
  sizeTextarea() {
    const ta = this.editing?.node;
    if (ta) {
      const lines = ta.value.split('\n');
      ta.style.width = `${Math.max(4, ...lines.map((l) => l.length + 1)) * 0.62}em`;
      ta.style.height = `${lines.length * 1.2 + 0.4}em`;
    }
  }

  /** @private Commits (or drops) the text being written. */
  finishText(commit = true) {
    const e = this.editing;
    if (!e) {
      return;
    }
    this.editing = null;
    e.node.remove();
    if (e.item) {
      this.nodes.get(e.item.id)?.node.removeAttribute('opacity');
      this.nodes.get(e.item.id)?.node.classList.remove('editing');
    }
    if (e.note) {
      const kept = e.node.value.replace(/\s+$/, '').slice(0, LIMITS.text);
      if (commit && kept !== e.item.text && this.model.get(e.item.id)) {
        this.local(() => this.model.change(e.item.id, { text: kept }));
      }
      return;
    }
    const text = e.node.value.replace(/\s+$/, '').slice(0, LIMITS.text);
    if (!commit) {
      return;
    }
    if (e.item && !text) {
      this.local(() => this.model.remove(e.item.id));
    } else if (e.item && text !== e.item.text) {
      this.local(() => this.model.change(e.item.id, { text }));
    } else if (!e.item && text) {
      this.local(() => this.model.add({ kind: 'text', x: round1(e.x), y: round1(e.y), size: e.size, text, color: e.color }));
    }
  }

  /**
   * @private The number keys choose the tools (1 is the first); Escape and undo/redo work only
   * while drawing, so the page keeps its own keys.
   */
  key(ev) {
    if (this.editing || ev.target?.closest?.('input, textarea, select, dialog, [contenteditable]')) {
      return;
    }
    const ctrl = ev.ctrlKey || ev.metaKey;
    let handled = true;
    if (!ctrl && !ev.altKey && /^[1-9]$/.test(ev.key) && this.slots[Number(ev.key) - 1]) {
      if (this.toolbarBox.style.display !== 'none') {
        this.chooseSlot(Number(ev.key));
      } else {
        handled = false;
      }
    } else if (!ctrl && !ev.altKey && ev.key === '0' && this.adapter.resetView) {
      this.resetZoom();
    } else if ((ev.key === 'Delete' || ev.key === 'Backspace') && ((this.selected && this.model.get(this.selected)) || this.group.size > 0)) {
      this.removeSelected();
    } else if (ev.key === 'Escape' && (this.selected || this.group.size > 0)) {
      this.deselect();
    } else if (ev.key === 'Escape' && this.emoteWheel) {
      this.closeWheel(false);
    } else if (ev.key === 'Escape' && this.pointerMode() !== 'cursor') {
      this.setStyle({ pointerMode: 'cursor' });
    } else if (this.tool === 'pointer') {
      handled = false;
    } else if (ev.key === 'Escape') {
      this.deselect();
      this.setTool('pointer');
    } else if (ctrl && !ev.shiftKey && (ev.key === 'z' || ev.key === 'Z')) {
      this.undo();
    } else if (ctrl && (ev.key === 'y' || ev.key === 'Y' || (ev.shiftKey && (ev.key === 'z' || ev.key === 'Z')))) {
      this.redo();
    } else {
      handled = false;
    }
    if (handled) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }

  /** @private */
  emit(event, detail) {
    for (const cb of this.listeners.get(event) ?? []) {
      try {
        cb(detail);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

/**
 * Creates a whiteboard over `container` (DESIGN.md section 5.2).
 * @returns {Whiteboard}
 */
export function createWhiteboard(container, options) {
  return new Whiteboard(container, options);
}

// ── Frame board (inksplat) ──────────────────────────────────────────────────────

/** The width of the frame in board units; its height is `FRAME_UNITS / aspect`. */
export const FRAME_UNITS = 1000;

/**
 * The largest rectangle of the given aspect (width / height) centred in a
 * `width` x `height` box: {x, y, width, height} in the box's pixels.
 */
export function letterbox(width, height, aspect) {
  if (!(width > 0) || !(height > 0) || !(aspect > 0) || !Number.isFinite(aspect)) {
    return { x: 0, y: 0, width: Math.max(width || 0, 0), height: Math.max(height || 0, 0) };
  }
  const w = Math.min(width, height * aspect);
  const h = w / aspect;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

/** The most the frame can be zoomed in. */
const MAX_ZOOM = 8;

/**
 * An adapter that maps board units (the frame is FRAME_UNITS wide) onto the
 * letterboxed frame inside `element`: the page viewport for the presenter,
 * the displayed video for a viewer.
 *
 * The frame can be zoomed (`zoomAt`) and moved (`panBy`); `content`, if given (the video), is
 * zoomed with it, so the drawings keep their place on the picture.
 *
 * @param {HTMLElement} element the box the frame is shown in
 * @param {() => number} aspect frame width / height, read on every layout
 * @param {HTMLElement} [content] the element showing the picture in that box, zoomed with the frame
 * @returns the adapter, plus `update()` to call when the aspect changes
 */
export function frameAdapter(element, aspect, content) {
  const callbacks = new Set();
  const view = { scale: 1, x: 0, y: 0 };
  const rect = () => letterbox(element.clientWidth, element.clientHeight, aspect());
  // Keeps the zoomed box covering the element, and shows it on the content.
  const fit = () => {
    view.scale = Math.min(MAX_ZOOM, Math.max(1, view.scale));
    view.x = Math.min(0, Math.max(element.clientWidth * (1 - view.scale), view.x));
    view.y = Math.min(0, Math.max(element.clientHeight * (1 - view.scale), view.y));
    if (content) {
      content.style.transformOrigin = '0 0';
      content.style.transform = view.scale === 1 ? '' : `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    }
  };
  const changed = () => {
    fit();
    callbacks.forEach((cb) => cb());
  };
  return {
    element,
    transform: () => {
      const r = rect();
      const s = (r.width / FRAME_UNITS || 1) * view.scale;
      return { a: s, b: 0, c: 0, d: s, e: r.x * view.scale + view.x, f: r.y * view.scale + view.y };
    },
    clip: () => {
      const r = rect();
      return { x: r.x * view.scale + view.x, y: r.y * view.scale + view.y, width: r.width * view.scale, height: r.height * view.scale };
    },
    onChange: (cb) => {
      callbacks.add(cb);
      let ro = null;
      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(() => {
          fit();
          cb();
        });
        ro.observe(element);
      }
      return () => {
        callbacks.delete(cb);
        ro?.disconnect();
      };
    },
    update: changed,
    /** Zooms by `factor` about the point (x, y) of the element, in its CSS pixels. */
    zoomAt: (x, y, factor) => {
      const before = view.scale;
      const next = Math.min(MAX_ZOOM, Math.max(1, before * factor));
      if (next !== before) {
        view.x = x - (x - view.x) * (next / before);
        view.y = y - (y - view.y) * (next / before);
        view.scale = next;
        changed();
      }
    },
    panBy: (dx, dy) => {
      view.x += dx;
      view.y += dy;
      changed();
    },
    resetView: () => {
      view.scale = 1;
      view.x = 0;
      view.y = 0;
      changed();
    },
    zoomed: () => view.scale > 1.001,
    view: () => ({ ...view }),
    aspect: () => aspect(),
    content: () => content ?? null,
  };
}

// ── Host-side gate (inksplat) ───────────────────────────────────────────────────

/**
 * A Session `accept` callback for the host: while `drawing()` is false,
 * viewers' changes (ops, ink, snapshots with items) are dropped, so a
 * modified viewer cannot bypass the lock; cursors, avatars and turn requests still pass. Whatever the
 * state, one peer sends at most `opsPerSecond` ops a second. Messages on
 * other channels pass.
 *
 * @param {() => boolean} drawing whether viewers may change the board
 * @param {{channel?: string, opsPerSecond?: number, now?: () => number}} [options]
 */
export function drawingGate(drawing, { channel = 'wb', opsPerSecond = 50, now = () => Date.now() } = {}) {
  const buckets = new Map(); // peer -> {tokens, at}
  return (name, message, from) => {
    if (name !== channel) {
      return true;
    }
    const t = message?.t;
    // Cursors, the laser and emotes change nothing on the board: they go through even when drawing is locked.
    if (t === 'cur' || t === 'laser' || t === 'emote') {
      return true;
    }
    // Nothing relays a file longer than the board takes.
    if (t === 'file' && !(typeof message.id === 'string' && typeof message.data === 'string' && message.data.length <= Math.ceil(LIMITS.fileBytes / 3) * 4)) {
      return false;
    }
    // The queue is the host's alone; asking for a turn and an avatar are always welcome.
    if (t === 'queue') {
      return false;
    }
    if (t === 'turn') {
      return message.op === 'join' || message.op === 'leave';
    }
    // Which canvas somebody is on is theirs to say, turn or not.
    if (t === 'pg') {
      return message.of === undefined && Number.isInteger(message.n) && message.n >= 0 && message.n < PAGES;
    }
    if (t === 'avatar') {
      return message.of === undefined && (message.data === '' || cleanImageData(message.data, LIMITS.avatarChars) !== null);
    }
    if (!drawing()) {
      // A join or a first request carries an empty snapshot and is harmless.
      return t === 'sync' && Array.isArray(message.snapshot?.items) && message.snapshot.items.length === 0 && message.snapshot.clear?.[0] === 0;
    }
    if (t !== 'op') {
      return true;
    }
    const at = now();
    const b = buckets.get(from) ?? { tokens: opsPerSecond, at };
    b.tokens = Math.min(opsPerSecond, b.tokens + ((at - b.at) / 1000) * opsPerSecond);
    b.at = at;
    buckets.set(from, b);
    if (b.tokens < 1) {
      return false;
    }
    b.tokens -= 1;
    return true;
  };
}
