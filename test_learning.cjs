// Learner records: notes per profile, exercise reveal, copy-prompt mode, export. Mocked API.
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
    let configured = false, calls = 0, prompts = 0;
    await page.route('**/api/status', r => r.fulfill({json: {configured, token: 'mock', model: 'mock', preset: 'test', pack: {id: 'demo-pack'}}}));
    await page.route('**/api/chat', r => { calls++; return r.fulfill({json: {answer: '**保存测试**', model: 'mock'}}); });
    await page.route('**/api/prompt', r => { prompts++; return r.fulfill({json: {prompt: '【给辅导老师的说明】\n模拟提示词'}}); });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {origin: new URL(url).origin}).catch(() => {});
    await page.goto(url);

    // Copy-prompt mode when no key is configured.
    await page.locator('#tutor-open').click();
    await page.waitForFunction(() => tutorConfigured === false);
    assert.ok(await page.locator('#tutor-copy').isVisible(), 'copy button shown without a key');
    assert.ok(await page.locator('#tutor-send').isHidden(), 'send button hidden without a key');
    await page.locator('#tutor-question').fill('この文の意味は？');
    await page.locator('#tutor-copy').click();
    await page.waitForFunction(() => document.querySelector('#tutor-result').textContent.length > 0);
    assert.equal(prompts, 1);
    assert.equal(calls, 0);
    await page.locator('#tutor-close').click();

    // A phone on http://192.168.x.x is not a secure context: no navigator.clipboard. Fall back to execCommand,
    // and when that is refused too, show the prompt selected for manual copying.
    for (const execWorks of [true, false]) {
      const insecure = await browser.newPage({viewport: {width: 390, height: 844}});
      insecure.on('pageerror', e => errors.push(e.message));
      await insecure.route('**/api/status', r => r.fulfill({json: {configured: false, token: 'mock', model: 'mock', preset: 'test', pack: {id: 'demo-pack'}}}));
      await insecure.route('**/api/prompt', r => r.fulfill({json: {prompt: '模拟提示词'}}));
      await insecure.addInitScript(works => {
        Object.defineProperty(Navigator.prototype, 'clipboard', {get: () => undefined});
        Object.defineProperty(window, 'isSecureContext', {get: () => false});
        document.execCommand = () => works;
      }, execWorks);
      await insecure.goto(url);
      await insecure.locator('#tutor-open').click();
      await insecure.waitForFunction(() => tutorConfigured === false);
      await insecure.locator('#tutor-question').fill('この文の意味は？');
      await insecure.locator('#tutor-copy').click();
      await insecure.waitForFunction(() => document.querySelector('#tutor-result').textContent.length > 0);
      const shown = await insecure.locator('#tutor-prompt-out').isVisible();
      assert.equal(shown, !execWorks, `manual copy box ${execWorks ? 'hidden after fallback copy' : 'shown when copying is refused'}`);
      if (!execWorks) assert.equal(await insecure.evaluate(() => { const o = document.getElementById('tutor-prompt-out'); return document.activeElement === o && o.selectionEnd - o.selectionStart === o.value.length; }), true, 'prompt selected for manual copy');
      await insecure.close();
    }

    // Relay mode once configured.
    configured = true;
    await page.locator('#tab-exercises').click();
    await page.locator('[data-ask-exercise="fill-1"]').click();
    await page.waitForFunction(() => tutorConfigured === true);
    assert.ok((await page.inputValue('#tutor-question')).includes('提示'));
    await page.locator('#tutor-send').click();
    await page.waitForFunction(() => !tutorBusy);
    assert.equal(calls, 1);
    assert.equal(await page.locator('#tutor-messages .chat-message.assistant strong').last().innerText(), '保存测试');
    await page.locator('#tutor-close').click();

    // Exercise reveal: inline fills and correct choices.
    assert.equal(await page.locator('#exercises .inline-blank').count(), 2, 'two fill items in the demo lesson');
    await page.locator('#exercises [data-view="answers"]').click();
    assert.equal(await page.locator('#exercises .inline-fill').count(), 2);
    assert.equal(await page.locator('#exercises .inline-fill').first().innerText(), 'とおり');
    await page.selectOption('#exercise-group', 'choice');
    assert.equal(await page.locator('#exercises .choice-list li.revealed[data-correct=true]').count(), 2, 'answers stay revealed across groups');
    await page.locator('#exercises [data-view="answers"]').click();
    assert.equal(await page.locator('#exercises .choice-list li.revealed').count(), 0);
    await page.locator('#exercises [data-view="hints"]').click();
    assert.ok(await page.locator('#hint-choice-1').isVisible());

    const openNotes = () => page.evaluate(() => document.querySelectorAll('details.notes').forEach(d => { d.open = true; }));
    // Notes per profile and persistence.
    await page.locator('#tab-words').click();
    await openNotes();
    await page.locator('#answer-v1').fill('事情のこと');
    await page.locator('[data-done="v1"]').check();
    await page.reload();
    await page.locator('#tab-words').click();
    assert.equal(await page.inputValue('#answer-v1'), '事情のこと');
    assert.ok(await page.locator('[data-done="v1"]').isChecked());
    assert.ok((await page.locator('#note-progress').innerText()).includes('已写 1/10'));
    await page.locator('#tab-notes').click();
    assert.equal(await page.locator('#notes .note-card').count(), 1);

    // Two profiles: records are isolated and the select appears.
    await page.locator('.header-more > summary').click();
    await page.locator('#profiles-edit').click();
    await page.locator('#profiles-text').fill('我\n友人');
    await page.locator('#profiles-save').click();
    assert.ok(await page.locator('#learner-control').isVisible());
    await page.selectOption('#learner', '友人');
    await page.locator('#tab-words').click();
    assert.equal(await page.inputValue('#answer-v1'), '');
    await openNotes();
    await page.locator('#answer-v1').fill('友人のメモ');
    await page.selectOption('#learner', '我');
    assert.equal(await page.inputValue('#answer-v1'), '事情のこと');
    await page.reload();
    assert.equal(await page.inputValue('#learner'), '我');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bunmyaku:demo-pack:01:notes')));
    assert.equal(stored['我']['v:v1'].text, '事情のこと');
    assert.equal(stored['友人']['v:v1'].text, '友人のメモ');

    // Legacy key migration happens once and only for matching lessons.
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('futari-learner', '友人'); localStorage.setItem('futari-lesson01-homework-v1', JSON.stringify({'友人': {'v:v1': {text: '旧', done: false}}})); localStorage.setItem('futari-lesson19-homework-v1', '{}'); });
    await page.reload();
    const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('bunmyaku')).sort());
    assert.ok(keys.includes('bunmyaku:demo-pack:01:notes'));
    assert.ok(!keys.includes('bunmyaku:demo-pack:19:notes'));
    assert.ok(keys.includes('bunmyaku:migrated-v1'));

    // Export produces a Markdown download.
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.header-more > summary').click().then(() => page.locator('#export').click())]);
    assert.ok(download.suggestedFilename().endsWith('笔记.md'));
    for (const width of [820, 390]) {
      await page.setViewportSize({width, height: 1000});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    assert.deepEqual(errors, []);
    console.log('PASS: copy-prompt mode (with clipboard fallback), relay, exercise reveal, notes per profile, migration, export.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
