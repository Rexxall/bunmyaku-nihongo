'use strict';
// The only setting: where the study desk runs. Default http://127.0.0.1:8765/ (python3 -m bunmyaku).
const DEFAULT_DESK = 'http://127.0.0.1:8765/';
const msg = key => chrome.i18n.getMessage(key);
document.documentElement.lang = chrome.i18n.getUILanguage();
document.title = msg('optionsTitle');
document.querySelectorAll('[data-msg]').forEach(el => { el.textContent = msg(el.dataset.msg); });
const input = document.getElementById('desk'), status = document.getElementById('status');
chrome.storage.sync.get('desk').then(({desk}) => { input.value = typeof desk === 'string' && desk ? desk : DEFAULT_DESK; });
document.getElementById('form').addEventListener('submit', async e => {
  e.preventDefault();
  let url;
  try { url = new URL(input.value.trim()); } catch { url = null; }
  if (!url || !['http:', 'https:'].includes(url.protocol)) { status.className = 'error'; status.textContent = msg('invalid'); input.focus(); return; }
  url.hash = '';
  await chrome.storage.sync.set({desk: url.href});
  input.value = url.href; status.className = ''; status.textContent = msg('saved');
});
