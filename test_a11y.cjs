// Accessibility checks: axe-core (WCAG 2.2 A/AA and best practices) on every lesson × panel at a wide and a
// phone width, plus the word drawer, the tutor, revealed answers, the header menu and both dialogs; then the
// keyboard paths: skip link, tab arrows, word drawer focus return, grammar locate, tutor focus in and out.
// Env: TEST_LOCALE, STUDY_URL (default http://127.0.0.1:8766/), PLAYWRIGHT_MODULE, PLAYWRIGHT_CHANNEL, AXE_PATH.
const fs = require('fs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.STUDY_URL || 'http://127.0.0.1:8766/';
const launch = {headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? {channel: process.env.PLAYWRIGHT_CHANNEL} : {})};
// Interface language comes from the browser locale (zh-CN unless TEST_LOCALE says otherwise).
const locale = process.env.TEST_LOCALE || 'zh-CN';
const axeSource = fs.readFileSync(process.env.AXE_PATH || require.resolve('axe-core/axe.min.js'), 'utf8');
const panels = ['read', 'words', 'grammar', 'exercises', 'listening', 'notes', 'clips'];
const clipHash = '#clip=' + encodeURIComponent(JSON.stringify({text: '駅前の本屋が今月で閉店するらしい。', title: '町のニュース', url: 'https://example.com/news/1'}));

(async () => {
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage({locale});
    page.setDefaultTimeout(10000);
    const failures = [];
    let scans = 0;
    const open = async (width, hash) => {
      await page.setViewportSize({width, height: 900});
      await page.goto(url + hash);
      await page.reload();
      await page.waitForFunction(() => document.querySelector('[role=tab][aria-selected=true]'));
      await page.waitForTimeout(150);
    };
    const scan = async label => {
      await page.evaluate(axeSource);
      const violations = await page.evaluate(() => axe.run(document, {runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']}).then(r => r.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(', ')}`)));
      for (const v of violations) failures.push(`${label}: ${v}`);
      scans++;
    };
    const focused = () => page.evaluate(() => { const a = document.activeElement; return a ? (a.id ? '#' + a.id : a.tagName.toLowerCase() + (a.dataset.ids ? `[data-ids=${a.dataset.ids}]` : a.dataset.grammar ? `[data-grammar=${a.dataset.grammar}]` : '')) : ''; });
    const expectFocus = async (label, want) => { const got = await focused(); if (!(want instanceof RegExp ? want.test(got) : got === want)) failures.push(`${label}: focus is on ${got || 'nothing'}, expected ${want}`); };

    await page.goto(url);
    const lessons = await page.evaluate(() => JSON.parse(document.getElementById('pack-data').textContent).lessons.map(l => l.id));

    for (const width of [1440, 390]) {
      for (const lesson of lessons) {
        for (const panel of panels) { await open(width, `#lesson=${lesson}&panel=${panel}`); await scan(`${width}px lesson ${lesson} ${panel}`); }
      }
      const first = lessons[0];
      await open(width, `#lesson=${first}&panel=exercises&answers=1`); await scan(`${width}px answers shown`);
      await open(width, `#lesson=${first}&panel=read&tutor=${encodeURIComponent('文脈')}`); await scan(`${width}px tutor open`);
      await open(width, `#lesson=${first}&panel=read`);
      await page.locator('.word').first().click(); await page.waitForTimeout(150); await scan(`${width}px word detail`);
      await open(width, `#lesson=${first}&panel=read`);
      await page.locator('.header-more > summary').click(); await scan(`${width}px header menu`);
      await page.locator('#profiles-edit').click(); await scan(`${width}px profiles dialog`);
      await open(width, `#lesson=${first}&panel=read`);
      await page.locator('#translation-open').click(); await scan(`${width}px translation dialog`);
      await open(width, `#lesson=${first}&panel=clips`);
      await page.locator('.clip-install summary').click(); await scan(`${width}px clips: bookmarklet help`);
      await page.evaluate(h => { location.hash = h; }, clipHash); await page.waitForSelector('#clip-incoming-title');
      if (!(await page.locator('#clip-list .clip-card').count())) { await page.locator('#clip-save').click(); await page.evaluate(h => { location.hash = h; }, clipHash); await page.waitForSelector('#clip-incoming-title'); }
      await scan(`${width}px clips: arriving and saved clip`);
      await page.locator('[data-clip-ask]').first().click(); await page.waitForTimeout(150); await scan(`${width}px clips: tutor on a clip`);
    }

    // Keyboard paths.
    await open(1440, `#lesson=${lessons[0]}&panel=read`);
    await page.keyboard.press('Tab');
    await expectFocus('first Tab', /^a$/);
    if (await page.evaluate(() => document.activeElement.getAttribute('href')) !== '#main') failures.push('first Tab does not reach the skip link');
    await page.keyboard.press('Enter');
    await expectFocus('skip link', '#main');

    await page.locator('#tab-read').focus();
    await page.keyboard.press('ArrowRight');
    await expectFocus('tab arrows', '#tab-words');
    if (await page.locator('#tab-words').getAttribute('aria-selected') !== 'true') failures.push('ArrowRight on the tabs does not select the next panel');

    await open(390, `#lesson=${lessons[0]}&panel=read`);
    const word = page.locator('.word').first();
    const wordIds = await word.getAttribute('data-ids');
    if (!(await word.evaluate(b => b.textContent.trim()))) failures.push('word button has no text name');
    await word.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
    await expectFocus('word drawer opened', '#detail-close');
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    await expectFocus('word drawer closed', `button[data-ids=${wordIds}]`);

    await open(1440, `#lesson=${lessons[0]}&panel=grammar`);
    const locateButton = page.locator('[data-grammar-locate]').first();
    if (await locateButton.count()) {
      const id = await locateButton.getAttribute('data-grammar-locate');
      await locateButton.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
      await expectFocus('grammar locate', `span[data-grammar=${id}]`);
    }

    await open(1440, `#lesson=${lessons[0]}&panel=read`);
    await page.locator('#tutor-open').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
    await expectFocus('tutor opened', '#tutor-question');
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    await expectFocus('tutor closed', '#tutor-open');

    // An arriving clip takes focus; Save moves it to the saved clip, Discard back to the tab.
    await open(1440, `#lesson=${lessons[0]}&panel=read`);
    await page.evaluate(h => { location.hash = h; }, clipHash); await page.waitForSelector('#clip-incoming-title');
    await expectFocus('clip arrived', '#clip-incoming-title');
    await page.locator('#clip-save').focus(); await page.keyboard.press('Enter');
    if (!(await page.evaluate(() => document.activeElement.dataset.clipAsk))) failures.push('clip saved: focus is not on the saved clip');
    await page.evaluate(h => { location.hash = h; }, clipHash); await page.waitForSelector('#clip-incoming-title');
    await page.locator('#clip-discard').focus(); await page.keyboard.press('Enter');
    await expectFocus('clip discarded', '#tab-clips');

    if (failures.length) {
      console.error(`${failures.length} accessibility problem(s) in ${scans} scans:\n` + failures.join('\n'));
      process.exitCode = 1;
      return;
    }
    console.log(`PASS (${locale}): ${scans} axe scans (${lessons.length} lessons × ${panels.length} panels at 1440 and 390 px, plus drawer, tutor, answers, menu, dialogs and web clips) and keyboard paths.`);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
