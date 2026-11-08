// MIT License © 2026 Binary Dice Games
/**
 * @file The control window (spec/08_remote_support/DESIGN.md section 3.2): what is happening,
 * in large plain words, with one button for each thing the person can do. While sharing it is
 * the small bar with Stop. It only shows what the main process sends and passes on presses; it
 * decides nothing.
 */
import type { ControlBridge } from '../shared/bridge';
import type { ControlAction, ControlState } from '../shared/protocol';
import { NAME_MAX } from '../shared/protocol';
import { fill, reasonKey, t } from '../shared/strings';
import type { StringKey } from '../shared/strings';

const support = (window as unknown as { support: ControlBridge }).support;
const root = document.getElementById('root')!;
let last: ControlState | null = null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function button(label: string, action: ControlAction, primary = false): HTMLButtonElement {
  const b = el('button', label, primary ? 'primary' : undefined);
  b.type = 'button';
  b.dataset.action = action.t;
  b.addEventListener('click', () => support.act(action));
  return b;
}

/** The person's name, which the helper sees, with a field to change it. */
function nameRow(s: ControlState): HTMLElement {
  const form = el('form', undefined, 'name-row');
  const label = el('label', t(s.lang, 'yourName'));
  const input = el('input');
  input.id = 'name';
  input.maxLength = NAME_MAX;
  input.value = s.name;
  label.htmlFor = 'name';
  const save = el('button', t(s.lang, 'saveName'));
  save.type = 'submit';
  form.append(label, input, save);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    support.act({ t: 'setName', name: input.value });
  });
  return form;
}

function render(s: ControlState): void {
  last = s;
  const L = (k: StringKey): string => fill(t(s.lang, k), { name: s.helper?.name || '?' });
  document.documentElement.lang = s.lang;
  document.body.classList.toggle('bar', s.screen === 'sharing' || s.screen === 'reconnecting');
  const parts: HTMLElement[] = [];
  const code = (): HTMLElement => {
    const box = el('div', undefined, 'code-box');
    box.append(el('p', L('codeLabel')), el('p', s.code ?? '', 'code'));
    return box;
  };
  switch (s.screen) {
    case 'idle':
      parts.push(el('h1', t(s.lang, 'title')), el('p', L('idle')));
      parts.push(button(L('close'), { t: 'close' }));
      break;
    case 'connecting':
      parts.push(el('h1', L('connecting')), nameRow(s));
      parts.push(button(L('close'), { t: 'close' }));
      break;
    case 'explain':
    case 'asking':
      parts.push(el('h1', L('explainTitle')), el('p', L('explainBody')));
      if (s.code) parts.push(code());
      parts.push(el('p', L('scamWarning'), 'warning'));
      if (s.screen === 'asking') parts.push(el('p', L('asking'), 'muted'));
      parts.push(nameRow(s));
      break;
    case 'sharing':
    case 'reconnecting': {
      const status = el(
        'p',
        s.screen === 'sharing' ? L('sharingBar') : L('reconnecting'),
        'status',
      );
      status.setAttribute('role', 'status');
      const dot = el('span', undefined, 'dot');
      if (s.helper) dot.style.background = s.helper.color;
      status.prepend(dot);
      const row = el('div', undefined, 'bar-row');
      row.append(button(L('stop'), { t: 'stop' }, true));
      if (s.otherDisplay && s.screen === 'sharing') {
        row.append(button(L('otherDisplay'), { t: 'nextDisplay' }));
      }
      parts.push(status, row);
      break;
    }
    case 'stopped':
    case 'ended':
      parts.push(
        el('h1', s.screen === 'stopped' ? L('stoppedTitle') : L('endedTitle')),
        el('p', t(s.lang, reasonKey(s.reason))),
      );
      parts.push(
        button(L('shareAgain'), { t: 'shareAgain' }, true),
        button(L('close'), { t: 'close' }),
      );
      break;
    case 'denied':
      parts.push(
        el('h1', L('deniedTitle')),
        el('p', L('deniedBody')),
        button(L('close'), { t: 'close' }, true),
      );
      break;
    case 'bad-link':
      parts.push(
        el('h1', L('badLinkTitle')),
        el('p', L('badLinkBody')),
        button(L('close'), { t: 'close' }, true),
      );
      break;
    case 'blocked':
      parts.push(
        el('h1', L('blockedTitle')),
        el('p', L('blockedBody')),
        button(L('close'), { t: 'close' }, true),
      );
      break;
    case 'update':
      parts.push(
        el('h1', L('updateTitle')),
        el('p', L('updateBody')),
        button(L('download'), { t: 'download' }, true),
        button(L('close'), { t: 'close' }),
      );
      break;
    case 'mac-permission':
      parts.push(
        el('h1', L('macTitle')),
        el('p', L('macBody')),
        button(L('openSettings'), { t: 'openScreenSettings' }, true),
        button(L('turnedOn'), { t: 'relaunch' }),
      );
      break;
  }
  if (s.notice) {
    const n = el('p', t(s.lang, s.notice as StringKey) ?? '', 'notice');
    n.setAttribute('role', 'alert');
    parts.push(n);
  }
  if (!document.body.classList.contains('bar')) {
    parts.push(el('p', `inksplat Support ${s.version}`, 'version'));
  }
  // Keep a name being typed: only redraw the form when its screen changes.
  const typing = document.activeElement?.id === 'name';
  if (typing && root.dataset.screen === s.screen) {
    return;
  }
  root.dataset.screen = s.screen;
  root.replaceChildren(...parts);
}

support.onState(render);
// The window may be shown before the first state arrives.
if (!last) {
  root.textContent = '';
}
