'use strict';
/* Bunmyaku study page. Everything on this page is driven by the course pack injected as #pack-data.
   Browser storage holds only learner records (notes, positions, audio progress), keyed by pack id,
   lesson id and learner profile. No network calls except /api/* on the same origin. */

const PACK = JSON.parse(document.getElementById('pack-data').textContent);
const PACK_ID = String(PACK.id || 'pack');
const LESSONS = PACK.lessons.map(l => ({...l, id: String(l.id)}));
// Set by tools/export_static.py: the page is served as plain files, without /api.
const STATIC_DEMO = document.documentElement.dataset.static === '1';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const KANJI = /[一-龯々〆〇]/u;
const KANJI_RUN = /[一-龯々〆〇]+/gu;

// ------------------------------------------------------------------ storage

const store = {
  get(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v === null || v === undefined ? fallback : v; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
};
const K = {
  profiles: 'bunmyaku:profiles', learner: 'bunmyaku:learner', ruby: 'bunmyaku:ruby', tutorWidth: 'bunmyaku:tutor-width',
  migrated: 'bunmyaku:migrated-v1', resume: `bunmyaku:${PACK_ID}:resume`,
  notes: lesson => `bunmyaku:${PACK_ID}:${lesson}:notes`,
};

// One-time migration from the private predecessor ("futari-" keys). Lesson records move only
// when this pack has a lesson with the same id; unrelated keys are left untouched.
(function migrateLegacy() {
  try {
    if (localStorage.getItem(K.migrated)) return;
    const copy = (from, to, transform = x => x) => {
      const raw = localStorage.getItem(from);
      if (raw !== null && localStorage.getItem(to) === null) localStorage.setItem(to, transform(raw));
    };
    copy('futari-learner', K.learner, v => JSON.stringify(v));
    copy('futari-ruby-visible', K.ruby, v => JSON.stringify(v !== '0'));
    copy('futari-tutor-width', K.tutorWidth, v => JSON.stringify(Number(v) || 420));
    for (let i = 0; i < localStorage.length; i++) {
      const m = /^futari-lesson(\d+)-homework-v1$/.exec(localStorage.key(i) || '');
      if (m && LESSONS.some(l => l.id === m[1])) copy(m[0], K.notes(m[1]));
    }
    localStorage.setItem(K.migrated, '1');
  } catch {}
})();

// ------------------------------------------------------------------ profiles & notes

function packProfiles() {
  const list = Array.isArray(PACK.profiles) ? PACK.profiles.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [];
  return list.length ? [...new Set(list)] : ['我'];
}
let profiles = (() => { const saved = store.get(K.profiles, null); return Array.isArray(saved) && saved.length ? saved : packProfiles(); })();
let learner = (() => { const saved = store.get(K.learner, null); return profiles.includes(saved) ? saved : profiles[0]; })();
let course = LESSONS[0].id, L = LESSONS[0];
const noteCache = {};
let storageOK = true;

function notesFor(lesson = course) {
  if (!noteCache[lesson]) {
    const saved = store.get(K.notes(lesson), {});
    noteCache[lesson] = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  }
  const all = noteCache[lesson];
  if (!all[learner] || typeof all[learner] !== 'object') all[learner] = {};
  return all;
}
function record(id) {
  const r = notesFor()[learner][id];
  return r && typeof r === 'object' ? {text: typeof r.text === 'string' ? r.text : '', done: r.done === true} : {text: '', done: false};
}
function save(id, patch) {
  const all = notesFor();
  all[learner][id] = {...record(id), ...patch};
  storageOK = store.set(K.notes(course), all);
  $('save-status').textContent = storageOK ? '已保存到本机' : '本机存储不可用，请导出备份';
  updateProgress();
}
function updateProgress() {
  const words = L.vocabulary || [];
  const written = words.filter(e => record('v:' + e.id).text.trim()).length, done = words.filter(e => record('v:' + e.id).done).length;
  $('note-progress').textContent = `${learner}：已写 ${written}/${words.length} · 自认能解释 ${done}/${words.length}`;
  $('print-name').textContent = `${learner} · ${L.title}`;
}
function notify(msg) {
  $('toast').textContent = msg; $('toast').hidden = false;
  clearTimeout(notify.timer); notify.timer = setTimeout(() => { $('toast').hidden = true; }, 3200);
}

function renderLearnerSelect() {
  $('learner').innerHTML = profiles.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  $('learner').value = learner;
  $('learner-control').hidden = profiles.length < 2;
}
$('learner').onchange = e => {
  saveStudyPosition();
  document.querySelector('#listening audio')?.pause();
  learner = e.target.value; store.set(K.learner, learner);
  renderAll(); $('save-status').textContent = '已切换到 ' + learner;
  if (!$('tutor-dialog').hidden) tutorRender();
  if (profile().position) restoreStudyPosition();
};
$('profiles-edit').onclick = () => { $('profiles-text').value = profiles.join('\n'); $('profiles-dialog').showModal(); };
$('profiles-close').onclick = () => $('profiles-dialog').close();
$('profiles-reset').onclick = () => { $('profiles-text').value = packProfiles().join('\n'); };
$('profiles-save').onclick = e => {
  e.preventDefault();
  const list = [...new Set($('profiles-text').value.split('\n').map(x => x.trim()).filter(Boolean))].slice(0, 8);
  if (!list.length) { notify('至少保留一个名字。'); return; }
  profiles = list; store.set(K.profiles, profiles);
  if (!profiles.includes(learner)) { learner = profiles[0]; store.set(K.learner, learner); }
  renderLearnerSelect(); renderAll(); $('profiles-dialog').close(); notify('学习档案已更新。');
};

// ------------------------------------------------------------------ resume (position, audio)

let resume = store.get(K.resume, {}), studyReady = false, restoringStudy = false;
if (!resume || typeof resume !== 'object' || Array.isArray(resume)) resume = {};
function persistResume() { store.set(K.resume, resume); }
function profile(name = learner) { if (!resume[name] || typeof resume[name] !== 'object') resume[name] = {}; return resume[name]; }
function saveStudyPosition() {
  if (!studyReady || restoringStudy) return;
  profile().position = {course, panel: document.body.dataset.panel || 'read', listening: listeningId, y: window.scrollY};
  persistResume();
}
function audioRecord(name, key) { const r = profile(name).audio?.[key]; return r && typeof r === 'object' ? r : {}; }
function saveAudioState(name, key, patch) { const p = profile(name); p.audio ||= {}; p.audio[key] = {...audioRecord(name, key), ...patch}; persistResume(); }
function restoreStudyPosition() {
  const p = profile().position;
  if (!p || typeof p !== 'object') return;
  restoringStudy = true;
  try {
    if (LESSONS.some(l => l.id === p.course)) switchCourse(p.course);
    if (typeof p.listening === 'string' && (L.listening || []).some(x => x.id === p.listening)) listeningId = p.listening;
    if (['read', 'words', 'grammar', 'exercises', 'listening', 'notes'].includes(p.panel)) showTab(p.panel);
    const y = Number.isFinite(p.y) ? Math.max(0, p.y) : 0;
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
  } finally { restoringStudy = false; }
}
window.addEventListener('pagehide', saveStudyPosition);
let scrollTimer; window.addEventListener('scroll', () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(saveStudyPosition, 300); }, {passive: true});

// ------------------------------------------------------------------ ruby (furigana)

// Bracket notation from the pack: 漢字[かんじ]. Returns tokens {text, reading?} whose texts join to the plain text.
function parseRuby(ruby) {
  const tokens = []; let at = 0; const re = /([一-龯々〆〇]+)\[([^\]]+)\]/gu; let m;
  while ((m = re.exec(ruby))) {
    if (m.index > at) tokens.push({text: ruby.slice(at, m.index)});
    tokens.push({text: m[1], reading: m[2]}); at = re.lastIndex;
  }
  if (at < ruby.length) tokens.push({text: ruby.slice(at)});
  return tokens;
}
function tokensToHTML(tokens, status) {
  const cls = status === 'unverified' ? ' class="unverified"' : '';
  return tokens.map(t => t.reading ? `<ruby${cls}>${esc(t.text)}<rt>${esc(t.reading)}</rt></ruby>` : esc(t.text)).join('');
}
// Whole-word reading alignment: splits a kana reading over the kanji runs of a word without a dictionary.
function sourceReading(word, reading) {
  if (!reading || !KANJI.test(word)) return esc(word);
  const parts = word.match(/[一-龯々〆〇]+|[^一-龯々〆〇]+/gu);
  const hira = t => t.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 96));
  const kana = hira(reading), solutions = [];
  (function align(i, at, result) {
    if (solutions.length > 1) return;
    if (i === parts.length) { if (at === kana.length) solutions.push(result); return; }
    const part = parts[i];
    if (!/^[一-龯々〆〇]+$/u.test(part)) {
      const literal = hira(part);
      if (kana.startsWith(literal, at)) align(i + 1, at + literal.length, [...result, {text: part}]);
      return;
    }
    for (let end = at + 1; end <= kana.length; end++) align(i + 1, end, [...result, {text: part, reading: kana.slice(at, end)}]);
  })(0, 0, []);
  if (solutions.length !== 1) return `<ruby>${esc(word)}<rt>${esc(reading)}</rt></ruby>`;
  return tokensToHTML(solutions[0]);
}
// Fallback tokens for text without bracket ruby: lesson readings table, then vocabulary words.
function dictionaryTokens(text) {
  const dict = {...(L.readings || {})};
  for (const e of L.vocabulary || []) if (KANJI.test(e.word) && e.reading && !dict[e.word]) dict[e.word] = e.reading;
  const keys = Object.keys(dict).sort((a, b) => b.length - a.length);
  const tokens = []; let i = 0, plain = '';
  const flush = () => { if (plain) { tokens.push({text: plain}); plain = ''; } };
  while (i < text.length) {
    const key = keys.find(k => text.startsWith(k, i));
    if (key) {
      flush();
      const box = document.createElement('div'); box.innerHTML = sourceReading(key, dict[key]);
      for (const node of box.childNodes) {
        if (node.nodeType === 3) tokens.push({text: node.data});
        else tokens.push({text: node.firstChild.textContent, reading: node.querySelector('rt').textContent, guessed: true});
      }
      i += key.length;
    } else plain += text[i++];
  }
  flush();
  return tokens;
}
function rubyTokens(text, ruby) {
  if (typeof ruby === 'string' && ruby) {
    const tokens = parseRuby(ruby);
    if (tokens.map(t => t.text).join('') === text) return tokens;
  }
  return dictionaryTokens(text);
}
function rubyHTML(text, ruby, status) { return tokensToHTML(rubyTokens(text, ruby), status); }
function statusChip(status) {
  if (!status || status === 'human' || status === 'verified') return '';
  return `<span class="status-chip ${esc(status)}">${status === 'machine' ? '机器译' : '未核对'}</span>`;
}

// ------------------------------------------------------------------ reading panel

let selected = null, lastAnchor = null;
const vocab = () => L.vocabulary || [];
const grammar = () => L.grammar || [];
function vocabHits(text) {
  const hits = [];
  for (const e of vocab()) for (const form of e.forms || []) {
    let i = text.indexOf(form);
    while (form && i >= 0) { hits.push({start: i, end: i + form.length, id: e.id}); i = text.indexOf(form, i + form.length); }
  }
  return hits;
}
function grammarRanges(text) {
  const ranges = [];
  for (const g of grammar()) { if (!g.phrase) continue; const start = text.indexOf(g.phrase); if (start >= 0) ranges.push({start, end: start + g.phrase.length, id: g.id, g}); }
  ranges.sort((a, b) => a.start - b.start);
  const out = []; let at = 0;
  for (const r of ranges) { if (r.start < at) continue; out.push(r); at = r.end; }
  return out;
}
// Split ruby tokens at highlight boundaries (plain tokens split freely; a kanji run with its reading stays whole).
function annotateParagraph(p) {
  const text = p.text, tokens = rubyTokens(text, p.ruby), hits = vocabHits(text), ranges = grammarRanges(text);
  const bounds = new Set([...hits.flatMap(h => [h.start, h.end]), ...ranges.flatMap(r => [r.start, r.end])]);
  const segments = []; let at = 0;
  for (const t of tokens) {
    const end = at + t.text.length;
    if (t.reading) segments.push({start: at, end, html: tokensToHTML([t], p.ruby_status)});
    else {
      let s = at;
      for (const b of [...bounds].filter(b => b > at && b < end).sort((x, y) => x - y)) { segments.push({start: s, end: b, html: esc(text.slice(s, b))}); s = b; }
      segments.push({start: s, end, html: esc(text.slice(s, end))});
    }
    at = end;
  }
  let out = '', openGrammar = null, openIds = '';
  const closeWord = () => { if (openIds) { out += '</button>'; openIds = ''; } };
  const closeGrammar = () => { closeWord(); if (openGrammar) { out += '</span>'; openGrammar = null; } };
  for (const seg of segments) {
    const range = ranges.find(r => r.start <= seg.start && r.end >= seg.end) || null;
    if ((range && range.id) !== (openGrammar && openGrammar.id)) {
      closeGrammar();
      if (range) { openGrammar = range; out += `<span class="grammar" tabindex="-1" data-grammar="${esc(range.id)}" title="语法：${esc(range.g.name)}">`; }
    }
    const ids = [...new Set(hits.filter(h => h.start <= seg.start && h.end >= seg.end).sort((x, y) => (y.end - y.start) - (x.end - x.start)).map(h => h.id))].join(',');
    if (ids !== openIds) {
      closeWord();
      if (ids) { openIds = ids; out += `<button type="button" class="word" data-ids="${esc(ids)}">`; }
    }
    out += seg.html;
  }
  closeGrammar();
  return out;
}
function renderPassage() {
  const paragraphs = L.paragraphs || [];
  $('passage').innerHTML = paragraphs.map((p, i) => {
    const tr = p.translation || {};
    const grammarButtons = grammar().filter(g => g.phrase && p.text.includes(g.phrase)).map(g => `<button data-gview="${esc(g.id)}">${esc(g.name)}</button>`).join('');
    const sentences = Array.isArray(p.sentences) && p.sentences.length ? `<details class="sentence-toggle"><summary lang="zh-CN">逐句精讲 · ${p.sentences.length} 句</summary><ol class="sentence-list">${p.sentences.map(s => `<li class="sentence-card"><p class="sentence-ja" lang="ja">${rubyHTML(s.text, s.ruby, s.ruby_status)}</p><p lang="zh-CN">${esc(s.translation || '')}</p>${s.structure ? `<h4>句子结构</h4><p lang="zh-CN">${esc(s.structure)}</p>` : ''}${s.usage ? `<h4>用法与语气</h4><p lang="zh-CN">${esc(s.usage)}</p>` : ''}${s.example ? `<div class="sentence-example"><p lang="ja">${rubyHTML(s.example, s.example_ruby)}</p><p lang="zh-CN">${esc(s.example_translation || '')}</p></div>` : ''}<button type="button" class="ask-sentence" data-ask-sentence="${esc(s.text)}">继续问这句 ✧</button></li>`).join('')}</ol></details>` : '';
    return `<div class="p-label" lang="zh-CN">第 ${i + 1} 段 ${statusChip(p.ruby_status)}</div><p>${annotateParagraph(p)}</p><div class="grammar-actions">${grammarButtons}</div>${tr.text ? `<details class="paragraph-translation"><summary lang="zh-CN">按需看这一段的译文 ${statusChip(tr.status)}</summary><div lang="zh-CN">${esc(tr.text)}</div></details>` : ''}${sentences}`;
  }).join('');
  document.querySelectorAll('[data-gview]').forEach(b => b.onclick = () => selectGrammar(b.dataset.gview, b));
  document.querySelectorAll('[data-ask-sentence]').forEach(b => b.onclick = () => { openTutor(); tutorSelection = b.dataset.askSentence; tutorRender(); $('tutor-question').value = '请继续详细讲解这句话，结合上下文解释词语、助词、修饰关系与语气。'; });
}
$('passage').addEventListener('click', ev => {
  const w = ev.target.closest('[data-ids]'), g = ev.target.closest('[data-grammar]');
  if (w) selectEntry(w.dataset.ids.split(',')[0], w); else if (g) selectGrammar(g.dataset.grammar, g);
});
// Grammar underlines are mouse targets only (words inside them are buttons); keyboard users open grammar from the buttons under each paragraph.
function simpleBlock(e) {
  return e.simple ? `<p class="field-label">简单日语解释</p><div class="jp" lang="ja">${esc(e.simple)}</div>` : '';
}
function meaningText(e) {
  const m = e.meaning || {}; if (typeof m === 'string') return m;
  const main = m[PACK.translation_language] || Object.values(m)[0] || '';
  const extra = Object.entries(m).filter(([k, v]) => v && v !== main).map(([, v]) => v);
  return esc(main) + (extra.length ? ` <small>· ${extra.map(esc).join(' · ')}</small>` : '');
}
function selectEntry(id, anchor) {
  selected = id; lastAnchor = anchor || lastAnchor;
  document.querySelectorAll('.word').forEach(x => x.classList.toggle('selected', x.dataset.ids.split(',').includes(String(id))));
  renderDetail(); openDetail();
}
function renderDetail() {
  const e = vocab().find(x => x.id === selected) || vocab()[0];
  if (!e) { $('detail').innerHTML = '<p class="minor">本课没有词条。</p>'; return; }
  selected = e.id;
  const r = record('v:' + e.id), forms = (e.forms || []).filter(f => (L.paragraphs || []).some(p => p.text.includes(f)));
  $('detail').innerHTML = `<small>词条 ${vocab().indexOf(e) + 1}/${vocab().length} ${statusChip(e.reading_status === 'verified' ? '' : e.reading_status)}</small><h3 lang="ja">${sourceReading(e.word, e.reading)}</h3><p class="kana" lang="ja">${esc(e.reading || '')}</p><p>${meaningText(e)}</p>${simpleBlock(e)}${forms.length ? `<p class="field-label">正文里看到的样子</p><p lang="ja">${forms.map(esc).join(' ／ ')}</p>` : ''}${e.similar ? `<p class="field-label">相似词，哪里不同？</p><p>${esc(e.similar)}</p>` : ''}${e.memo ? `<details><summary>汉字／构词提示</summary><p>${esc(e.memo)}</p></details>` : ''}<details class="notes"><summary>我的笔记</summary><label class="field-label" for="detail-answer">${esc(learner)}：用自己的话解释</label><textarea id="detail-answer" lang="ja" placeholder="先自己说，再写下来。">${esc(r.text)}</textarea><label class="checks"><input id="detail-done" type="checkbox" ${r.done ? 'checked' : ''}>我能不看参考解释这个词</label></details><button class="top-return" id="return-text">回到刚才的正文位置</button>`;
  $('detail-answer').oninput = ev => save('v:' + e.id, {text: ev.target.value});
  $('detail-done').onchange = ev => save('v:' + e.id, {done: ev.target.checked});
  $('return-text').onclick = () => { closeDetail(); if (lastAnchor) { lastAnchor.scrollIntoView({block: 'center'}); lastAnchor.focus(); } else $('passage').scrollIntoView(); };
}
function grammarCard(g) {
  return `<h3 lang="ja">${esc(g.name)}</h3>${g.phrase ? `<blockquote lang="ja">${rubyHTML(g.phrase, g.phrase_ruby)}</blockquote>` : '<p class="hint">正文未完整出现；见例句。</p>'}<dl>${g.meaning ? `<dt>意思</dt><dd>${esc(g.meaning)}</dd>` : ''}${g.connection ? `<dt>接续</dt><dd lang="ja">${esc(g.connection)}</dd>` : ''}${g.example ? `<dt>例句</dt><dd lang="ja">${rubyHTML(g.example, g.example_ruby)}${g.example_translation ? `<br><span class="minor">${esc(g.example_translation)}</span>` : ''}</dd>` : ''}${g.trap ? `<dt>别混淆</dt><dd>${esc(g.trap)}</dd>` : ''}</dl>`;
}
function selectGrammar(id, anchor) {
  const g = grammar().find(x => x.id === id); if (!g) return;
  lastAnchor = anchor || lastAnchor;
  $('detail').innerHTML = grammarCard(g) + '<button id="back-to-passage">回正文</button>';
  $('back-to-passage').onclick = () => { closeDetail(); if (lastAnchor) { lastAnchor.scrollIntoView({block: 'center'}); lastAnchor.focus(); } };
  if (anchor) openDetail();
}
function locate(id) {
  showTab('read');
  const el = [...document.querySelectorAll('[data-ids]')].find(x => x.dataset.ids.split(',').includes(String(id)));
  selectEntry(id, el);
  if (el && !matchMedia('(max-width:1100px)').matches) { el.scrollIntoView({block: 'center'}); el.focus(); }
}
function locateGrammar(id) {
  showTab('read'); const el = document.querySelector(`[data-grammar="${id}"]`); selectGrammar(id, el);
  if (el && !matchMedia('(max-width:1100px)').matches) { el.scrollIntoView({block: 'center'}); el.focus(); }
}

// Mobile drawer for the reading companion.
const detailHome = document.createComment('reading detail position'); $('detail-shell').before(detailHome);
function openDetail() {
  if (!matchMedia('(max-width:1100px)').matches) return;
  document.body.append($('detail-shell')); $('detail-shell').classList.add('is-open');
  $('detail-shell').setAttribute('role', 'dialog'); $('detail-shell').setAttribute('aria-modal', 'true'); $('detail-shell').setAttribute('aria-label', '随读解释');
  document.body.classList.add('drawer-open'); $('detail-close').focus();
}
function closeDetail(restore = true) {
  const wasOpen = $('detail-shell').classList.contains('is-open');
  $('detail-shell').classList.remove('is-open'); $('detail-shell').removeAttribute('role'); $('detail-shell').removeAttribute('aria-modal');
  document.body.classList.remove('drawer-open'); detailHome.after($('detail-shell'));
  if (wasOpen && restore && lastAnchor) lastAnchor.focus();
}
$('detail-close').onclick = () => closeDetail(); $('detail-backdrop').onclick = () => closeDetail();
document.addEventListener('keydown', e => {
  if (!$('detail-shell').classList.contains('is-open')) return;
  if (e.key === 'Escape') { e.preventDefault(); closeDetail(); }
  if (e.key === 'Tab') {
    const nodes = [...$('detail-shell').querySelectorAll('button,summary,textarea,input,a')].filter(x => x.getClientRects().length);
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
matchMedia('(max-width:1100px)').addEventListener('change', () => closeDetail(false));

$('vocab-toggle').onchange = e => $('passage').classList.toggle('hide-words', !e.target.checked);
$('grammar-toggle').onchange = e => $('passage').classList.toggle('hide-grammar', !e.target.checked);
$('ruby-toggle').onchange = e => { document.body.classList.toggle('hide-ruby', !e.target.checked); store.set(K.ruby, e.target.checked); };
if (store.get(K.ruby, true) === false) { $('ruby-toggle').checked = false; document.body.classList.add('hide-ruby'); }

function renderTranslation() {
  $('translation-title').textContent = `${L.title} · 全文译文`;
  const parallel = $('parallel').checked;
  $('translation-content').innerHTML = (L.paragraphs || []).map((p, i) => `<section class="translation-row ${parallel ? '' : 'zh-only'}">${parallel ? `<div><span class="tag">第${i + 1}段 · 原文</span><p class="original" lang="ja">${rubyHTML(p.text, p.ruby, p.ruby_status)}</p></div>` : ''}<div><span class="tag">第${i + 1}段 · 译文 ${statusChip((p.translation || {}).status)}</span><p>${esc((p.translation || {}).text || '（无译文）')}</p></div></section>`).join('');
}
$('translation-open').onclick = () => { renderTranslation(); $('translation-dialog').showModal(); };
$('translation-close').onclick = () => $('translation-dialog').close(); $('parallel').onchange = renderTranslation;

// ------------------------------------------------------------------ words & grammar panels

const wordDisclosure = {};
function wordOpen(id) { return wordDisclosure[`${learner}:${course}`]?.[id] !== false; }
function updateDisclosureButton() {
  const all = vocab().every(e => wordOpen(e.id));
  $('hide-refs').textContent = all ? '全部收起释义' : '全部展开释义';
}
function renderWords() {
  const q = $('search').value.trim().toLowerCase();
  const list = vocab().filter(e => [e.word, e.reading, JSON.stringify(e.meaning || ''), e.simple, ...(e.forms || [])].join(' ').toLowerCase().includes(q));
  $('word-grid').innerHTML = list.length ? list.map(e => {
    const r = record('v:' + e.id);
    return `<article class="workcard"><div class="term-heading"><h3 lang="ja"><small>${vocab().indexOf(e) + 1}</small> ${sourceReading(e.word, e.reading)}</h3>${statusChip(e.reading_status === 'verified' ? '' : e.reading_status)}</div>${e.simple ? `<div class="simple-words"><div class="simple-chips" lang="ja"><span>${esc(e.simple)}</span></div></div>` : ''}<details class="word-reference" data-reference="${esc(e.id)}" ${wordOpen(e.id) ? 'open' : ''}><summary>释义与辨析</summary><p class="minor">${meaningText(e)}</p>${e.similar ? `<p>${esc(e.similar)}</p>` : ''}${e.memo ? `<p class="minor">${esc(e.memo)}</p>` : ''}</details><details class="notes"><summary>我的笔记</summary><label for="answer-${esc(e.id)}">${esc(learner)}：用自己的话解释</label><textarea id="answer-${esc(e.id)}" data-answer="${esc(e.id)}" lang="ja" placeholder="～ことです。／～という意味です。">${esc(r.text)}</textarea><label class="checks"><input type="checkbox" data-done="${esc(e.id)}" ${r.done ? 'checked' : ''}>我能不看参考解释</label></details><button class="locate" data-locate="${esc(e.id)}">课文定位 ↗</button></article>`;
  }).join('') : '<p class="empty">没有找到。试试日语原词、假名或译文。</p>';
  document.querySelectorAll('[data-answer]').forEach(x => x.oninput = () => save('v:' + x.dataset.answer, {text: x.value}));
  document.querySelectorAll('[data-done]').forEach(x => x.onchange = () => save('v:' + x.dataset.done, {done: x.checked}));
  document.querySelectorAll('[data-locate]').forEach(x => x.onclick = () => locate(x.dataset.locate));
  const key = `${learner}:${course}`;
  document.querySelectorAll('[data-reference]').forEach(x => x.addEventListener('toggle', () => { if (!x.isConnected) return; (wordDisclosure[key] ||= {})[x.dataset.reference] = x.open; updateDisclosureButton(); }));
  updateDisclosureButton(); updateProgress();
}
$('search').oninput = renderWords;
$('hide-refs').onclick = () => {
  const open = !vocab().every(e => wordOpen(e.id));
  wordDisclosure[`${learner}:${course}`] = Object.fromEntries(vocab().map(e => [e.id, open]));
  document.querySelectorAll('#word-grid .word-reference').forEach(x => x.open = open); updateDisclosureButton();
};
function renderGrammars() {
  $('grammar-grid').innerHTML = grammar().length ? grammar().map(g => `<article class="grammarcard" id="grammar-${esc(g.id)}">${grammarCard(g)}${g.phrase && (L.paragraphs || []).some(p => p.text.includes(g.phrase)) ? `<button data-grammar-locate="${esc(g.id)}">在正文中定位</button>` : ''}</article>`).join('') : '<p class="empty-panel">本课没有语法条目。</p>';
  document.querySelectorAll('[data-grammar-locate]').forEach(x => x.onclick = () => locateGrammar(x.dataset.grammarLocate));
}

// ------------------------------------------------------------------ exercises

let exerciseGroup = null;
const exerciseView = {answers: false, hints: false, explanations: false};
const icons = {
  answers: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  hints: '<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2Z"/>',
  explanations: '<path d="M12 6v15M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2Z"/>',
  transcript: '<path d="M6 3h9l4 4v14H5V3h1Zm8 0v5h5M8 12h8M8 16h8"/>',
  translation: '<path d="M3 5h12M9 3v2M6 5c0 5 4 9 8 10M12 5c0 5-4 9-8 10M14 21l4-10 4 10M15.5 17h5"/>',
};
function studyIcon(button, kind, on) {
  const name = {answers: '答案', hints: '提示', explanations: '讲解', transcript: '原文', translation: '译文'}[kind], label = (on ? '隐藏' : '显示') + name;
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[kind]}</svg>`; button.classList.add('study-icon');
  button.setAttribute('aria-label', label); button.title = label; button.setAttribute('aria-pressed', String(on));
}
function questionHTML(e, open) {
  if (e.type === 'fill' && Array.isArray(e.answers)) {
    let i = 0;
    return String(e.question).split(/(＿+|_{2,})/).map(part => /^(＿+|_{2,})$/.test(part) ? (open ? `<mark class="inline-fill">${esc(e.answers[i++] ?? '')}</mark>` : (i++, `<span class="inline-blank">${esc(part)}</span>`)) : esc(part)).join('');
  }
  return esc(e.question);
}
function exerciseCard(e, index, open) {
  const choices = e.type === 'choice' && Array.isArray(e.choices) ? `<ol class="choice-list">${e.choices.map((c, j) => `<li lang="ja" data-correct="${c === e.answer}" class="${open ? 'revealed' : ''}"><span>${String.fromCharCode(97 + j)}.</span>${esc(c)}</li>`).join('')}</ol>` : '';
  const answer = e.type === 'fill' ? '' : (e.answer || e.reference) ? `<div class="reveal-panel answer-panel" id="answer-${esc(e.id)}" ${open ? '' : 'hidden'}><p class="ex-question" lang="ja">${esc(e.answer || e.reference)}</p>${e.type === 'open' ? '<p class="minor">开放题：以上是参考说法，答案不唯一。</p>' : ''}</div>` : '';
  const r = record('x:' + e.id);
  return `<article class="exercise-card" data-exercise="${esc(e.id)}"><div class="ex-meta"><span>第 ${index + 1} 题 · ${({fill: '填空', choice: '选择', transform: '改写', open: '自由作答'})[e.type] || esc(e.type || '')}</span></div><p class="ex-question" id="question-${esc(e.id)}" lang="ja" aria-live="polite">${questionHTML(e, open)}</p>${choices}${e.hint ? `<div class="reveal-panel hint-panel" id="hint-${esc(e.id)}" ${exerciseView.hints ? '' : 'hidden'}>${esc(e.hint)}</div>` : ''}${answer}${e.explanation ? `<div class="reveal-panel explain-panel" id="explain-${esc(e.id)}" ${exerciseView.explanations ? '' : 'hidden'}><strong>为什么这样答</strong><p>${esc(e.explanation)}</p></div>` : ''}<details class="notes"><summary>我的作答</summary><textarea data-exercise-note="${esc(e.id)}" lang="ja" placeholder="先自己答，再看答案。">${esc(r.text)}</textarea></details><button class="ask-exercise" aria-label="问老师这道题" title="问这道题" data-ask-exercise="${esc(e.id)}"><span aria-hidden="true">✧</span></button></article>`;
}
function applyExerciseView(root, items) {
  for (const e of items) {
    const q = root.querySelector(`#question-${CSS.escape(e.id)}`); if (q) q.innerHTML = questionHTML(e, exerciseView.answers);
    root.querySelectorAll(`[data-exercise="${CSS.escape(e.id)}"] .choice-list li`).forEach(li => li.classList.toggle('revealed', exerciseView.answers));
    const a = root.querySelector(`#answer-${CSS.escape(e.id)}`); if (a) a.hidden = !exerciseView.answers;
    const h = root.querySelector(`#hint-${CSS.escape(e.id)}`); if (h) h.hidden = !exerciseView.hints;
    const x = root.querySelector(`#explain-${CSS.escape(e.id)}`); if (x) x.hidden = !exerciseView.explanations;
  }
  for (const kind of ['hints', 'answers', 'explanations']) { const b = root.querySelector(`[data-view="${kind}"]`); if (b) studyIcon(b, kind, exerciseView[kind]); }
}
function bindExerciseCards(root, items, section) {
  root.querySelectorAll('[data-exercise-note]').forEach(x => x.oninput = () => save('x:' + x.dataset.exerciseNote, {text: x.value}));
  root.querySelectorAll('[data-ask-exercise]').forEach(b => b.onclick = () => openTutor({section, itemId: b.dataset.askExercise, prompt: '请先给我这道题的思考提示，不要直接公布完整答案。'}));
  root.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { exerciseView[b.dataset.view] = !exerciseView[b.dataset.view]; applyExerciseView(root, items); });
  applyExerciseView(root, items);
}
const viewButtons = () => `<div class="study-visibility" role="group" aria-label="整组显示"><button data-view="hints"></button><button data-view="answers"></button><button data-view="explanations"></button></div>`;
function renderExercises() {
  const groups = L.exercises || [];
  if (!groups.length) { $('exercises').innerHTML = '<div class="section-bar"><h2>练习</h2></div><p class="empty-panel">本课没有练习。</p>'; return; }
  if (!groups.some(g => g.id === exerciseGroup)) exerciseGroup = groups[0].id;
  const at = groups.findIndex(g => g.id === exerciseGroup), g = groups[at];
  $('exercises').innerHTML = `<div class="section-bar exercise-bar"><h2>练习</h2><div class="bar-controls"><select id="exercise-group" aria-label="练习部分">${groups.map(x => `<option value="${esc(x.id)}">${esc(x.title)}</option>`).join('')}</select><div class="button-pair"><button id="ex-prev" aria-label="上一部分">←</button><button id="ex-next" aria-label="下一部分">→</button></div>${viewButtons()}</div></div>${g.instruction ? `<p class="hint">${esc(g.instruction)}</p>` : ''}<div id="exercise-body">${g.items.map((e, i) => exerciseCard(e, i, exerciseView.answers)).join('')}</div>`;
  $('exercise-group').value = exerciseGroup;
  $('exercise-group').onchange = e => { exerciseGroup = e.target.value; renderExercises(); };
  $('ex-prev').disabled = at === 0; $('ex-next').disabled = at === groups.length - 1;
  $('ex-prev').onclick = () => { exerciseGroup = groups[at - 1].id; renderExercises(); };
  $('ex-next').onclick = () => { exerciseGroup = groups[at + 1].id; renderExercises(); };
  bindExerciseCards($('exercises'), g.items, 'read');
}

// ------------------------------------------------------------------ listening

let listeningId = null;
const listenView = {transcript: true, translation: false};
const SPEEDS = [0.6, 0.75, 0.9, 1, 1.1, 1.25];
function clock(t) { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
function renderListening() {
  const items = L.listening || [];
  document.querySelector('#listening audio')?.pause();
  if (!items.length) { $('listening').innerHTML = '<div class="section-bar"><h2>听力</h2></div><p class="empty-panel">本课没有听力条目。</p>'; listeningId = null; return; }
  if (!items.some(x => x.id === listeningId)) listeningId = items[0].id;
  const at = items.findIndex(x => x.id === listeningId), item = items[at];
  const speed = audioRecord(learner, 'settings').speed, rate = SPEEDS.includes(speed) ? speed : 1;
  const player = item.audio ? `<div class="listen-player"><div class="listen-player-top"><select id="listen-speed" aria-label="播放速度">${SPEEDS.map(v => `<option value="${v}" ${v === rate ? 'selected' : ''}>${v}×</option>`).join('')}</select><button id="listen-loop-a" title="把当前位置设为循环起点">A</button><button id="listen-loop-b" title="把当前位置设为循环终点，开始循环">B</button><button id="listen-loop-clear" class="icon-btn" title="清除循环" aria-label="清除循环">↺</button><button id="listen-loop-save" class="icon-btn" title="保存当前循环片段" aria-label="保存当前循环片段" disabled>＋</button><span id="listen-loop-label" class="minor" aria-live="polite"></span></div><div class="listen-transport" role="group" aria-label="精听操作"><button id="listen-back" aria-label="回退5秒">−5s</button><button id="listen-play" class="primary" aria-label="播放" aria-keyshortcuts="Space">▶ 播放</button><button id="listen-replay" title="重听刚才5秒，播完暂停（R）" aria-keyshortcuts="R">↶ 重听</button><button id="listen-forward" aria-label="前进5秒">+5s</button></div><audio id="listen-audio" controls preload="metadata" src="${esc(item.audio)}" aria-label="${esc(item.title)}"></audio><div id="listen-clips" class="listen-clips"></div><p id="listen-audio-status" class="minor" role="status" hidden></p>${item.audio_status === 'placeholder' ? '<p class="minor">这条音频是占位音，用来演示播放器。</p>' : ''}</div>` : `<div class="listen-no-audio">本条没有音频，只有文稿。${item.note ? esc(item.note) : ''}</div>`;
  $('listening').innerHTML = `<div class="section-bar"><h2>听力</h2><div class="bar-controls"><select id="listen-item" aria-label="听力条目">${items.map(x => `<option value="${esc(x.id)}">${esc(x.title)}</option>`).join('')}</select><div class="button-pair"><button id="listen-prev" aria-label="上一条">←</button><button id="listen-next" aria-label="下一条">→</button></div><span class="listen-view-icons"><button id="listen-transcript-toggle"></button><button id="listen-translation-toggle"></button></span>${item.questions?.length ? viewButtons() : ''}</div></div>${player}<div class="listen-study-text"><div class="listen-study-title"><h3 lang="ja">${esc(item.title)}</h3></div>${item.intro ? `<p class="listen-context" lang="ja">${esc(item.intro)}</p>` : ''}<div class="listen-transcript">${(item.lines || []).map((l, i) => `<article class="listen-transcript-row" id="line-${esc(item.id)}-${i}"><div class="listen-line-ja"><span class="listen-speaker">${esc(l.speaker || String(i + 1).padStart(2, '0'))}</span><p lang="ja">${rubyHTML(l.text, l.ruby, l.ruby_status)}</p><button class="icon-btn" data-ask-line="${esc(l.text)}" aria-label="问这一句">✧</button></div>${l.translation ? `<p class="listen-study-translation">${esc(l.translation)}</p>` : ''}${l.note ? `<p class="listen-study-analysis">${esc(l.note)}</p>` : ''}</article>`).join('')}</div>${item.questions?.length ? `<h4>题目</h4><div id="listen-questions">${item.questions.map((q, i) => exerciseCard(q, i, exerciseView.answers)).join('')}</div>` : ''}</div>`;
  $('listen-item').value = listeningId;
  $('listen-item').onchange = e => { listeningId = e.target.value; renderListening(); tutorRefresh(); };
  $('listen-prev').disabled = at === 0; $('listen-next').disabled = at === items.length - 1;
  $('listen-prev').onclick = () => { listeningId = items[at - 1].id; renderListening(); tutorRefresh(); };
  $('listen-next').onclick = () => { listeningId = items[at + 1].id; renderListening(); tutorRefresh(); };
  const applyView = () => {
    $('listening').classList.toggle('listen-hide-transcript', !listenView.transcript);
    $('listening').classList.toggle('listen-hide-translation', !listenView.translation);
    studyIcon($('listen-transcript-toggle'), 'transcript', listenView.transcript); studyIcon($('listen-translation-toggle'), 'translation', listenView.translation);
  };
  $('listen-transcript-toggle').onclick = () => { listenView.transcript = !listenView.transcript; applyView(); };
  $('listen-translation-toggle').onclick = () => { listenView.translation = !listenView.translation; applyView(); };
  applyView();
  $('listening').querySelectorAll('[data-ask-line]').forEach(b => b.onclick = () => openTutor({section: 'listening', itemId: item.id, selection: b.dataset.askLine, prompt: '请解析这一句的意思、句子结构和容易听错的地方。'}));
  if (item.questions?.length) bindExerciseCards($('listening'), item.questions, 'listening');
  if (item.audio) installPlayer(item);
}
function installPlayer(item) {
  const a = $('listen-audio'), owner = learner, key = `${course}:${item.id}`;
  let loopA = null, loopB = null, replayEnd = null, replayStart = null;
  // Audio events can arrive after the learner has switched lesson or panel; a detached player stays silent.
  const status = t => { const el = $('listen-audio-status'); if (!a.isConnected || !el) return; el.hidden = !t; el.textContent = t; };
  const update = () => {
    $('listen-loop-label').textContent = loopA === null ? '' : loopB === null ? 'A ' + clock(loopA) : clock(loopA) + ' – ' + clock(loopB);
    $('listen-loop-save').disabled = loopB === null;
    $('listen-loop-a').setAttribute('aria-pressed', String(loopA !== null)); $('listen-loop-b').setAttribute('aria-pressed', String(loopB !== null));
  };
  const clips = () => {
    const saved = audioRecord(owner, key).clips;
    const list = Array.isArray(saved) ? saved.filter(c => c && Number.isFinite(c.start) && Number.isFinite(c.end) && c.start >= 0 && c.end > c.start).slice(0, 20) : [];
    $('listen-clips').innerHTML = list.map((c, i) => `<span class="listen-clip"><button data-clip="${i}" title="循环播放这个片段">▶ ${clock(c.start)}–${clock(c.end)}</button><button data-remove-clip="${i}" aria-label="删除片段">×</button></span>`).join('');
    $('listen-clips').querySelectorAll('[data-clip]').forEach(b => b.onclick = () => { const c = list[Number(b.dataset.clip)]; if (!Number.isFinite(a.duration) || c.end > a.duration) return; replayEnd = replayStart = null; loopA = c.start; loopB = c.end; a.currentTime = loopA; update(); a.play().catch(() => status('点播放即可重听。')); });
    $('listen-clips').querySelectorAll('[data-remove-clip]').forEach(b => b.onclick = () => { list.splice(Number(b.dataset.removeClip), 1); saveAudioState(owner, key, {clips: list}); clips(); });
  };
  const savePosition = () => { if (Number.isFinite(a.currentTime) && Number.isFinite(a.duration)) { saveAudioState(owner, key, {time: a.currentTime >= a.duration - .5 ? 0 : a.currentTime}); saveAudioState(owner, 'settings', {speed: a.playbackRate}); } };
  const playLabel = () => { if (!a.isConnected || !$('listen-play')) return; $('listen-play').textContent = a.paused ? '▶ 继续' : 'Ⅱ 暂停'; $('listen-play').setAttribute('aria-label', a.paused ? '继续播放' : '暂停'); };
  const play = () => a.play().then(() => status('')).catch(e => { if (e.name !== 'AbortError') status('请再点播放继续。'); });
  const seek = delta => { if (!Number.isFinite(a.duration)) return; replayEnd = replayStart = null; a.currentTime = Math.min(loopB ?? a.duration, Math.max(loopA ?? 0, a.currentTime + delta)); };
  a.playbackRate = SPEEDS.includes(audioRecord(owner, 'settings').speed) ? audioRecord(owner, 'settings').speed : 1;
  a.onloadedmetadata = () => { const t = Number.isFinite(audioRecord(owner, key).time) ? Math.max(0, audioRecord(owner, key).time) : 0; if (t < a.duration - 1) a.currentTime = t; status(t > 1 ? '续听 ' + clock(t) : ''); };
  $('listen-play').onclick = () => { if (!a.paused) { a.pause(); return; } replayEnd = replayStart = null; play(); };
  $('listen-back').onclick = () => seek(-5); $('listen-forward').onclick = () => seek(5);
  $('listen-replay').onclick = () => { if (!Number.isFinite(a.duration)) return; if (loopB !== null) { a.currentTime = loopA; play(); return; } if (replayEnd === null) { replayEnd = a.currentTime; replayStart = Math.max(0, replayEnd - 5); } if (replayEnd <= replayStart) { replayEnd = replayStart = null; return; } a.currentTime = replayStart; play(); };
  a.onplay = playLabel; a.onpause = () => { savePosition(); playLabel(); };
  a.ontimeupdate = () => { savePosition(); if (replayEnd !== null && !a.paused && a.currentTime >= replayEnd) { a.pause(); a.currentTime = replayEnd; } else if (loopB !== null && a.currentTime >= loopB) a.currentTime = loopA; };
  a.onended = () => { if (loopA !== null && loopB !== null) { a.currentTime = loopA; a.play().catch(() => status('请点播放继续循环。')); } };
  a.onerror = () => status('音频未能载入，请检查课程包里的媒体文件。');
  $('listen-speed').onchange = e => { a.playbackRate = Number(e.target.value); savePosition(); };
  $('listen-loop-a').onclick = () => { replayEnd = replayStart = null; if (!Number.isFinite(a.duration)) { status('音频载入后即可设置循环。'); return; } loopA = a.currentTime; loopB = null; status(''); update(); };
  $('listen-loop-b').onclick = () => { if (loopA === null) { status('先在想重复的片段开头点 A，再在结尾点 B。'); return; } if (a.currentTime <= loopA + .3) { status('B 点要晚于 A 点。'); return; } loopB = a.currentTime; a.currentTime = loopA; status(''); update(); a.play().catch(() => status('循环已设好，点播放即可。')); };
  $('listen-loop-clear').onclick = () => { replayEnd = replayStart = null; loopA = loopB = null; status(''); update(); };
  $('listen-loop-save').onclick = () => { if (loopA === null || loopB === null) return; const list = Array.isArray(audioRecord(owner, key).clips) ? [...audioRecord(owner, key).clips] : []; if (!list.some(c => Math.abs(c.start - loopA) < .2 && Math.abs(c.end - loopB) < .2)) { if (list.length >= 20) { status('每条录音最多保存 20 个片段。'); return; } list.push({start: loopA, end: loopB}); saveAudioState(owner, key, {clips: list}); clips(); } status('片段已保存'); };
  update(); clips();
}
document.addEventListener('keydown', e => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || $('listening').hidden || !$('listen-audio') || document.querySelector('dialog[open]') || !$('tutor-dialog').hidden || document.body.classList.contains('drawer-open')) return;
  if (e.target.closest('input,textarea,select,button,a,summary,audio,[contenteditable],[role="separator"]')) return;
  const id = e.code === 'Space' ? 'listen-play' : e.key.toLowerCase() === 'r' ? 'listen-replay' : e.key === 'ArrowLeft' ? 'listen-back' : e.key === 'ArrowRight' ? 'listen-forward' : null;
  if (id) { e.preventDefault(); $(id)?.click(); }
});

// ------------------------------------------------------------------ notes panel & export

function noteEntries(lesson = L) {
  const all = notesFor(lesson.id)[learner] || {}, out = [];
  for (const e of lesson.vocabulary || []) { const r = all['v:' + e.id]; if (r && (r.text || r.done)) out.push({label: `${e.word}（${e.reading || ''}）`, text: r.text || '', done: r.done === true}); }
  const items = [...(lesson.exercises || []).flatMap(g => g.items), ...(lesson.listening || []).flatMap(x => x.questions || [])];
  for (const q of items) { const r = all['x:' + q.id]; if (r && r.text) out.push({label: q.question, text: r.text}); }
  return out;
}
function renderNotes() {
  const entries = noteEntries();
  $('notes').innerHTML = `<div class="section-bar"><h2>我的笔记</h2><div class="bar-controls"><span class="minor">${esc(learner)} · ${esc(L.title)}</span></div></div>${entries.length ? `<div class="note-grid">${entries.map(n => `<article class="note-card"><h3 lang="ja">${esc(n.label)}</h3>${n.text ? `<p lang="ja">${esc(n.text)}</p>` : ''}${n.done ? '<p class="minor">✓ 自认能解释</p>' : ''}</article>`).join('')}</div>` : '<p class="empty-panel">这一课还没有笔记。词条卡和练习卡里的“我的笔记／我的作答”会汇总到这里。</p>'}`;
}
$('export').onclick = () => {
  const date = new Date().toLocaleDateString('sv-SE');
  let md = `---\nlearner: ${learner}\npack: ${PACK.title || PACK_ID}\nlesson: ${L.title}\nexported: ${date}\n---\n\n# ${learner} · ${L.title} · 笔记\n\n以下是本人填写的内容；参考答案未代填。\n\n`;
  for (const e of L.vocabulary || []) { const r = record('v:' + e.id); md += `## ${e.word}（${e.reading || ''}）\n\n${(r.text || '（尚未填写）').replace(/\r\n/g, '\n')}\n\n- [${r.done ? 'x' : ' '}] 自认能不看参考解释\n\n`; }
  for (const q of [...(L.exercises || []).flatMap(g => g.items), ...(L.listening || []).flatMap(x => x.questions || [])]) { const r = record('x:' + q.id); if (r.text) md += `## ${q.question}\n\n${r.text.replace(/\r\n/g, '\n')}\n\n`; }
  const url = URL.createObjectURL(new Blob([md], {type: 'text/markdown;charset=utf-8'})), a = document.createElement('a');
  a.href = url; a.download = `${date}_${learner}_${L.title}_笔记.md`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('已导出笔记。');
};
$('print').onclick = () => window.print();

// The header menu closes after an action, on Escape, and on a click elsewhere.
const moreMenu = document.querySelector('.header-more');
const closeMoreMenu = () => { if (moreMenu) moreMenu.open = false; };
document.querySelectorAll('.more-menu > button').forEach(b => b.addEventListener('click', closeMoreMenu));
document.addEventListener('click', e => { if (moreMenu?.open && !moreMenu.contains(e.target)) closeMoreMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && moreMenu?.open) { closeMoreMenu(); moreMenu.querySelector('summary').focus(); } });

// ------------------------------------------------------------------ tabs & lessons

function showTab(name) {
  saveStudyPosition(); document.body.dataset.panel = name;
  if (name !== 'listening') document.querySelector('#listening audio')?.pause();
  closeDetail(false);
  document.querySelectorAll('[role=tabpanel]').forEach(x => x.hidden = x.id !== name);
  document.querySelectorAll('[data-tab]').forEach(x => { x.setAttribute('aria-selected', String(x.dataset.tab === name)); x.tabIndex = x.dataset.tab === name ? 0 : -1; });
  if (name === 'exercises') renderExercises(); if (name === 'words') renderWords(); if (name === 'read') renderDetail(); if (name === 'notes') renderNotes();
  if (name === 'listening') renderListening();
  updateProgress(); window.scrollTo({top: 0, behavior: 'auto'}); tutorRefresh();
}
document.querySelectorAll('[data-tab]').forEach((b, i, arr) => {
  b.onclick = () => showTab(b.dataset.tab);
  b.onkeydown = e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const j = e.key === 'Home' ? 0 : e.key === 'End' ? arr.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + arr.length) % arr.length; showTab(arr[j].dataset.tab); arr[j].focus(); } };
});
function renderAll() { renderPassage(); renderDetail(); renderWords(); renderGrammars(); renderExercises(); renderListening(); renderNotes(); updateProgress(); }
function switchCourse(id) {
  saveStudyPosition();
  L = LESSONS.find(l => l.id === String(id)) || LESSONS[0]; course = L.id;
  selected = null; lastAnchor = null; exerciseGroup = null; listeningId = null; $('search').value = ''; $('course').value = course;
  const index = LESSONS.indexOf(L);
  $('course-heading').textContent = `／ ${L.number ? '第' + L.number + '课' : L.title}`; $('course-subtitle').textContent = [L.title, L.theme].filter(Boolean).join(' · ');
  $('course-status').textContent = L.status || PACK.description || '';
  $('passage-heading').innerHTML = rubyHTML(L.title, L.title_ruby); $('passage-source').textContent = L.source || '';
  $('passage-note').textContent = (L.paragraphs || []).some(p => (p.translation || {}).status === 'machine' || p.ruby_status === 'unverified') ? '本课部分译文或注音尚未经人核对，带标记的地方请留意。' : '原文与译文、讲解分开呈现。可以关掉高亮先读，再找词句核对。';
  $('tab-words').textContent = `词汇 · ${vocab().length}`; $('tab-grammar').textContent = `语法 · ${grammar().length}`;
  $('tab-listening').textContent = `听力${(L.listening || []).length ? ' · ' + L.listening.length : ''}`;
  $('prev-course').disabled = index === 0; $('next-course').disabled = index === LESSONS.length - 1;
  $('course-position').textContent = `${index + 1} / ${LESSONS.length}`; $('course').title = $('course').selectedOptions[0]?.textContent || '';
  document.title = `${L.title} · Bunmyaku`;
  renderAll(); showTab('read');
  $('save-status').textContent = storageOK ? '本机独立保存' : '请导出备份';
}
$('course').innerHTML = LESSONS.map(l => `<option value="${esc(l.id)}">${l.number ? '第' + esc(l.number) + '课 · ' : ''}${esc(l.title)}</option>`).join('');
$('course').onchange = e => switchCourse(e.target.value);
$('prev-course').onclick = () => { const i = LESSONS.indexOf(L); if (i > 0) switchCourse(LESSONS[i - 1].id); };
$('next-course').onclick = () => { const i = LESSONS.indexOf(L); if (i < LESSONS.length - 1) switchCourse(LESSONS[i + 1].id); };
$('pack-title').textContent = PACK.title || PACK_ID; $('pack-license').textContent = PACK.license ? `内容授权 ${PACK.license}` : '';

// ------------------------------------------------------------------ tutor

function tutorMarkdown(source) {
  const template = document.createElement('template'); template.innerHTML = marked.parse(String(source), {gfm: true, breaks: true});
  const allowed = new Set('P BR STRONG EM DEL UL OL LI BLOCKQUOTE PRE CODE H1 H2 H3 H4 H5 H6 HR TABLE THEAD TBODY TR TH TD A RUBY RT RP'.split(' '));
  const clean = node => {
    for (const el of [...node.children]) {
      if (!allowed.has(el.tagName)) { el.replaceWith(document.createTextNode(el.outerHTML)); continue; }
      const href = el.tagName === 'A' ? el.getAttribute('href') : null;
      for (const a of [...el.attributes]) el.removeAttribute(a.name);
      if (href) { try { const url = new URL(href); if (['https:', 'http:', 'mailto:'].includes(url.protocol)) { el.setAttribute('href', url.href); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); } } catch {} }
      clean(el);
    }
  };
  clean(template.content);
  for (const table of [...template.content.querySelectorAll('table')]) { const wrap = document.createElement('div'); wrap.className = 'md-table'; table.replaceWith(wrap); wrap.append(table); }
  return template.innerHTML;
}
let tutorPreferredWidth = Math.max(280, Number(store.get(K.tutorWidth, 420)) || 420);
function setTutorWidth(value, persist = false) {
  const max = Math.min(820, innerWidth), min = Math.min(320, max), width = Math.round(Math.max(min, Math.min(max, value)));
  document.documentElement.style.setProperty('--tutor-width', width + 'px');
  const h = $('tutor-resize'); h.setAttribute('aria-valuemin', min); h.setAttribute('aria-valuemax', max); h.setAttribute('aria-valuenow', width); h.setAttribute('aria-valuetext', width + ' 像素');
  if (persist) { tutorPreferredWidth = width; store.set(K.tutorWidth, width); }
}
setTutorWidth(tutorPreferredWidth); window.addEventListener('resize', () => setTutorWidth(tutorPreferredWidth));
const handle = $('tutor-resize');
handle.onpointerdown = e => { if (e.button !== 0) return; e.preventDefault(); handle.setPointerCapture(e.pointerId); document.body.classList.add('tutor-resizing'); };
handle.onpointermove = e => { if (handle.hasPointerCapture(e.pointerId)) setTutorWidth(innerWidth - e.clientX, true); };
const finishResize = () => document.body.classList.remove('tutor-resizing');
handle.onpointerup = e => { if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId); finishResize(); };
handle.onpointercancel = finishResize; handle.onlostpointercapture = finishResize; handle.ondblclick = () => setTutorWidth(420, true);
handle.onkeydown = e => { const width = Number(handle.getAttribute('aria-valuenow')); if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); setTutorWidth(e.key === 'Home' ? 320 : e.key === 'End' ? 820 : width + (e.key === 'ArrowLeft' ? 24 : -24), true); } };

const tutorChats = {};
let tutorSection = 'read', tutorItem = '', tutorSelection = '', tutorBusy = false, tutorController = null, tutorToken = '', tutorConfigured = null;
function chatKey() { return `${learner}:${course}:${tutorSection}`; }
function chat() { return tutorChats[chatKey()] || (tutorChats[chatKey()] = []); }
function currentSection() { return !$('listening').hidden ? 'listening' : 'read'; }
function tutorRefresh() { if (tutorBusy) return; tutorSection = currentSection(); tutorItem = tutorSection === 'listening' ? (listeningId || '') : ''; tutorSelection = ''; if (!$('tutor-dialog').hidden) tutorRender(); }
function tutorItemLabel() {
  for (const g of L.exercises || []) { const i = g.items.findIndex(e => e.id === tutorItem); if (i >= 0) return `${g.title} · 第 ${i + 1} 题`; }
  for (const x of L.listening || []) { if (x.id === tutorItem) return `听力 · ${x.title}`; const i = (x.questions || []).findIndex(q => q.id === tutorItem); if (i >= 0) return `${x.title} · 题 ${i + 1}`; }
  return '';
}
function tutorRender() {
  $('tutor-selection').hidden = !tutorSelection; $('selection-text').textContent = tutorSelection;
  const prompts = tutorSelection ? ['用简单日语解释选中的内容', '拆开这句话，讲讲语法和连接', '给两个类似例句，并标注假名']
    : tutorItem && tutorSection !== 'listening' ? ['给这道题一点提示', '解释这道题为什么这样答', '出一道同类型的题让我练习']
    : tutorSection === 'listening' ? ['帮我解释这段对话里的敬语', '这段对话里哪句最容易听错？', '用同一场景出一道听力题']
    : !$('grammar').hidden ? ['用简单例句比较本课语法', '用本课语法出一道生活情境题']
    : !$('words').hidden ? ['选三个本课词，用简单日语解释', '本课有哪些容易混淆的词？']
    : ['用简单日语概括本课内容', '问我一个关于课文的问题', '挑一句长句，带我拆开理解'];
  $('tutor-suggestions').innerHTML = prompts.map(q => `<button type="button" class="suggestion">${esc(q)} <span aria-hidden="true">↗</span></button>`).join('');
  $('tutor-suggestions').querySelectorAll('button').forEach(b => b.onclick = () => { $('tutor-question').value = b.textContent.replace(/ ↗$/, ''); $('tutor-question').focus(); });
  $('tutor-context').textContent = `${L.title}${tutorSection === 'listening' ? ' · 听力' : ''} · ${learner}${tutorItem && tutorItemLabel() ? ' · ' + tutorItemLabel() : ''}${tutorSelection ? ' · 已附选中文字' : ''}`;
  $('tutor-messages').innerHTML = chat().map(m => `<div class="chat-message ${m.role}"><strong class="chat-author">${m.role === 'user' ? '我' : '老师'}</strong><div class="chat-content">${m.role === 'assistant' ? tutorMarkdown(m.content) : esc(m.content).replace(/\n/g, '<br>')}</div></div>`).join('');
  $('tutor-send').disabled = tutorBusy || STATIC_DEMO; $('tutor-cancel').hidden = !tutorBusy;
  const copyMode = tutorConfigured === false;
  $('tutor-dialog').classList.toggle('copy-mode', copyMode); $('tutor-copy').hidden = !copyMode;
}
async function tutorStatus() {
  if (STATIC_DEMO) { tutorConfigured = null; $('tutor-status').textContent = '这是在线演示页，没有本机服务，答疑不可用。把仓库下载到本机运行 python3 -m bunmyaku 即可提问。'; tutorRender(); return; }
  try {
    const r = await fetch('/api/status', {cache: 'no-store'}); if (!r.ok) throw Error();
    const a = await r.json(); tutorToken = a.token; tutorConfigured = a.configured === true;
    $('tutor-status').textContent = a.configured ? `已连接 · ${a.preset === 'custom' ? '自定义端点' : a.preset} · ${a.model} · 首次发送时验证` : '尚未配置答疑接口：运行 python3 configure_ai.py，或直接用“复制提示词”贴到任何聊天工具。';
  } catch { tutorConfigured = null; $('tutor-status').textContent = '无法连接本机服务，请确认 serve.py 正在运行。'; }
  tutorRender();
}
function selectedStudyText() {
  const sel = window.getSelection(); if (!sel || sel.isCollapsed) return '';
  const node = sel.anchorNode?.parentElement; if (!node?.closest('main')) return '';
  const fragment = sel.getRangeAt(0).cloneContents(); fragment.querySelectorAll('rt').forEach(x => x.remove());
  return fragment.textContent.trim().slice(0, 2000);
}
document.addEventListener('selectionchange', () => { clearTimeout(window.selectionTimer); window.selectionTimer = setTimeout(() => { const text = selectedStudyText(); if (!text || tutorBusy) return; tutorSelection = text; tutorItem = tutorSection === 'listening' ? (listeningId || '') : ''; tutorSection = currentSection(); if (!$('tutor-dialog').hidden) tutorRender(); }, 150); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('tutor-dialog').hidden && !document.querySelector('dialog[open]')) $('tutor-close').click(); });
function openTutor(options = {}) {
  if (tutorBusy && options.itemId) { notify('请先等当前回答结束，或取消当前请求。'); return; }
  tutorSection = options.section || currentSection();
  const selection = selectedStudyText();
  tutorItem = options.itemId || (tutorSection === 'listening' ? (listeningId || '') : '');
  tutorSelection = options.selection ?? (options.itemId ? '' : (selection || tutorSelection));
  tutorRender(); $('tutor-dialog').hidden = false; document.body.classList.add('tutor-open'); tutorStatus();
  // Move focus into the panel (it covers the page on phones); touch screens get the close button so no keyboard pops up.
  (matchMedia('(pointer:coarse)').matches ? $('tutor-close') : $('tutor-question')).focus({preventScroll: true});
  if (options.prompt) $('tutor-question').value = options.prompt;
}
$('tutor-open').onclick = () => openTutor();
$('tutor-close').onclick = () => { const inside = $('tutor-dialog').contains(document.activeElement); $('tutor-dialog').hidden = true; document.body.classList.remove('tutor-open'); if (inside) $('tutor-open').focus(); };
$('tutor-recheck').onclick = tutorStatus;
$('selection-clear').onclick = () => { tutorSelection = ''; tutorRender(); };
$('tutor-clear').onclick = () => { if (tutorBusy) return; delete tutorChats[chatKey()]; tutorItem = ''; tutorSelection = ''; tutorRender(); };
$('tutor-cancel').onclick = () => tutorController?.abort();
function requestBody(question) {
  return {lesson: course, section: tutorSection, itemId: tutorItem, question, history: chat().slice(-8), mode: $('tutor-mode').value, selection: tutorSelection};
}
$('tutor-copy').onclick = async () => {
  const question = $('tutor-question').value.trim(); if (!question || tutorBusy) { notify('先写下你的问题。'); return; }
  try {
    if (!tutorToken) await tutorStatus();
    const response = await fetch('/api/prompt', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Study-Token': tutorToken}, body: JSON.stringify(requestBody(question))});
    const result = await response.json(); if (!response.ok) throw Error(result.error || '请求失败');
    await navigator.clipboard.writeText(result.prompt);
    $('tutor-result').textContent = '提示词已复制，可贴到任何聊天工具；回答不会自动回到这里。';
  } catch (err) { $('tutor-result').textContent = err.message; }
};
$('tutor-form').onsubmit = async e => {
  e.preventDefault();
  if (STATIC_DEMO) return;
  if (tutorConfigured === false) { $('tutor-copy').click(); return; }
  const question = $('tutor-question').value.trim(); if (!question || tutorBusy) return;
  const key = chatKey(), messages = chat(), body = requestBody(question);
  messages.push({role: 'user', content: question});
  tutorBusy = true; tutorController = new AbortController(); $('tutor-question').value = ''; tutorRender(); $('tutor-result').textContent = '正在思考…';
  const timer = setTimeout(() => tutorController.abort(), 100000);
  try {
    if (!tutorToken) await tutorStatus();
    const response = await fetch('/api/chat', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Study-Token': tutorToken}, body: JSON.stringify(body), signal: tutorController.signal});
    const result = await response.json(); if (!response.ok) throw Error(result.error || '请求失败');
    messages.push({role: 'assistant', content: result.answer}); $('tutor-result').textContent = '';
  } catch (err) {
    $('tutor-result').textContent = err.name === 'AbortError' ? '已取消或等待超时；服务端已经发出的请求仍可能产生费用。' : err.message;
    $('tutor-question').value = question; messages.pop();
  } finally { clearTimeout(timer); tutorBusy = false; tutorController = null; if (chatKey() === key) tutorRender(); }
};

// ------------------------------------------------------------------ boot

document.addEventListener('click', e => { document.querySelectorAll('.context-info[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; }); });
renderLearnerSelect();
switchCourse(LESSONS[0].id);
restoreStudyPosition();
// Deep links: #lesson=02&panel=listening (also used for screenshots). They win over the saved position.
(function applyHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (!params.size) return;
  restoringStudy = true;
  try {
    const lesson = params.get('lesson'), panel = params.get('panel');
    if (lesson && LESSONS.some(l => l.id === lesson)) switchCourse(lesson);
    if (panel && ['read', 'words', 'grammar', 'exercises', 'listening', 'notes'].includes(panel)) showTab(panel);
    if (params.get('word') && vocab().some(e => e.id === params.get('word'))) { showTab('read'); selectEntry(params.get('word')); }
    if (params.get('answers') === '1') { exerciseView.answers = true; if (panel === 'exercises') renderExercises(); if (panel === 'listening') renderListening(); }
    if (params.has('tutor')) openTutor({selection: params.get('tutor') || ''});
  } finally { restoringStudy = false; }
})();
studyReady = true;
setInterval(saveStudyPosition, 1500);
