// Layout and rendering checks against the demo pack. Isolated browser; /api/chat is mocked.
// Env: STUDY_URL (default http://127.0.0.1:8766/), PLAYWRIGHT_MODULE, PLAYWRIGHT_CHANNEL (e.g. chrome).
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('assert');
const url = process.env.STUDY_URL || 'http://127.0.0.1:8766/';
const launch = {headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? {channel: process.env.PLAYWRIGHT_CHANNEL} : {})};

(async () => {
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/status', r => r.fulfill({json: {configured: true, token: 'mock', model: 'mock', preset: 'test', pack: {id: 'demo-pack'}}}));
    await page.route('**/api/chat', r => r.fulfill({json: {answer: '### 渲染测试\n**粗体**\n\n- 列表\n\n| a | b |\n|---|---|\n| 1 | 2 |', model: 'mock'}}));
    await page.goto(url);
    let checks = 0;
    assert.equal(await page.title(), 'おかげさまで · Bunmyaku');
    assert.ok(await page.locator('#passage ruby').count() > 50, 'bracket ruby rendered');
    assert.equal(await page.locator('#passage .word').count(), 10, 'all ten vocabulary forms highlighted');
    assert.equal(await page.locator('#passage .grammar').count(), 3, 'three grammar phrases underlined');
    assert.ok(await page.locator('#learner-control').isHidden(), 'single profile hides the learner select');
    for (const width of [1440, 1180, 1024, 820, 768, 650, 390, 360]) {
      await page.setViewportSize({width, height: 1000});
      for (const tab of ['read', 'words', 'grammar', 'exercises', 'listening', 'notes']) {
        await page.locator('#tab-' + tab).click();
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error('overflow ' + width + ' ' + tab);
        checks++;
      }
      await page.locator('#tab-read').click();
      await page.locator('#tutor-open').click();
      await page.locator('#tutor-question').fill('テスト');
      await page.locator('#tutor-send').click();
      await page.waitForFunction(() => !tutorBusy);
      assert.equal(await page.locator('#tutor-messages .md-table').count(), 1, 'markdown table rendered in a wrapper');
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error('chat overflow ' + width);
      await page.locator('#tutor-clear').click();
      await page.locator('#tutor-close').click();
    }
    // Listening: transcript visible, translation and answers hidden by default.
    await page.setViewportSize({width: 1440, height: 1000});
    await page.selectOption('#course', '02');
    await page.locator('#tab-listening').click();
    assert.ok(await page.locator('#listen-audio').count() === 1, 'lesson 2 has a player');
    assert.ok(await page.locator('.listen-transcript-row').first().isVisible());
    assert.ok(await page.locator('.listen-study-translation').first().isHidden(), 'translation hidden by default');
    assert.equal(await page.locator('#listen-questions .answer-panel:visible').count(), 0, 'answers hidden by default');
    await page.locator('#listen-translation-toggle').click();
    assert.ok(await page.locator('.listen-study-translation').first().isVisible());
    await page.selectOption('#course', '01');
    await page.locator('#tab-listening').click();
    assert.ok(await page.locator('.listen-no-audio').isVisible(), 'lesson 1 shows the no-audio notice');
    checks++;
    // Reading companion becomes a drawer on narrow screens and is restored afterwards.
    for (const width of [390, 820, 1100]) {
      await page.setViewportSize({width, height: 900});
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.evaluate(() => { switchCourse('01'); selectEntry('v1'); openDetail(); });
      const covered = await page.evaluate(() => { const c = document.querySelector('#detail-close'), r = c.getBoundingClientRect(); return c.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
      if (!covered) throw Error('drawer covered ' + width);
      await page.locator('#detail-close').click();
      if (!await page.evaluate(() => document.querySelector('.reading-grid').contains(document.querySelector('#detail-shell')))) throw Error('drawer not restored');
      await page.evaluate(() => openDetail());
      await page.keyboard.press('Escape');
      checks++;
    }
    console.log({checks, errors});
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
