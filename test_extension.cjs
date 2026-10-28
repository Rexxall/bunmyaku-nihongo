// Browser extension (extension/): the options page, clipping from a page with furigana, the empty-selection
// alert, the context-menu fallback for pages it may not script, and the clip arriving on the study desk.
// Needs Playwright's own Chromium (branded Chrome no longer loads extensions from the command line):
// npx playwright install chromium. Env: STUDY_URL (default http://127.0.0.1:8766/), PLAYWRIGHT_MODULE.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('assert');
const url = process.env.STUDY_URL || 'http://127.0.0.1:8766/';

// worker.evaluate has no timeout of its own; a hang fails the run instead of stalling CI.
setTimeout(() => { console.error('test_extension.cjs: timed out'); process.exit(1); }, 120000).unref();

(async () => {
  // A copy of the extension with host access to every page. In real use the browser grants access to the
  // current tab when the learner clicks the button or menu item (activeTab); automation cannot click the
  // toolbar, so the test grants it up front and calls the same clip() the click handler calls.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bunmyaku-ext-'));
  const ext = path.join(tmp, 'extension');
  fs.cpSync(path.join(__dirname, 'extension'), ext, {recursive: true});
  const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest));

  const context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
    channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  context.setDefaultTimeout(10000);
  try {
    const errors = [];
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const messages = await worker.evaluate(() => ({selectFirst: chrome.i18n.getMessage('selectFirst'), invalid: chrome.i18n.getMessage('invalid'), saved: chrome.i18n.getMessage('saved')}));
    assert.ok(messages.selectFirst && messages.invalid && messages.saved, 'messages found for the browser language');

    // Options: default address, refuses non-http addresses, stores the address without its fragment.
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    await options.waitForFunction(() => document.getElementById('desk').value);
    assert.equal(await options.inputValue('#desk'), 'http://127.0.0.1:8765/');
    await options.fill('#desk', 'file:///etc/passwd');
    await options.click('button[type=submit]');
    assert.equal(await options.textContent('#status'), messages.invalid);
    await options.fill('#desk', url + '#lesson=01');
    await options.click('button[type=submit]');
    await options.waitForFunction(text => document.getElementById('status').textContent === text, messages.saved);
    assert.deepEqual(await worker.evaluate(() => chrome.storage.sync.get('desk')), {desk: url});
    await options.close();

    // A news page with furigana.
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await context.route('https://news.example/**', r => r.fulfill({contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><title>町のニュース</title><p id="p">駅前の<ruby>本屋<rt>ほんや</rt></ruby>が今月で閉店するらしい。</p>'}));
    await page.goto('https://news.example/article');
    const clipActiveTab = (menuText = '') => worker.evaluate(async text => {
      const [tab] = await chrome.tabs.query({url: 'https://news.example/*'});
      const created = await clip(tab, text);
      return created ? created.pendingUrl || created.url : null;
    }, menuText);

    // Nothing selected: an alert on the page (clip() waits until it is dismissed), no tab.
    let alerted = '';
    page.once('dialog', d => { alerted = d.message(); d.accept(); });
    assert.equal(await clipActiveTab(), null);
    assert.equal(alerted, messages.selectFirst);

    // Selected text arrives on the desk without furigana, with the page's title and address.
    await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('p')); getSelection().removeAllRanges(); getSelection().addRange(r); });
    const [desk, opened] = await Promise.all([context.waitForEvent('page'), clipActiveTab()]);
    assert.ok(opened.startsWith(url + '#clip='), opened);
    desk.on('pageerror', e => errors.push(e.message));
    await desk.waitForSelector('#clip-incoming-title');
    assert.equal(await desk.locator('.clip-incoming blockquote').textContent(), '駅前の本屋が今月で閉店するらしい。');
    assert.equal(await desk.getAttribute('.clip-incoming .clip-source a', 'href'), 'https://news.example/article');
    assert.equal(await desk.locator('.clip-incoming .clip-source a').textContent(), '町のニュース');
    await desk.click('#clip-save');
    assert.equal(await desk.locator('#clip-list .clip-card').count(), 1);
    await desk.close();

    // The browser's own pages cannot be scripted: the context menu's selection text is used instead,
    // and without it the button shows a badge rather than failing.
    const fallback = await worker.evaluate(async () => {
      const tab = await chrome.tabs.create({url: 'chrome://version/'});
      const withText = await clip({...tab, url: 'chrome://version/', title: 'Version'}, '  選んだ文字  ');
      const without = await clip(tab, '');
      const badge = await chrome.action.getBadgeText({tabId: tab.id});
      return {url: withText && (withText.pendingUrl || withText.url), without, badge};
    });
    const sent = JSON.parse(decodeURIComponent(fallback.url.slice(fallback.url.indexOf('#clip=') + 6)));
    assert.deepEqual(sent, {text: '選んだ文字', url: '', title: 'Version'});
    assert.equal(fallback.without, null);
    assert.equal(fallback.badge, '!');

    assert.deepEqual(errors, []);
    console.log('PASS: extension options, clipping without furigana, empty-selection alert, context-menu fallback and badge, clip saved on the desk.');
  } finally {
    await context.close();
    fs.rmSync(tmp, {recursive: true, force: true});
  }
})().catch(e => { console.error(e); process.exit(1); });
