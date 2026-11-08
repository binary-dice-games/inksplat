// MIT License © 2026 Binary Dice Games
/**
 * @file The support landing page (spec/08_remote_support section 3.2): opens the inksplat
 * Support app with the link's invite, or offers its installer. The page never joins the
 * session and never asks to share the screen; the token stays in the fragment.
 */
import {
  allDownloads,
  appUrlFromHash,
  detectSystem,
  downloadUrl,
  systemName,
} from './support-page';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function main(): void {
  const appUrl = appUrlFromHash(location.hash);
  $('bad').hidden = appUrl !== null;
  $('good').hidden = appUrl === null;
  if (!appUrl) {
    return;
  }
  $<HTMLAnchorElement>('open').href = appUrl;
  const system = detectSystem(navigator.userAgent, navigator.platform);
  const url = downloadUrl(system);
  const get = $<HTMLAnchorElement>('download');
  get.hidden = url === null;
  if (url) {
    get.href = url;
    get.textContent = `Download for ${systemName(system)}`;
  }
  $('mobile').hidden = system !== 'other';
  $('macNote').hidden = system !== 'mac';
  $('others').replaceChildren(
    ...allDownloads().map(([label, href]) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;
      li.append(a);
      return li;
    }),
  );
}

main();
// A new link pasted into the same tab changes only the hash.
window.addEventListener('hashchange', main);
