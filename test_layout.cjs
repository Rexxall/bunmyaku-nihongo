// Layout regression sweep: every lesson × eight widths × six panels (tutor open and closed on wide screens).
// Fails on page-level horizontal scroll, text overflowing its own box, elements sticking out of the sidebar
// or a card, interface labels breaking onto two lines, split fill-in blanks, a header menu that stays open, and
// page errors from audio events that fire after the learner has left the listening panel.
// Env: TEST_LOCALE, STUDY_URL (default http://127.0.0.1:8766/), PLAYWRIGHT_MODULE, PLAYWRIGHT_CHANNEL, LAYOUT_WIDTHS.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.STUDY_URL || 'http://127.0.0.1:8766/';
const launch = {headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? {channel: process.env.PLAYWRIGHT_CHANNEL} : {})};
// Interface language comes from the browser locale (zh-CN unless TEST_LOCALE says otherwise).
const locale = process.env.TEST_LOCALE || 'zh-CN';
const widths = (process.env.LAYOUT_WIDTHS || '1440,1180,1024,820,768,650,390,360').split(',').map(Number);
const panels = ['read', 'words', 'grammar', 'exercises', 'listening', 'notes'];

// Runs in the page. Returns a list of human-readable problems.
function sweep() {
  const problems = [];
  const vw = document.documentElement.clientWidth;
  const label = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].join('.') : '');
  const text = el => (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  const rendered = el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (!r.width || !r.height || s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') return false;
    // Content of a closed <details> keeps a layout box in some engines; only its summary is really shown.
    for (let d = el.closest('details:not([open])'); d; d = d.parentElement && d.parentElement.closest('details:not([open])')) {
      const summary = d.querySelector(':scope > summary');
      if (!summary || !summary.contains(el)) return false;
    }
    return !el.closest('dialog:not([open]), .sr-only');
  };
  const clippedByScroller = el => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(p).overflowX)) return true;
    }
    return false;
  };
  const lineCount = el => {
    const range = document.createRange(); range.selectNodeContents(el);
    return new Set([...range.getClientRects()].filter(r => r.width > 1).map(r => Math.round(r.top))).size;
  };

  if (document.documentElement.scrollWidth > vw + 1) problems.push(`page scrolls sideways: ${document.documentElement.scrollWidth}px in a ${vw}px window`);

  for (const el of document.querySelectorAll('body *')) {
    if (['SCRIPT', 'STYLE', 'RT', 'RP', 'RUBY', 'OPTION', 'SELECT', 'svg', 'path', 'BR'].includes(el.tagName) || !rendered(el)) continue;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    const leaf = [...el.children].every(c => getComputedStyle(c).display.startsWith('inline') || c.tagName === 'RUBY');

    // Text running past its own box (scroll containers are allowed to).
    if (leaf && s.display !== 'inline' && !['auto', 'scroll'].includes(s.overflowX) && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) {
      problems.push(`text overflows ${label(el)} "${text(el)}" (${el.scrollWidth}px in ${el.clientWidth}px)`);
    }
    // Anything past the right edge of the window that no scroller clips.
    if (s.position !== 'fixed' && r.right > vw + 1 && !clippedByScroller(el)) problems.push(`${label(el)} "${text(el)}" sticks out of the window by ${Math.round(r.right - vw)}px`);
    // Sticking out of the sidebar or a card. The tutor's resize handle overlaps its border on purpose.
    if (el.id !== 'tutor-resize') {
      for (const box of new Set([el.closest('.sidebar'), el.closest('.paper, .workcard, .exercise-card, .grammarcard, .note-card, .listen-player, #tutor-dialog')])) {
        if (!box || box === el) continue;
        const b = box.getBoundingClientRect(), out = Math.max(r.right - b.right, b.left - r.left);
        if (out > 2) problems.push(`${label(el)} "${text(el)}" sticks out of ${label(box)} by ${Math.round(out)}px`);
      }
    }
    // Interface labels (tabs, buttons, menu entries, small captions) stay on one line. Japanese study text may wrap.
    if (el.children.length === 0 && !el.closest('[lang=ja]') && el.matches('button, summary, label, .course-count, .nav-section, .brand strong, .ex-meta, .tabs *, .more-menu button')) {
      const t = (el.innerText || '').trim();
      if (t && t.length <= 16 && lineCount(el) > 1) problems.push(`label breaks onto two lines: ${label(el)} "${t}"`);
    }
    // A fill-in blank is one unit.
    if (el.classList.contains('inline-blank') && lineCount(el) > 1) problems.push(`fill-in blank split across lines in "${text(el.closest('p') || el)}"`);
  }
  return [...new Set(problems)];
}

(async () => {
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage({locale});
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message + ' @ ' + page.url() + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' | ')));
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(url);
    const lessons = await page.evaluate(() => JSON.parse(document.getElementById('pack-data').textContent).lessons.map(l => l.id));
    const failures = [];
    let views = 0;
    for (const lesson of lessons) {
      for (const width of widths) {
        await page.setViewportSize({width, height: 900});
        for (const panel of panels) {
          for (const tutor of width >= 1024 ? [false, true] : [false]) {
            await page.goto(`${url}#lesson=${lesson}&panel=${panel}${tutor ? '&tutor=' + encodeURIComponent('文脈') : ''}`);
            await page.reload();
            await page.waitForFunction(() => document.querySelector('[role=tab][aria-selected=true]'));
            await page.waitForTimeout(120);
            for (const problem of await page.evaluate(sweep)) failures.push(`lesson ${lesson} · ${width}px · ${panel}${tutor ? ' + tutor' : ''}: ${problem}`);
            views++;
          }
        }
      }
    }

    // The header menu closes after an action, on Escape, and on a click elsewhere.
    await page.setViewportSize({width: 1024, height: 800});
    await page.goto(url + '#lesson=' + lessons[0] + '&panel=read');
    await page.reload();
    const menu = page.locator('.header-more');
    const isOpen = () => menu.evaluate(d => d.open);
    await page.locator('.header-more > summary').click();
    if (!(await isOpen())) failures.push('header menu: does not open');
    await page.keyboard.press('Escape');
    if (await isOpen()) { failures.push('header menu: Escape does not close it'); await menu.evaluate(d => { d.open = false; }); }
    await page.locator('.header-more > summary').click();
    await page.locator('main').click({position: {x: 10, y: 10}});
    if (await isOpen()) { failures.push('header menu: a click elsewhere does not close it'); await menu.evaluate(d => { d.open = false; }); }
    await page.locator('.header-more > summary').click();
    await page.locator('#profiles-edit').click();
    if (await isOpen()) { failures.push('header menu: choosing an entry does not close it'); await menu.evaluate(d => { d.open = false; }); }
    await page.keyboard.press('Escape');
    await page.locator('#translation-open').click({timeout: 3000}).catch(() => failures.push('header menu: something still covers the translation button'));
    await page.keyboard.press('Escape');

    // Leaving a playing or still-loading player must not let its audio events write into the next view.
    const withAudio = await page.evaluate(() => JSON.parse(document.getElementById('pack-data').textContent).lessons.find(l => (l.listening || []).some(x => x.audio)));
    if (withAudio) {
      await page.goto(`${url}#lesson=${withAudio.id}&panel=listening`);
      await page.reload();
      await page.locator('#listen-play').click();
      await page.waitForTimeout(500);
      await page.locator('#tab-read').click();
      for (let i = 0; i < 6; i++) {
        await page.goto(`${url}#lesson=${lessons[i % lessons.length]}&panel=listening`);
        await page.reload();
        await page.waitForTimeout(40);
      }
      await page.waitForTimeout(600);
    }

    for (const e of errors) failures.push('page error: ' + e);
    if (failures.length) {
      console.error(`${failures.length} problem(s) in ${views} views:\n` + failures.join('\n'));
      process.exitCode = 1;
      return;
    }
    console.log(`PASS (${locale}): ${views} views (${lessons.length} lessons × ${widths.length} widths × ${panels.length} panels, tutor open and closed on wide screens), the header menu, and leaving a playing player.`);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
