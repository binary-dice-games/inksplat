// MIT License © 2026 Binary Dice Games (adapted for inksplat)

export type Stamp = [number, string];

interface ItemBase {
  id: string;
  author: string;
  stamp: Stamp;
  /**
   * Absent: anybody may change, move or delete it. `owner`: only its author. `all`: nobody, though
   * its author may unlock it. Only the author changes the lock.
   */
  lock?: Lock;
  /** The canvas it is on, 1 to {@link PAGES} - 1; absent for the first. */
  page?: number;
}

export type Lock = 'owner' | 'all';
export const LOCKS: readonly Lock[];
/** How many canvases a board has. */
export const PAGES: number;

/**
 * Whether `next` (a newer version of `old`, made by the peer in its stamp) may replace it, given the
 * lock of `old`.
 */
export function mayChange(old: StoredItem | undefined, next: StoredItem): boolean;

export interface InkItem extends ItemBase {
  kind: 'ink';
  /** Flat x0, y0, x1, y1, ... in board units. */
  points: number[];
  color: string;
  width: number;
}

export interface TextItem extends ItemBase {
  kind: 'text';
  x: number;
  y: number;
  size: number;
  text: string;
  color: string;
}

export interface StickerItem extends ItemBase {
  kind: 'sticker';
  x: number;
  y: number;
  size: number;
  name: string;
  /** Degrees, -180 to 180; absent: 0. */
  rot?: number;
}

/** A picture (a small PNG, JPEG or WebP data URL) dropped on the board; `size` is its width. */
export interface ImageItem extends ItemBase {
  kind: 'image';
  x: number;
  y: number;
  size: number;
  /** Height / width. */
  ratio: number;
  /** The preview shown on the board. */
  data: string;
  /** The file pinned with the preview, when it was small enough to send. A GIF is drawn animated from it. */
  file?: FileInfo;
  /** The picture has transparent parts: its border and shadow follow what shows. */
  cutout?: true;
  rot?: number;
}

/** A web link pinned on the board as a card; clicking it opens `url` in a new tab. */
export interface LinkItem extends ItemBase {
  kind: 'link';
  x: number;
  y: number;
  /** Width of the card. */
  size: number;
  /** An http or https address. */
  url: string;
  rot?: number;
}

/** A sticky note pinned on the board: `size` is its width, `ratio` height / width, `color` its paper. */
export interface NoteItem extends ItemBase {
  kind: 'note';
  x: number;
  y: number;
  size: number;
  ratio: number;
  text: string;
  color: string;
  /** Absent: square. */
  shape?: NoteShape;
  /** Font size in board units; absent: 16. The sizes offered are 12, 16 and 24. */
  fs?: number;
  rot?: number;
}

/** The outlines of a sticky note. */
export type NoteShape = 'square' | 'rounded' | 'oval' | 'diamond' | 'hexagon';
export const NOTE_SHAPES: readonly NoteShape[];
export type PinShape = 'round' | 'square' | 'diamond' | 'triangle' | 'star';
export const PIN_SHAPES: readonly PinShape[];

/** A bare pin, to tie threads to. */
export interface PinItem extends ItemBase {
  kind: 'pin';
  /** The shape of its head; absent for round. */
  shape?: PinShape;
  /** Where it is (when it is attached to an item: where it was put on it). */
  x: number;
  y: number;
  color: string;
  /**
   * The item it is attached to (a note, picture, link or sticker), and where on it: `u` and `v` are
   * fractions of its width and height from its centre, turned and scaled with it.
   */
  on?: string;
  u?: number;
  v?: number;
}

/** Which ends of a thread have a head: none, `start` (its source), `end` (its destination) or both. */
export type ArrowHeads = 'none' | 'start' | 'end' | 'both';
export const ARROW_HEADS: readonly ArrowHeads[];
/** The modes of the pointer tool: the plain cursor, a laser that leaves a short trail, emotes, a magnifier. */
export type PointerMode = 'cursor' | 'laser' | 'emote' | 'magnify';
export const POINTER_MODES: readonly PointerMode[];
/** The stickers of the emote wheel, clockwise from the top. */
export const EMOTES: readonly string[];
/** How many times a live emote can grow (each click on it makes it bigger). */
export const EMOTE_LEVELS: number;

/** A thread hung from the pin of the item `from` to that of `to`. */
export interface ArrowItem extends ItemBase {
  kind: 'arrow';
  from: string;
  to: string;
  color: string;
  heads: ArrowHeads;
}

/** Where a thread ties to an item (its pin), in board units; null when it has no pin. */
export function pinPoint(
  item: Item | undefined | null,
  get?: (id: string) => Item | null | undefined,
): { x: number; y: number } | null;

/** The curve of a thread between two points (it hangs below the straight line); `d` is its SVG path. */
export function threadCurve(
  a: { x: number; y: number },
  b: { x: number; y: number },
  seed?: number,
): { c: { x: number; y: number }; d: string };

/** A file shared on the board. */
export interface FileInfo {
  name: string;
  mime: string;
  bytes: number;
}

export interface Tombstone extends ItemBase {
  deleted: true;
}

export type Item =
  InkItem | TextItem | StickerItem | ImageItem | LinkItem | NoteItem | PinItem | ArrowItem;
export type StoredItem = Item | Tombstone;

export type Operation = { t: 'put'; item: StoredItem } | { t: 'clear'; stamp: Stamp };

export interface Snapshot {
  v: 1;
  clock: number;
  clear: Stamp;
  items: StoredItem[];
}

export const LIMITS: Readonly<{
  items: number;
  points: number;
  text: number;
  snapshotBytes: number;
  images: number;
  imageChars: number;
  avatarChars: number;
  /** The largest file that is sent, and the most the files of a board add up to. */
  fileBytes: number;
  filesTotal: number;
}>;

/** A refused change (a limit, read-only), with a message for the user. */
export class WhiteboardError extends Error {}

/** The item if it is well formed, else null. */
export function cleanItem(item: unknown): StoredItem | null;

/** The file description if valid (the name is made safe as a file name), else null. */
export function cleanFileInfo(info: unknown): FileInfo | null;

/** The address if it is a short http or https link, else null. */
export function cleanUrl(value: unknown): string | null;

/** What {@link prepareFile} makes of a file. */
export interface PreparedFile {
  /** The preview, a data URL. */
  data: string;
  width: number;
  height: number;
  /** The preview is a card (a file that is not a picture). */
  card?: boolean;
  name: string;
  /** The picture has transparent parts (drawn as a cutout). */
  cutout?: boolean;
  /** Absent when only the picture could be shared. */
  file?: FileInfo;
  blob: Blob | null;
}

/**
 * Makes the preview of a dropped file (a picture's own, a text file's first lines, or a card with
 * its type, name and size). Throws a WhiteboardError if the file is empty or, not being a picture,
 * too large to send.
 */
export function prepareFile(
  file: File,
  options?: { maxBytes?: number; room?: number; preview?: FilePreview },
): Promise<PreparedFile>;

/**
 * What a host can show of a document: its first page or thumbnail (`image`, closed after use if it
 * has `close()`), or its first `lines` of text. Null: nothing, the card is shown without content.
 */
export type FilePreview = (file: File) => Promise<{
  image?: CanvasImageSource & { width: number; height: number };
  lines?: string[];
} | null>;

/** The data URL if it is a PNG, JPEG or WebP image of at most `maxChars` characters, else null. */
export function cleanImageData(value: unknown, maxChars?: number): string | null;

/**
 * Reads an image file into a data URL small enough to send, scaling it down until it fits
 * (`square` crops the middle, for an avatar; an animated GIF gives its first frame). `cutout` is
 * set when the picture has transparent parts, which are kept (PNG). Throws a WhiteboardError if
 * it is not an image the browser can read or stays too big.
 */
export function fileToImageData(
  file: File,
  options?: { maxSide?: number; square?: boolean; maxChars?: number },
): Promise<{ data: string; width: number; height: number; cutout?: boolean }>;

/** Whether RGBA pixels have see-through parts (at least 0.1% of them clearly transparent). */
export function hasTransparency(rgba: ArrayLike<number>): boolean;

/** Whether the bytes start like a GIF file. */
export function isGif(bytes: ArrayLike<number>): boolean;

/** Simplifies a flat polyline (Ramer-Douglas-Peucker) and rounds it to 0.1. */
export function simplifyPoints(points: number[], tolerance?: number): number[];

export class WhiteboardModel {
  constructor(peerId: string);
  readonly peerId: string;
  clock: number;
  items: Map<string, StoredItem>;
  live(): Item[];
  get(id: string): Item | null;
  /** Ids changed, ['*'] for a clear that removed items, [] if nothing, null if malformed. */
  apply(op: unknown): string[] | null;
  add(fields: Record<string, unknown>): Operation;
  change(id: string, fields: Record<string, unknown>): Operation | null;
  remove(id: string): Operation | null;
  clear(): Operation;
  undo(): Operation | null;
  redo(): Operation | null;
  snapshot(): Snapshot;
  /** The operations that changed this model, or null if the snapshot is malformed. */
  merge(snapshot: unknown): Operation[] | null;
}

export function createModel(peerId: string): WhiteboardModel;

/** Built-in sticker symbols (24-unit SVG fragments), by name. */
export const STICKERS: Readonly<Record<string, string>>;

export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  hidden?: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Maps board units to the container's CSS pixels. */
/** What is drawn behind the items of a saved picture. */
export interface ExportOptions {
  /** CSS (property to value) of a box behind the items, as the sheet of a board without video. */
  background?: Record<string, string>;
  /** A data URL of a picture to fill the area with, as the frame of the video. */
  backdrop?: string;
}

/** A board saved in a file. */
export interface BoardFile {
  format: 'inksplat-board';
  version: 1;
  saved: string;
  meta: Record<string, unknown>;
  items: Item[];
  /** The files pinned on images, as bytes. */
  files: { id: string; data: Uint8Array }[];
}

export interface Adapter {
  element?: HTMLElement;
  transform(): Matrix | null;
  clip?(): Rect | null;
  onChange(cb: () => void): () => void;
  /** Zooms by `factor` about the point (x, y) of the container, in CSS pixels. */
  zoomAt?(x: number, y: number, factor: number): void;
  /** Moves the zoomed content by (dx, dy) CSS pixels. */
  panBy?(dx: number, dy: number): void;
  resetView?(): void;
  zoomed?(): boolean;
  /** Width / height of the frame, when the content is a frame (the whole frame is then saved). */
  aspect?(): number;
  /** The element under the board (the video, the background), copied into the magnifier's lens. */
  content?(): HTMLElement | null;
}

export interface FrameAdapter extends Adapter {
  /** Call when the aspect changes. */
  update(): void;
  zoomAt(x: number, y: number, factor: number): void;
  panBy(dx: number, dy: number): void;
  resetView(): void;
  zoomed(): boolean;
  view(): { scale: number; x: number; y: number };
}

/** The session surface a whiteboard needs: a Session or a SessionProxy. */
export interface WhiteboardSession {
  readonly role: 'host' | 'guest';
  readonly me: { id: string; color: string };
  peers(): { id: string; name: string; color: string }[];
  host?(): { id: string } | null;
  channel(name: string): {
    send(message: unknown, options?: { to?: string | null; fast?: boolean }): void;
    on(event: 'message', cb: (message: unknown, from: string) => void): () => void;
    on(event: 'join', cb: (peer: { id: string }) => void): () => void;
  };
  on(event: 'peers', cb: (peers: unknown[]) => void): () => void;
}

export type Tool = 'pointer' | 'pen' | 'text' | 'sticker' | 'eraser' | 'note' | 'pin' | 'arrow';

export interface WhiteboardOptions {
  session: WhiteboardSession;
  adapter?: Adapter;
  /** Default `wb`. */
  channel?: string;
  /** Show the toolbar; default true. */
  toolbar?: boolean;
  tools?: Tool[];
  stickers?: { name: string; svg: string }[];
  strings?: Record<string, string>;
  color?: string;
  readOnly?: boolean;
  /** Show the buttons that choose the canvas; default true. */
  pages?: boolean;
  /** This person's avatar (an image data URL), shown on their cursor instead of their name. */
  avatar?: string;
  /** Show the speaking queue; default true. */
  turns?: boolean;
  /** Replaces {@link prepareFile} (tests, or a host with better previews). */
  prepareFile?: typeof prepareFile;
  /** Previews of PDF and Office files (they are not part of this package). */
  filePreview?: FilePreview;
  /** Random numbers in [0, 1) for the tilt of what is pinned (tests). */
  random?: () => number;
  /** Opens a link card's page (default: a new tab, `noopener`). */
  openUrl?: (url: string) => void;
  /** Puts a note's text on the clipboard, true when it worked (default: the browser's clipboard). */
  copyText?: (text: string) => Promise<boolean>;
}

export class Whiteboard {
  constructor(container: HTMLElement, options: WhiteboardOptions);
  readonly element: HTMLElement;
  readOnly: boolean;
  setTool(name: Tool): void;
  setStyle(style: {
    color?: string;
    width?: number;
    size?: number;
    sticker?: string;
    shape?: NoteShape;
    pinShape?: PinShape;
    /** The mode of the pointer tool (key 1 again goes through them). */
    pointerMode?: PointerMode;
    heads?: ArrowHeads;
  }): void;
  setAdapter(adapter: Adapter): void;
  /**
   * The shortcut of the nth tool (1 is the first; the colour is last): selects it, and pressing
   * the tool in use again goes through its options.
   */
  chooseSlot(n: number): void;
  setAvatar(data: string | null): void;
  /**
   * Pins a file on the board at `at` (board units) and sends it to everyone. Resolves to the id of
   * the item, or null if refused; throws a WhiteboardError for an empty or too large file.
   */
  addFile(file: File, at?: { x: number; y: number }): Promise<string | null>;
  /**
   * Pins a sticky note (paper: a pale version of the current colour) and returns its id; null when
   * read only. Only its author edits, moves, resizes or deletes it; others double click to copy it.
   * With `size` (board units, kept within a note's limits) it has that width and height and is not
   * turned; `at` is its centre.
   */
  addNote(
    at?: { x: number; y: number },
    text?: string,
    size?: { width: number; height: number },
  ): string | null;
  /** Pins a bare pin in the current colour; null when read only. */
  addPin(at?: { x: number; y: number }): string | null;
  /**
   * Shows an emote (one of {@link EMOTES}) at `at` (board units) to everyone on this canvas; it
   * floats up and fades in about two seconds, and a click on it makes it bigger. Nothing is stored.
   * Returns its id, or null for an unknown name.
   */
  addEmote(name: string, at: { x: number; y: number }): string | null;
  /** Ties a thread between the pins of two items; null when read only or an item has no pin. */
  addArrow(from: string, to: string): string | null;
  /**
   * Pins a web link (a card that opens the page when clicked); null when read only.
   * @throws {WhiteboardError} when `url` is not an http or https address
   */
  addLink(url: string, at?: { x: number; y: number }): string | null;
  /** The file of an image item (its picture if no file was shared); null while it arrives. */
  fileOf(id: string): { blob: Blob; name: string; mime: string } | null;
  /** Saves the file of an image item in the browser's downloads. */
  downloadFile(id: string): void;
  /** Puts this person at the end of the speaking queue. */
  requestTurn(): void;
  /** Takes this person out of the queue; the next one has the turn. */
  endTurn(): void;
  /** Peer ids waiting to speak; the first has the turn. */
  turnQueue(): string[];
  /** Host only: takes someone out of the queue. */
  removeFromQueue(id: string): void;
  resetZoom(): void;
  undo(): void;
  redo(): void;
  /** Clears the whiteboard for everyone. */
  clear(): void;
  /** Removes only the drawings (lines, texts, stickers) for everyone; elements stay. Returns how many. */
  clearDrawings(): number;
  /**
   * Selects the items with these ids on the canvas shown (others are left out). Several make a
   * selection that is moved by dragging any of them, coloured from the bar over it, removed with
   * Delete and copied, cut and pasted with the clipboard. Returns the ids now selected.
   */
  selectItems(ids: Iterable<string>): string[];
  /** The ids of the items selected here (none, one, or several). */
  selection(): string[];
  /** The canvas shown here (0 to {@link PAGES} - 1). */
  currentPage(): number;
  /** Shows another canvas, only for this person; the others are told where they are. */
  setPage(n: number): void;
  /** People (this one included) on each canvas. */
  pageCounts(): number[];
  snapshot(): Snapshot;
  /** Merges a snapshot (it does not replace what is here) and tells the others. */
  load(snapshot: unknown): void;
  items(): Item[];
  /** The area saved by default: the frame, else the bounds of the items. */
  exportArea(): Rect;
  /** What can go behind the items when a board is saved as a picture. */
  toSvg(box?: Rect, options?: ExportOptions): string;
  /**
   * The board as a PNG, `width` pixels wide.
   * @throws {WhiteboardError} when the browser cannot make the picture
   */
  toPng(options?: ExportOptions & { box?: Rect; width?: number }): Promise<Blob>;
  /**
   * The board as an object to save in a file: the items and the files pinned on them, as
   * bytes (the page keeps them apart from the JSON, in a zip). `meta` comes back from
   * {@link loadBoard}.
   */
  saveBoard(meta?: Record<string, unknown>): Promise<BoardFile>;
  /**
   * Adds a saved board to this one: all of it becomes the loader's (new ids), files are shared again.
   * Its files are bytes.
   * @throws {WhiteboardError} when `data` is not a board file, or the board is read only
   */
  loadBoard(data: unknown): Promise<{
    added: number;
    skipped: number;
    files: number;
    meta: Record<string, unknown>;
  }>;
  contentBounds(): Rect | null;
  on(event: 'change', cb: (e: { source: 'local' | 'remote' | 'load' }) => void): () => void;
  on(event: 'tool', cb: (name: Tool) => void): () => void;
  on(event: 'error', cb: (e: WhiteboardError) => void): () => void;
  on(event: 'page', cb: (e: { page: number }) => void): () => void;
  on(event: 'queue', cb: (e: { ids: string[] }) => void): () => void;
  destroy(): void;
}

export function createWhiteboard(container: HTMLElement, options: WhiteboardOptions): Whiteboard;

/** The width of the frame in board units; its height is `FRAME_UNITS / aspect`. */
export const FRAME_UNITS: number;

/** The largest rectangle of `aspect` (width / height) centred in a width x height box. */
export function letterbox(width: number, height: number, aspect: number): Rect;

/** Maps board units onto the letterboxed frame inside `element`. */
export function frameAdapter(
  element: HTMLElement,
  aspect: () => number,
  /** The picture in the element (the video): zoomed with the frame. */
  content?: HTMLElement,
): FrameAdapter;

/**
 * A Session `accept` callback for the host: while `drawing()` is false,
 * viewers' changes are dropped; ops are rate limited per peer.
 */
export function drawingGate(
  drawing: () => boolean,
  options?: { channel?: string; opsPerSecond?: number; now?: () => number },
): (channel: string, message: unknown, from: string) => boolean;
