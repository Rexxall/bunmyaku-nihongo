'use strict';
/* Bunmyaku clipper. Sends the selected text, the page title and its address to the study desk's web clips
   panel the same way the bookmarklet does: it opens the desk with #clip=<JSON>, and the desk shows the clip
   and keeps it only when the learner presses Save. The extension reads a page only when the learner clicks
   its button or menu item (activeTab), and stores nothing but the desk address. */

const DEFAULT_DESK = 'http://127.0.0.1:8765/';

// Runs in the page: the selection without furigana (<rt>), and the page title.
function pageSelection() {
  const g = getSelection();
  let s = String(g);
  if (g.rangeCount) {
    const f = document.createElement('div');
    f.append(g.getRangeAt(0).cloneContents());
    if (f.querySelector('rt')) { f.querySelectorAll('rt,rp').forEach(x => x.remove()); s = f.textContent; }
  }
  return {text: s.trim(), title: document.title};
}
function pageAlert(message) { alert(message); }

async function deskAddress() {
  const {desk} = await chrome.storage.sync.get('desk');
  return typeof desk === 'string' && desk ? desk : DEFAULT_DESK;
}
function clipURL(desk, clip) {
  const data = {text: clip.text.slice(0, 4000), url: clip.url, title: clip.title.slice(0, 200)};
  return desk.split('#')[0] + '#clip=' + encodeURIComponent(JSON.stringify(data));
}
// Pages the extension may not script (the PDF viewer, the browser's own pages) fall back to the
// context menu's plain selection text; with nothing selected the button badge shows "!".
async function clip(tab, menuText = '') {
  let picked = null;
  try { [{result: picked}] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: pageSelection}); } catch {}
  const text = (picked && picked.text) || menuText.trim();
  if (!text) {
    try { await chrome.scripting.executeScript({target: {tabId: tab.id}, func: pageAlert, args: [chrome.i18n.getMessage('selectFirst')]}); }
    catch {
      await chrome.action.setBadgeText({tabId: tab.id, text: '!'});
      setTimeout(() => chrome.action.setBadgeText({tabId: tab.id, text: ''}).catch(() => {}), 3000);
    }
    return null;
  }
  const url = clipURL(await deskAddress(), {text, url: /^https?:/.test(tab.url || '') ? tab.url : '', title: (picked && picked.title) || tab.title || ''});
  return chrome.tabs.create({url, index: tab.index + 1, ...(tab.id >= 0 ? {openerTabId: tab.id} : {})});
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({id: 'clip', title: chrome.i18n.getMessage('menu'), contexts: ['selection']});
});
chrome.contextMenus.onClicked.addListener((info, tab) => { if (info.menuItemId === 'clip' && tab) clip(tab, info.selectionText || ''); });
chrome.action.onClicked.addListener(tab => clip(tab));
