// Learner records: notes per profile, exercise reveal, copy-prompt mode, export. Mocked API.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('assert');
const url = process.env.STUDY_URL || 'http://127.0.0.1:8766/';
const launch = {headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? {channel: process.env.PLAYWRIGHT_CHANNEL} : {})};
// Interface language comes from the browser locale (zh-CN unless TEST_LOCALE says otherwise).
const locale = process.env.TEST_LOCALE || 'zh-CN';

(async () => {
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage({locale, viewport: {width: 1440, height: 1000}});
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let configured = false, calls = 0, prompts = 0, lastChat = null;
    await page.route('**/api/status', r => r.fulfill({json: {configured, token: 'mock', model: 'mock', preset: 'test', pack: {id: 'demo-pack'}}}));
    await page.route('**/api/chat', r => { calls++; lastChat = r.request().postDataJSON(); return r.fulfill({json: {answer: '**保存测试**', model: 'mock'}}); });
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
      const insecure = await browser.newPage({locale, viewport: {width: 390, height: 844}});
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

    await page.locator('#tab-words').click();
    await openNotes();
    await page.locator('#answer-v1').fill('自分の説明');
    // Anki export: header lines Anki reads, one note per word, the sentence it appears in, the learner's own text.
    const [ankiFile] = await Promise.all([page.waitForEvent('download'), page.locator('.header-more > summary').click().then(() => page.locator('#export-anki').click())]);
    assert.ok(ankiFile.suggestedFilename().endsWith('_demo-pack_01_anki.txt'));
    const anki = require('fs').readFileSync(await ankiFile.path(), 'utf8').trimEnd().split('\n');
    const words = await page.evaluate(() => LESSONS.find(l => l.id === '01').vocabulary);
    assert.deepEqual(anki.slice(0, 4), ['#separator:tab', '#html:false', '#columns:词\t读音\t释义\t原文例句\t我的解释\t出处\tTags', '#tags column:7']);
    assert.equal(anki.length, 4 + words.length);
    const rows = anki.slice(4).map(line => line.split('\t'));
    assert.ok(rows.every(r => r.length === 7 && r[3] && r[6].startsWith('bunmyaku::demo-pack::01')), 'every note has a sentence and tags');
    assert.equal(rows[0][0], words[0].word);
    assert.ok(rows[0][4]);
    assert.equal(rows[0][4], await page.evaluate(id => record('v:' + id).text || '', words[0].id));
    assert.ok(rows.every((r, i) => (words[i].forms || [words[i].word]).some(f => r[3].includes(f))), 'sentence contains the word');
    // Web clips. The bookmarklet runs on someone else's page: it takes the selection without furigana and opens
    // this page with #clip=<JSON> in the tab named 'bunmyaku'.
    const href = await page.getAttribute('#clip-bookmarklet', 'href');
    assert.equal(await page.inputValue('#clip-code'), href);
    const code = decodeURIComponent(href.replace(/^javascript:/, ''));
    const other = await browser.newPage({locale});
    await other.setContent('<title>町のニュース</title><p>駅前の<ruby>本屋<rt>ほんや</rt></ruby>が今月で閉店するらしい。</p>');
    await other.evaluate(() => { window.opened = []; window.open = (u, n) => { opened.push([u, n]); }; window.alert = m => { window.alerted = m; }; });
    await other.evaluate(code);
    assert.ok(await other.evaluate(() => window.alerted && !opened.length), 'nothing selected: alert, no window');
    await other.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('p')); getSelection().removeAllRanges(); getSelection().addRange(r); });
    // Run the link itself, as a bookmark does, so its percent-encoding is exercised too.
    await other.evaluate(link => { location.href = link; }, href);
    await other.waitForFunction(() => opened.length > 0);
    const [[clipURL, target]] = await other.evaluate(() => opened);
    await other.close();
    assert.equal(target, 'bunmyaku');
    assert.ok(clipURL.startsWith(url + '#clip='), clipURL);
    const sent = JSON.parse(decodeURIComponent(clipURL.slice(clipURL.indexOf('#clip=') + 6)));
    assert.deepEqual([sent.text, sent.title], ['駅前の本屋が今月で閉店するらしい。', '町のニュース']);
    const clipLink = c => url + '#clip=' + encodeURIComponent(JSON.stringify(c));
    const clip = {...sent, url: 'https://example.com/news/1'};

    // The study page is already open: the hash change brings the clip in, but nothing is stored until Save.
    await page.goto(clipLink(clip));
    await page.waitForSelector('#clip-incoming-title');
    assert.equal(await page.evaluate(() => location.hash), '', 'clip removed from the address');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'clip-incoming-title');
    assert.ok(await page.locator('#clips').isVisible());
    assert.equal(await page.evaluate(() => localStorage.getItem('bunmyaku:clips')), null, 'not stored before Save');
    await page.locator('#clip-save').click();
    const me = await page.evaluate(() => learner);
    const storedClips = await page.evaluate(() => JSON.parse(localStorage.getItem('bunmyaku:clips')));
    assert.deepEqual(storedClips[me].map(c => [c.text, c.title, c.url]), [[clip.text, clip.title, clip.url]]);
    assert.equal(await page.locator('#clip-list .clip-card').count(), 1);
    assert.equal(await page.getAttribute('#clip-list .clip-source a', 'href'), clip.url);
    assert.equal(await page.getAttribute('#clip-list .clip-source a', 'rel'), 'noopener noreferrer');

    // A fresh load gets the clip too. Markup stays text, a javascript: address is dropped, Discard keeps nothing.
    await page.goto('about:blank');
    const fresh = page;
    await fresh.goto(clipLink({text: '<img src=x onerror="window.pwned=1">テスト', title: '<b>題</b>', url: 'javascript:alert(1)'}));
    await fresh.waitForSelector('#clip-incoming-title');
    assert.equal(await fresh.locator('.clip-incoming blockquote').textContent(), '<img src=x onerror="window.pwned=1">テスト');
    assert.equal(await fresh.locator('.clip-incoming img, .clip-incoming b, .clip-incoming a').count(), 0);
    await fresh.locator('#clip-discard').click();
    assert.equal(await fresh.evaluate(() => window.pwned), undefined);
    assert.equal(await fresh.locator('#clip-list .clip-card').count(), 1, 'discarded clip not added');

    // Clicking the bookmarklet on the study page itself only explains where it goes.
    await page.locator('.clip-install summary').click();
    await page.locator('#clip-bookmarklet').click();
    assert.ok(await page.locator('#toast').isVisible());
    assert.equal(await page.locator('#clip-list .clip-card').count(), 1);

    // Asking about a clip sends the clip as context instead of the lesson.
    await page.locator('[data-clip-ask]').click();
    await page.waitForFunction(() => tutorConfigured === true);
    assert.ok((await page.locator('#tutor-context').textContent()).includes('町のニュース'));
    await page.locator('#tutor-question').fill('大意は？');
    await page.locator('#tutor-send').click();
    await page.waitForFunction(() => !tutorBusy);
    assert.equal(lastChat.section, 'clip');
    assert.deepEqual(lastChat.clip, {text: clip.text, title: clip.title, url: clip.url});
    await page.locator('#tutor-close').click();

    // Clips belong to a profile.
    await page.locator('.header-more > summary').click();
    await page.locator('#profiles-edit').click();
    await page.locator('#profiles-text').fill(me + '\n友人');
    await page.locator('#profiles-save').click();
    await page.selectOption('#learner', '友人');
    assert.equal(await page.locator('#clip-list .clip-card').count(), 0);
    await page.selectOption('#learner', me);
    assert.equal(await page.locator('#clip-list .clip-card').count(), 1);

    // Lesson text for tools/import_text.py, and a Markdown copy of every clip.
    const [txt] = await Promise.all([page.waitForEvent('download'), page.locator('[data-clip-txt]').click()]);
    assert.ok(txt.suggestedFilename().endsWith('.txt'));
    assert.equal(require('fs').readFileSync(await txt.path(), 'utf8'), `# 町のニュース\nSource: 町のニュース · ${clip.url}\n\n${clip.text}\n`);
    const [md] = await Promise.all([page.waitForEvent('download'), page.locator('#clip-export-all').click()]);
    assert.ok(require('fs').readFileSync(await md.path(), 'utf8').includes(`<${clip.url}>`));

    // Delete asks first; the list survives a reload until then.
    await page.reload();
    assert.equal(await page.locator('#clip-list .clip-card').count(), 1);
    page.once('dialog', d => d.dismiss());
    await page.locator('[data-clip-delete]').click();
    assert.equal(await page.locator('#clip-list .clip-card').count(), 1);
    page.once('dialog', d => d.accept());
    await page.locator('[data-clip-delete]').click();
    assert.equal(await page.locator('#clip-list .clip-card').count(), 0);
    assert.ok(await page.locator('#clip-list .empty-panel').isVisible());
    // A stored entry edited by hand still renders as text, and a javascript: address does not become a link.
    await page.evaluate(name => localStorage.setItem('bunmyaku:clips', JSON.stringify({[name]: [{id: 'x', text: '<b>手</b>', title: 7, url: 'javascript:alert(1)', at: 'x'}]})), me);
    await page.reload();
    assert.equal(await page.locator('#clip-list .clip-card').count(), 1);
    assert.equal(await page.locator('#clip-list .clip-card a, #clip-list .clip-card b').count(), 0);

    for (const width of [820, 390]) {
      await page.setViewportSize({width, height: 1000});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    assert.deepEqual(errors, []);
    console.log('PASS: copy-prompt mode (with clipboard fallback), relay, exercise reveal, notes per profile, migration, Markdown and Anki export, web clips.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
