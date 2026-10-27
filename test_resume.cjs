// Study position and listening progress survive reloads, per profile. Uses the demo pack's placeholder audio.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('assert');
const url = process.env.STUDY_URL || 'http://127.0.0.1:8766/';
const launch = {headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? {channel: process.env.PLAYWRIGHT_CHANNEL} : {})};

(async () => {
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/status', r => r.fulfill({json: {configured: false, token: 'mock'}}));
    await page.goto(url);
    await page.selectOption('#course', '02');
    await page.locator('#tab-listening').click();
    await page.waitForFunction(() => document.querySelector('#listen-audio')?.readyState >= 1);
    const audio = () => page.evaluate(() => { const a = document.querySelector('#listen-audio'); return {t: a.currentTime, paused: a.paused, rate: a.playbackRate, d: a.duration}; });
    assert.ok((await audio()).d > 5, 'placeholder audio loaded');
    await page.evaluate(() => { document.querySelector('#listen-audio').currentTime = 6; });
    await page.locator('#listen-replay').click();
    let s = await audio();
    assert.ok(!s.paused && s.t >= 0.9 && s.t < 2.5, 'replay rewinds five seconds ' + JSON.stringify(s));
    await page.evaluate(() => { const a = document.querySelector('#listen-audio'); a.currentTime = 6.1; a.dispatchEvent(new Event('timeupdate')); });
    assert.ok((await audio()).paused, 'replay stops at the replay end');
    await page.locator('#listen-play').click();
    await page.locator('#listen-play').click();
    await page.evaluate(() => { document.activeElement.blur(); document.body.tabIndex = -1; document.body.focus(); });
    await page.keyboard.press('Space');
    await page.waitForFunction(() => !document.querySelector('#listen-audio').paused);
    await page.keyboard.press('Space');
    assert.ok((await audio()).paused, 'space toggles playback');
    await page.evaluate(() => { document.querySelector('#listen-audio').currentTime = 2; });
    await page.keyboard.press('ArrowRight');
    s = await audio();
    assert.ok(Math.abs(s.t - 7) < 0.3, 'arrow right seeks forward ' + s.t);
    await page.keyboard.press('ArrowLeft');
    assert.ok(Math.abs((await audio()).t - 2) < 0.3, 'arrow left seeks back');
    await page.selectOption('#listen-speed', '0.75');
    assert.equal((await audio()).rate, 0.75);
    await page.evaluate(() => { const a = document.querySelector('#listen-audio'); a.currentTime = 3; a.dispatchEvent(new Event('timeupdate')); saveStudyPosition(); });
    await page.locator('#listen-loop-a').click();
    await page.evaluate(() => { document.querySelector('#listen-audio').currentTime = 5; });
    await page.locator('#listen-loop-b').click();
    await page.locator('#listen-loop-save').click();
    await page.evaluate(() => document.querySelector('#listen-audio').pause());
    assert.equal(await page.locator('[data-clip]').count(), 1);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#listen-audio')?.readyState >= 1);
    assert.equal(await page.inputValue('#course'), '02');
    assert.equal(await page.evaluate(() => document.body.dataset.panel), 'listening');
    assert.equal(await page.inputValue('#listen-speed'), '0.75');
    s = await audio();
    assert.ok(s.paused && s.t >= 2.5 && s.t < 6, 'resumes paused near the saved position ' + JSON.stringify(s));
    assert.equal(await page.locator('[data-clip]').count(), 1, 'saved loop restored');
    await page.locator('[data-clip]').click();
    await page.evaluate(() => { const a = document.querySelector('#listen-audio'); a.currentTime = 5.1; a.dispatchEvent(new Event('timeupdate')); });
    assert.ok((await audio()).t < 3.5, 'loop jumps back to A');
    // A second profile has its own position and clips.
    await page.evaluate(() => { profiles = ['我', '友人']; store.set('bunmyaku:profiles', profiles); renderLearnerSelect(); });
    await page.selectOption('#learner', '友人');
    await page.locator('#tab-read').click();
    await page.evaluate(() => saveStudyPosition());
    await page.selectOption('#learner', '我');
    await page.waitForFunction(() => document.querySelector('#listen-audio')?.readyState >= 1);
    assert.equal(await page.evaluate(() => document.body.dataset.panel), 'listening', 'first profile returns to listening');
    assert.equal(await page.locator('[data-clip]').count(), 1);
    await page.selectOption('#learner', '友人');
    assert.equal(await page.evaluate(() => document.body.dataset.panel), 'read');
    await page.selectOption('#learner', '我');
    await page.waitForFunction(() => document.querySelector('#listen-audio')?.readyState >= 1);
    await page.locator('[data-remove-clip]').click();
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#listen-audio')?.readyState >= 1);
    assert.equal(await page.locator('[data-clip]').count(), 0);
    for (const width of [820, 390]) {
      await page.setViewportSize({width, height: 1000});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    assert.deepEqual(errors, []);
    console.log('PASS: lesson/panel restoration, per-profile positions, paused audio resume, speed, saved loops, keyboard transport.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
