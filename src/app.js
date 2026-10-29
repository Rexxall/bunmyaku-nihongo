'use strict';
/* Bunmyaku study page. Everything on this page is driven by the course pack injected as #pack-data.
   Browser storage holds only learner records (notes, positions, audio progress), keyed by pack id,
   lesson id and learner profile, plus web clips per profile. No network calls except /api/* on the same origin. */

const PACK = JSON.parse(document.getElementById('pack-data').textContent);
const PACK_ID = String(PACK.id || 'pack');
const LESSONS = PACK.lessons.map(l => ({...l, id: String(l.id)}));
// Set by tools/export_static.py: the page is served as plain files, without /api.
const STATIC_DEMO = document.documentElement.dataset.static === '1';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
// Language of the pack's explanations (translations, meanings), so screen readers read them right whatever the interface language.
const TL = ({zh: 'zh-CN'})[PACK.translation_language] || PACK.translation_language || 'zh-CN';
applyStaticText();
const PANELS = ['read', 'words', 'grammar', 'exercises', 'listening', 'notes', 'clips'];
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
  profiles: 'bunmyaku:profiles', learner: 'bunmyaku:learner', ruby: 'bunmyaku:ruby', look: 'bunmyaku:look', tutorWidth: 'bunmyaku:tutor-width',
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
// The default profile keeps its stored name '我' in every language so notes survive a language switch; only the label changes.
const who = name => name === '我' ? t('profile.default') : name;
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
  $('save-status').textContent = storageOK ? t('save.saved') : t('save.failed');
  updateProgress();
}
function updateProgress() {
  const words = L.vocabulary || [];
  const written = words.filter(e => record('v:' + e.id).text.trim()).length, done = words.filter(e => record('v:' + e.id).done).length;
  $('note-progress').textContent = t('progress', {name: who(learner), written, done, total: words.length});
  $('print-name').textContent = `${who(learner)} · ${L.title}`;
}
function notify(msg) {
  $('toast').textContent = msg; $('toast').hidden = false;
  clearTimeout(notify.timer); notify.timer = setTimeout(() => { $('toast').hidden = true; }, 3200);
}

function renderLearnerSelect() {
  $('learner').innerHTML = profiles.map(p => `<option value="${esc(p)}">${esc(who(p))}</option>`).join('');
  $('learner').value = learner;
  $('learner-control').hidden = profiles.length < 2;
}
$('learner').onchange = e => {
  saveStudyPosition();
  document.querySelector('#listening audio')?.pause();
  learner = e.target.value; store.set(K.learner, learner);
  renderAll(); $('save-status').textContent = t('save.switched', {name: who(learner)});
  if (!$('tutor-dialog').hidden) tutorRender();
  if (profile().position) restoreStudyPosition();
};
$('profiles-edit').onclick = () => { $('profiles-text').value = profiles.join('\n'); $('profiles-dialog').showModal(); };
$('profiles-close').onclick = () => $('profiles-dialog').close();
$('profiles-reset').onclick = () => { $('profiles-text').value = packProfiles().join('\n'); };
$('profiles-save').onclick = e => {
  e.preventDefault();
  const list = [...new Set($('profiles-text').value.split('\n').map(x => x.trim()).filter(Boolean))].slice(0, 8);
  if (!list.length) { notify(t('profiles.keepOne')); return; }
  profiles = list; store.set(K.profiles, profiles);
  if (!profiles.includes(learner)) { learner = profiles[0]; store.set(K.learner, learner); }
  renderLearnerSelect(); renderAll(); $('profiles-dialog').close(); notify(t('profiles.updated'));
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
    if (PANELS.includes(p.panel)) showTab(p.panel);
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
  return `<span class="status-chip ${esc(status)}">${status === 'machine' ? t('status.machine') : t('status.unverified')}</span>`;
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
      if (range) { openGrammar = range; out += `<span class="grammar" tabindex="-1" data-grammar="${esc(range.id)}" title="${esc(t('grammar.underline', {name: range.g.name}))}">`; }
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
    const sentences = Array.isArray(p.sentences) && p.sentences.length ? `<details class="sentence-toggle"><summary>${t('read.sentences', {n: p.sentences.length})}</summary><ol class="sentence-list">${p.sentences.map(s => `<li class="sentence-card"><p class="sentence-ja" lang="ja">${rubyHTML(s.text, s.ruby, s.ruby_status)}</p><p lang="${TL}">${esc(s.translation || '')}</p>${s.structure ? `<h4>${t('read.structure')}</h4><p lang="${TL}">${esc(s.structure)}</p>` : ''}${s.usage ? `<h4>${t('read.usage')}</h4><p lang="${TL}">${esc(s.usage)}</p>` : ''}${s.example ? `<div class="sentence-example"><p lang="ja">${rubyHTML(s.example, s.example_ruby)}</p><p lang="${TL}">${esc(s.example_translation || '')}</p></div>` : ''}<button type="button" class="ask-sentence" data-ask-sentence="${esc(s.text)}">${t('read.askSentence')}</button></li>`).join('')}</ol></details>` : '';
    return `<div class="p-label">${t('read.paragraph', {n: i + 1})} ${statusChip(p.ruby_status)}</div><p>${annotateParagraph(p)}</p><div class="grammar-actions">${grammarButtons}</div>${tr.text ? `<details class="paragraph-translation"><summary><span class="classic-only">${t('read.paragraphTranslation')}</span><span class="glass-only">${t('read.paragraphTranslationShort')}</span> ${statusChip(tr.status)}</summary><div lang="${TL}">${esc(tr.text)}</div></details>` : ''}${sentences}`;
  }).join('');
  document.querySelectorAll('[data-gview]').forEach(b => b.onclick = () => selectGrammar(b.dataset.gview, b));
  document.querySelectorAll('[data-ask-sentence]').forEach(b => b.onclick = () => { openTutor(); tutorSelection = b.dataset.askSentence; tutorRender(); $('tutor-question').value = t('read.askSentencePrompt'); });
}
$('passage').addEventListener('click', ev => {
  const w = ev.target.closest('[data-ids]'), g = ev.target.closest('[data-grammar]');
  if (w) selectEntry(w.dataset.ids.split(',')[0], w); else if (g) selectGrammar(g.dataset.grammar, g);
});
// Grammar underlines are mouse targets only (words inside them are buttons); keyboard users open grammar from the buttons under each paragraph.
function simpleBlock(e) {
  return e.simple ? `<p class="field-label">${t('detail.simple')}</p><div class="jp" lang="ja">${esc(e.simple)}</div>` : '';
}
function meaningText(e) {
  const m = e.meaning || {}; if (typeof m === 'string') return esc(m);
  // The interface language first when the pack has it, then the pack's own explanation language.
  const order = [...new Set([UI_LANG, PACK.translation_language, ...Object.keys(m)])].filter(k => m[k]);
  const span = k => `<span lang="${UI_HTML_LANG[k] || k}">${esc(m[k])}</span>`;
  return order.length ? span(order[0]) + (order.length > 1 ? ` <small>· ${order.slice(1).map(span).join(' · ')}</small>` : '') : '';
}
function selectEntry(id, anchor) {
  selected = id; lastAnchor = anchor || lastAnchor;
  document.querySelectorAll('.word').forEach(x => x.classList.toggle('selected', x.dataset.ids.split(',').includes(String(id))));
  renderDetail(); openDetail();
}
function renderDetail() {
  const e = vocab().find(x => x.id === selected) || vocab()[0];
  if (!e) { $('detail').innerHTML = `<p class="minor">${t('detail.empty')}</p>`; return; }
  selected = e.id;
  const r = record('v:' + e.id), forms = (e.forms || []).filter(f => (L.paragraphs || []).some(p => p.text.includes(f)));
  $('detail').innerHTML = `<small>${t('detail.entry', {n: vocab().indexOf(e) + 1, total: vocab().length})} ${statusChip(e.reading_status === 'verified' ? '' : e.reading_status)}</small><h3 lang="ja">${sourceReading(e.word, e.reading)}</h3><p class="kana" lang="ja">${esc(e.reading || '')}</p><p>${meaningText(e)}</p>${simpleBlock(e)}${forms.length ? `<p class="field-label">${t('detail.forms')}</p><p lang="ja">${forms.map(esc).join(' ／ ')}</p>` : ''}${e.similar ? `<p class="field-label">${t('detail.similar')}</p><p lang="${TL}">${esc(e.similar)}</p>` : ''}${e.memo ? `<details><summary>${t('detail.memo')}</summary><p lang="${TL}">${esc(e.memo)}</p></details>` : ''}<details class="notes"><summary>${t('detail.myNotes')}</summary><label class="field-label" for="detail-answer">${esc(t('detail.ownWords', {name: who(learner)}))}</label><textarea id="detail-answer" lang="ja" placeholder="${esc(t('detail.ownWordsPlaceholder'))}">${esc(r.text)}</textarea><label class="checks"><input id="detail-done" type="checkbox" ${r.done ? 'checked' : ''}>${t('detail.canExplain')}</label></details><button class="top-return" id="return-text">${t('detail.back')}</button>`;
  $('detail-answer').oninput = ev => save('v:' + e.id, {text: ev.target.value});
  $('detail-done').onchange = ev => save('v:' + e.id, {done: ev.target.checked});
  $('return-text').onclick = () => { closeDetail(); if (lastAnchor) { lastAnchor.scrollIntoView({block: 'center'}); lastAnchor.focus(); } else $('passage').scrollIntoView(); };
}
function grammarCard(g) {
  return `<h3 lang="ja">${esc(g.name)}</h3>${g.phrase ? `<blockquote lang="ja">${rubyHTML(g.phrase, g.phrase_ruby)}</blockquote>` : `<p class="hint">${t('grammar.notInText')}</p>`}<dl>${g.meaning ? `<dt>${t('grammar.meaning')}</dt><dd lang="${TL}">${esc(g.meaning)}</dd>` : ''}${g.connection ? `<dt>${t('grammar.connection')}</dt><dd lang="ja">${esc(g.connection)}</dd>` : ''}${g.example ? `<dt>${t('grammar.example')}</dt><dd lang="ja">${rubyHTML(g.example, g.example_ruby)}${g.example_translation ? `<br><span class="minor" lang="${TL}">${esc(g.example_translation)}</span>` : ''}</dd>` : ''}${g.trap ? `<dt>${t('grammar.trap')}</dt><dd lang="${TL}">${esc(g.trap)}</dd>` : ''}</dl>`;
}
function selectGrammar(id, anchor) {
  const g = grammar().find(x => x.id === id); if (!g) return;
  lastAnchor = anchor || lastAnchor;
  $('detail').innerHTML = grammarCard(g) + `<button id="back-to-passage">${t('detail.backShort')}</button>`;
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
  $('detail-shell').setAttribute('role', 'dialog'); $('detail-shell').setAttribute('aria-modal', 'true'); $('detail-shell').setAttribute('aria-label', t('detail.label'));
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
  $('translation-title').textContent = t('translation.title', {title: L.title});
  const parallel = $('parallel').checked;
  $('translation-content').innerHTML = (L.paragraphs || []).map((p, i) => `<section class="translation-row ${parallel ? '' : 'zh-only'}">${parallel ? `<div><span class="tag">${t('translation.original', {n: i + 1})}</span><p class="original" lang="ja">${rubyHTML(p.text, p.ruby, p.ruby_status)}</p></div>` : ''}<div><span class="tag">${t('translation.translated', {n: i + 1})} ${statusChip((p.translation || {}).status)}</span><p lang="${(p.translation || {}).text ? TL : document.documentElement.lang}">${esc((p.translation || {}).text || t('translation.none'))}</p></div></section>`).join('');
}
$('translation-open').onclick = () => { renderTranslation(); $('translation-dialog').showModal(); };
$('translation-close').onclick = () => $('translation-dialog').close(); $('parallel').onchange = renderTranslation;

// ------------------------------------------------------------------ words & grammar panels

const wordDisclosure = {};
function wordOpen(id) { return wordDisclosure[`${learner}:${course}`]?.[id] !== false; }
function updateDisclosureButton() {
  const all = vocab().every(e => wordOpen(e.id));
  $('hide-refs').textContent = all ? t('words.collapseAll') : t('words.expandAll');
}
function renderWords() {
  const q = $('search').value.trim().toLowerCase();
  const list = vocab().filter(e => [e.word, e.reading, JSON.stringify(e.meaning || ''), e.simple, ...(e.forms || [])].join(' ').toLowerCase().includes(q));
  $('word-grid').innerHTML = list.length ? list.map(e => {
    const r = record('v:' + e.id);
    return `<article class="workcard"><div class="term-heading"><h3 lang="ja"><small>${vocab().indexOf(e) + 1}</small> ${sourceReading(e.word, e.reading)}</h3>${statusChip(e.reading_status === 'verified' ? '' : e.reading_status)}</div>${e.simple ? `<div class="simple-words"><div class="simple-chips" lang="ja"><span>${esc(e.simple)}</span></div></div>` : ''}<details class="word-reference" data-reference="${esc(e.id)}" ${wordOpen(e.id) ? 'open' : ''}><summary>${t('words.reference')}</summary><p class="minor">${meaningText(e)}</p>${e.similar ? `<p lang="${TL}">${esc(e.similar)}</p>` : ''}${e.memo ? `<p class="minor" lang="${TL}">${esc(e.memo)}</p>` : ''}</details><details class="notes"><summary>${t('detail.myNotes')}</summary><label for="answer-${esc(e.id)}">${esc(t('detail.ownWords', {name: who(learner)}))}</label><textarea id="answer-${esc(e.id)}" data-answer="${esc(e.id)}" lang="ja" placeholder="～ことです。／～という意味です。">${esc(r.text)}</textarea><label class="checks"><input type="checkbox" data-done="${esc(e.id)}" ${r.done ? 'checked' : ''}>${t('words.canExplain')}</label></details><button class="locate" data-locate="${esc(e.id)}">${t('words.locate')}</button></article>`;
  }).join('') : `<p class="empty">${t('words.none')}</p>`;
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
  $('grammar-grid').innerHTML = grammar().length ? grammar().map(g => `<article class="grammarcard" id="grammar-${esc(g.id)}">${grammarCard(g)}${g.phrase && (L.paragraphs || []).some(p => p.text.includes(g.phrase)) ? `<button data-grammar-locate="${esc(g.id)}">${t('grammar.locate')}</button>` : ''}</article>`).join('') : `<p class="empty-panel">${t('grammar.empty')}</p>`;
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
  const label = t(on ? 'view.hide' : 'view.show', {name: t('view.' + kind)});
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
  const answer = e.type === 'fill' ? '' : (e.answer || e.reference) ? `<div class="reveal-panel answer-panel" id="answer-${esc(e.id)}" ${open ? '' : 'hidden'}><p class="ex-question" lang="ja">${esc(e.answer || e.reference)}</p>${e.type === 'open' ? `<p class="minor">${t('ex.openNote')}</p>` : ''}</div>` : '';
  const r = record('x:' + e.id);
  return `<article class="exercise-card" data-exercise="${esc(e.id)}"><div class="ex-meta"><span>${t('ex.number', {n: index + 1})} · ${['fill', 'choice', 'transform', 'open'].includes(e.type) ? t('ex.type.' + e.type) : esc(e.type || '')}</span></div><p class="ex-question" id="question-${esc(e.id)}" lang="ja" aria-live="polite">${questionHTML(e, open)}</p>${choices}${e.hint ? `<div class="reveal-panel hint-panel" id="hint-${esc(e.id)}" lang="${TL}" ${exerciseView.hints ? '' : 'hidden'}>${esc(e.hint)}</div>` : ''}${answer}${e.explanation ? `<div class="reveal-panel explain-panel" id="explain-${esc(e.id)}" ${exerciseView.explanations ? '' : 'hidden'}><strong>${t('ex.why')}</strong><p lang="${TL}">${esc(e.explanation)}</p></div>` : ''}<details class="notes"><summary>${t('ex.myAnswer')}</summary><textarea data-exercise-note="${esc(e.id)}" lang="ja" aria-label="${esc(t('ex.myAnswer'))}" placeholder="${esc(t('ex.placeholder'))}">${esc(r.text)}</textarea></details><button class="ask-exercise" aria-label="${esc(t('ex.ask'))}" title="${esc(t('ex.askShort'))}" data-ask-exercise="${esc(e.id)}"><span aria-hidden="true">✧</span></button></article>`;
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
  root.querySelectorAll('[data-ask-exercise]').forEach(b => b.onclick = () => openTutor({section, itemId: b.dataset.askExercise, prompt: t('ex.askPrompt')}));
  root.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { exerciseView[b.dataset.view] = !exerciseView[b.dataset.view]; applyExerciseView(root, items); });
  applyExerciseView(root, items);
}
const viewButtons = () => `<div class="study-visibility" role="group" aria-label="${esc(t('ex.visibility'))}"><button data-view="hints"></button><button data-view="answers"></button><button data-view="explanations"></button></div>`;
function renderExercises() {
  const groups = L.exercises || [];
  if (!groups.length) { $('exercises').innerHTML = `<div class="section-bar"><h2>${t('ex.title')}</h2></div><p class="empty-panel">${t('ex.empty')}</p>`; return; }
  if (!groups.some(g => g.id === exerciseGroup)) exerciseGroup = groups[0].id;
  const at = groups.findIndex(g => g.id === exerciseGroup), g = groups[at];
  $('exercises').innerHTML = `<div class="section-bar exercise-bar"><h2>${t('ex.title')}</h2><div class="bar-controls"><select id="exercise-group" aria-label="${esc(t('ex.group'))}">${groups.map(x => `<option value="${esc(x.id)}">${esc(x.title)}</option>`).join('')}</select><div class="button-pair"><button id="ex-prev" aria-label="${esc(t('ex.prev'))}">←</button><button id="ex-next" aria-label="${esc(t('ex.next'))}">→</button></div>${viewButtons()}</div></div>${g.instruction ? `<p class="hint" lang="${TL}">${esc(g.instruction)}</p>` : ''}<div id="exercise-body">${g.items.map((e, i) => exerciseCard(e, i, exerciseView.answers)).join('')}</div>`;
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
  if (!items.length) { $('listening').innerHTML = `<div class="section-bar"><h2>${t('listen.title')}</h2></div><p class="empty-panel">${t('listen.empty')}</p>`; listeningId = null; return; }
  if (!items.some(x => x.id === listeningId)) listeningId = items[0].id;
  const at = items.findIndex(x => x.id === listeningId), item = items[at];
  const speed = audioRecord(learner, 'settings').speed, rate = SPEEDS.includes(speed) ? speed : 1;
  const player = item.audio ? `<div class="listen-player"><div class="listen-player-top"><select id="listen-speed" aria-label="${esc(t('listen.speed'))}">${SPEEDS.map(v => `<option value="${v}" ${v === rate ? 'selected' : ''}>${v}×</option>`).join('')}</select><button id="listen-loop-a" title="${esc(t('listen.loopA'))}">A</button><button id="listen-loop-b" title="${esc(t('listen.loopB'))}">B</button><button id="listen-loop-clear" class="icon-btn" title="${esc(t('listen.loopClear'))}" aria-label="${esc(t('listen.loopClear'))}">↺</button><button id="listen-loop-save" class="icon-btn" title="${esc(t('listen.loopSave'))}" aria-label="${esc(t('listen.loopSave'))}" disabled>＋</button><span id="listen-loop-label" class="minor" aria-live="polite"></span></div><div class="listen-transport" role="group" aria-label="${esc(t('listen.transport'))}"><button id="listen-back" aria-label="${esc(t('listen.back'))}">−5s</button><button id="listen-play" class="primary" aria-label="${esc(t('listen.playLabel'))}" aria-keyshortcuts="Space">${t('listen.play')}</button><button id="listen-replay" title="${esc(t('listen.replayTitle'))}" aria-keyshortcuts="R">${t('listen.replay')}</button><button id="listen-forward" aria-label="${esc(t('listen.forward'))}">+5s</button></div><audio id="listen-audio" controls preload="metadata" src="${esc(item.audio)}" aria-label="${esc(item.title)}"></audio><div id="listen-clips" class="listen-clips"></div><p id="listen-audio-status" class="minor" role="status" hidden></p>${item.audio_status === 'placeholder' ? `<p class="minor">${t('listen.placeholder')}</p>` : ''}</div>` : `<div class="listen-no-audio">${t('listen.noAudio')}${item.note ? ' ' + esc(item.note) : ''}</div>`;
  $('listening').innerHTML = `<div class="section-bar"><h2>${t('listen.title')}</h2><div class="bar-controls"><select id="listen-item" aria-label="${esc(t('listen.item'))}">${items.map(x => `<option value="${esc(x.id)}">${esc(x.title)}</option>`).join('')}</select><div class="button-pair"><button id="listen-prev" aria-label="${esc(t('listen.prev'))}">←</button><button id="listen-next" aria-label="${esc(t('listen.next'))}">→</button></div><span class="listen-view-icons"><button id="listen-transcript-toggle"></button><button id="listen-translation-toggle"></button></span>${item.questions?.length ? viewButtons() : ''}</div></div>${player}<div class="listen-study-text"><div class="listen-study-title"><h3 lang="ja">${esc(item.title)}</h3></div>${item.intro ? `<p class="listen-context" lang="ja">${esc(item.intro)}</p>` : ''}<div class="listen-transcript">${(item.lines || []).map((l, i) => `<article class="listen-transcript-row" id="line-${esc(item.id)}-${i}"><div class="listen-line-ja"><span class="listen-speaker" lang="ja">${esc(l.speaker || String(i + 1).padStart(2, '0'))}</span><p lang="ja">${rubyHTML(l.text, l.ruby, l.ruby_status)}</p><button class="icon-btn" data-ask-line="${esc(l.text)}" aria-label="${esc(t('listen.askLine'))}">✧</button></div>${l.translation ? `<p class="listen-study-translation" lang="${TL}">${esc(l.translation)}</p>` : ''}${l.note ? `<p class="listen-study-analysis" lang="${TL}">${esc(l.note)}</p>` : ''}</article>`).join('')}</div>${item.questions?.length ? `<h4>${t('listen.questions')}</h4><div id="listen-questions">${item.questions.map((q, i) => exerciseCard(q, i, exerciseView.answers)).join('')}</div>` : ''}</div>`;
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
  $('listening').querySelectorAll('[data-ask-line]').forEach(b => b.onclick = () => openTutor({section: 'listening', itemId: item.id, selection: b.dataset.askLine, prompt: t('listen.askLinePrompt')}));
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
    $('listen-clips').innerHTML = list.map((c, i) => `<span class="listen-clip"><button data-clip="${i}" title="${esc(t('listen.clipPlay'))}">▶ ${clock(c.start)}–${clock(c.end)}</button><button data-remove-clip="${i}" aria-label="${esc(t('listen.clipRemove'))}">×</button></span>`).join('');
    $('listen-clips').querySelectorAll('[data-clip]').forEach(b => b.onclick = () => { const c = list[Number(b.dataset.clip)]; if (!Number.isFinite(a.duration) || c.end > a.duration) return; replayEnd = replayStart = null; loopA = c.start; loopB = c.end; a.currentTime = loopA; update(); a.play().catch(() => status(t('listen.tapToReplay'))); });
    $('listen-clips').querySelectorAll('[data-remove-clip]').forEach(b => b.onclick = () => { list.splice(Number(b.dataset.removeClip), 1); saveAudioState(owner, key, {clips: list}); clips(); });
  };
  const savePosition = () => { if (Number.isFinite(a.currentTime) && Number.isFinite(a.duration)) { saveAudioState(owner, key, {time: a.currentTime >= a.duration - .5 ? 0 : a.currentTime}); saveAudioState(owner, 'settings', {speed: a.playbackRate}); } };
  const playLabel = () => { if (!a.isConnected || !$('listen-play')) return; $('listen-play').textContent = a.paused ? t('listen.resume') : t('listen.pause'); $('listen-play').setAttribute('aria-label', a.paused ? t('listen.resumeLabel') : t('listen.pauseLabel')); };
  const play = () => a.play().then(() => status('')).catch(e => { if (e.name !== 'AbortError') status(t('listen.tapToContinue')); });
  const seek = delta => { if (!Number.isFinite(a.duration)) return; replayEnd = replayStart = null; a.currentTime = Math.min(loopB ?? a.duration, Math.max(loopA ?? 0, a.currentTime + delta)); };
  a.playbackRate = SPEEDS.includes(audioRecord(owner, 'settings').speed) ? audioRecord(owner, 'settings').speed : 1;
  a.onloadedmetadata = () => { const at = Number.isFinite(audioRecord(owner, key).time) ? Math.max(0, audioRecord(owner, key).time) : 0; if (at < a.duration - 1) a.currentTime = at; status(at > 1 ? t('listen.resumeAt', {time: clock(at)}) : ''); };
  $('listen-play').onclick = () => { if (!a.paused) { a.pause(); return; } replayEnd = replayStart = null; play(); };
  $('listen-back').onclick = () => seek(-5); $('listen-forward').onclick = () => seek(5);
  $('listen-replay').onclick = () => { if (!Number.isFinite(a.duration)) return; if (loopB !== null) { a.currentTime = loopA; play(); return; } if (replayEnd === null) { replayEnd = a.currentTime; replayStart = Math.max(0, replayEnd - 5); } if (replayEnd <= replayStart) { replayEnd = replayStart = null; return; } a.currentTime = replayStart; play(); };
  a.onplay = playLabel; a.onpause = () => { savePosition(); playLabel(); };
  a.ontimeupdate = () => { savePosition(); if (replayEnd !== null && !a.paused && a.currentTime >= replayEnd) { a.pause(); a.currentTime = replayEnd; } else if (loopB !== null && a.currentTime >= loopB) a.currentTime = loopA; };
  a.onended = () => { if (loopA !== null && loopB !== null) { a.currentTime = loopA; a.play().catch(() => status(t('listen.tapToLoop'))); } };
  a.onerror = () => status(t('listen.loadError'));
  $('listen-speed').onchange = e => { a.playbackRate = Number(e.target.value); savePosition(); };
  $('listen-loop-a').onclick = () => { replayEnd = replayStart = null; if (!Number.isFinite(a.duration)) { status(t('listen.loopWait')); return; } loopA = a.currentTime; loopB = null; status(''); update(); };
  $('listen-loop-b').onclick = () => { if (loopA === null) { status(t('listen.loopHowTo')); return; } if (a.currentTime <= loopA + .3) { status(t('listen.loopOrder')); return; } loopB = a.currentTime; a.currentTime = loopA; status(''); update(); a.play().catch(() => status(t('listen.loopReady'))); };
  $('listen-loop-clear').onclick = () => { replayEnd = replayStart = null; loopA = loopB = null; status(''); update(); };
  $('listen-loop-save').onclick = () => { if (loopA === null || loopB === null) return; const list = Array.isArray(audioRecord(owner, key).clips) ? [...audioRecord(owner, key).clips] : []; if (!list.some(c => Math.abs(c.start - loopA) < .2 && Math.abs(c.end - loopB) < .2)) { if (list.length >= 20) { status(t('listen.clipLimit')); return; } list.push({start: loopA, end: loopB}); saveAudioState(owner, key, {clips: list}); clips(); } status(t('listen.clipSaved')); };
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
  $('notes').innerHTML = `<div class="section-bar"><h2>${t('notes.title')}</h2><div class="bar-controls"><span class="minor">${esc(who(learner))} · ${esc(L.title)}</span></div></div>${entries.length ? `<div class="note-grid">${entries.map(n => `<article class="note-card"><h3 lang="ja">${esc(n.label)}</h3>${n.text ? `<p lang="ja">${esc(n.text)}</p>` : ''}${n.done ? `<p class="minor">${t('notes.canExplain')}</p>` : ''}</article>`).join('')}</div>` : `<p class="empty-panel">${t('notes.empty')}</p>`}`;
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], {type: type + ';charset=utf-8'})), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export').onclick = () => {
  const date = new Date().toLocaleDateString('sv-SE');
  let md = `---\nlearner: ${who(learner)}\npack: ${PACK.title || PACK_ID}\nlesson: ${L.title}\nexported: ${date}\n---\n\n# ${t('export.heading', {name: who(learner), lesson: L.title})}\n\n${t('export.intro')}\n\n`;
  for (const e of L.vocabulary || []) { const r = record('v:' + e.id); md += `## ${e.word}（${e.reading || ''}）\n\n${(r.text || t('export.empty')).replace(/\r\n/g, '\n')}\n\n- [${r.done ? 'x' : ' '}] ${t('export.canExplain')}\n\n`; }
  for (const q of [...(L.exercises || []).flatMap(g => g.items), ...(L.listening || []).flatMap(x => x.questions || [])]) { const r = record('x:' + q.id); if (r.text) md += `## ${q.question}\n\n${r.text.replace(/\r\n/g, '\n')}\n\n`; }
  download(`${date}_${who(learner)}_${L.title}_${t('export.file')}.md`, md, 'text/markdown');
  notify(t('export.done'));
};
// Anki "Notes in Plain Text" import file (Anki 2.1.54+ reads the # headers): one note per word of this lesson,
// with the sentence it appears in, the learner's own explanation and tags for the pack, lesson and known words.
function exampleSentence(e) {
  const sentences = (L.paragraphs || []).flatMap(p => p.sentences?.length ? p.sentences.map(s => s.text) : p.text.split(/(?<=[。！？])/));
  const forms = (e.forms && e.forms.length ? e.forms : [e.word]);
  return (sentences.find(s => forms.some(f => s.includes(f))) || '').trim();
}
function ankiField(value) {
  const v = String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  return /["]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
function ankiExport() {
  const tag = s => String(s).replace(/\s+/g, '_');
  const lines = ['#separator:tab', '#html:false', '#columns:' + t('anki.columns'), '#tags column:7'];
  for (const e of vocab()) {
    const r = record('v:' + e.id), m = e.meaning || {};
    const meaning = typeof m === 'string' ? m : [m[PACK.translation_language], ...Object.entries(m).filter(([k]) => k !== PACK.translation_language).map(([, v]) => v)].filter(Boolean).join(' · ');
    const tags = [`bunmyaku::${tag(PACK_ID)}::${tag(L.id)}`, ...(r.done ? ['bunmyaku::known'] : [])].join(' ');
    lines.push([e.word, e.reading, meaning, exampleSentence(e), r.text, `${PACK.title || PACK_ID} · ${L.title}`, tags].map(ankiField).join('\t'));
  }
  return lines.join('\n') + '\n';
}
$('export-anki').onclick = () => {
  if (!vocab().length) { notify(t('anki.none')); return; }
  const date = new Date().toLocaleDateString('sv-SE');
  download(`${date}_${PACK_ID}_${L.id}_anki.txt`, ankiExport(), 'text/plain');
  notify(t('anki.done', {n: vocab().length}));
};
// ------------------------------------------------------------------ web clips

// The bookmarklet opens this page with #clip=<JSON>; nothing is kept until the learner presses Save, so a
// page that opens such a link by itself cannot fill the list. Clips belong to a profile, not to a pack or lesson.
const CLIP_KEY = 'bunmyaku:clips', CLIP_MAX = 300;
let pendingClip = null, activeClipId = '';
function allClips() { const v = store.get(CLIP_KEY, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
// Stored clips are read back through the same checks as arriving ones, so an edited entry cannot become a javascript: link.
function clips() {
  const list = allClips()[learner];
  return Array.isArray(list) ? list.filter(c => c && typeof c.id === 'string' && typeof c.text === 'string').map(c => ({...c, url: httpURL(String(c.url || '')), title: String(c.title || '')})) : [];
}
function saveClips(list) { const all = allClips(); all[learner] = list; storageOK = store.set(CLIP_KEY, all); return storageOK; }
function httpURL(value) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && u.href.length <= 2000 ? u.href : ''; } catch { return ''; }
}
function readClip(raw) {
  try {
    const d = JSON.parse(raw), text = typeof d.text === 'string' ? d.text.replace(/\r\n?/g, '\n').trim().slice(0, 4000) : '';
    return text ? {text, url: httpURL(String(d.url || '')), title: typeof d.title === 'string' ? d.title.replace(/\s+/g, ' ').trim().slice(0, 200) : ''} : null;
  } catch { return null; }
}
const clipSource = c => c.title || (c.url ? new URL(c.url).host : t('clip.noSource'));
const clipSourceHTML = c => c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(clipSource(c))}</a>` : esc(clipSource(c));
// Runs on the other page: takes the selection without furigana (<rt>) and opens this page in the tab named 'bunmyaku'.
function bookmarklet() {
  const code = `(function(){var g=getSelection(),s=String(g);if(g.rangeCount){var f=document.createElement('div');f.append(g.getRangeAt(0).cloneContents());if(f.querySelector('rt')){f.querySelectorAll('rt,rp').forEach(function(x){x.remove()});s=f.textContent}}s=s.trim();if(!s){alert(${JSON.stringify(t('clip.selectFirst'))});return}window.open(${JSON.stringify(location.origin + location.pathname)}+'#clip='+encodeURIComponent(JSON.stringify({text:s.slice(0,4000),url:location.href,title:document.title.slice(0,200)})),'bunmyaku')})()`;
  return 'javascript:' + encodeURIComponent(code);
}
function clipCard(c) {
  const date = new Date(c.at).toLocaleDateString(UI_HTML_LANG[UI_LANG]);
  return `<article class="note-card clip-card" data-clip="${esc(c.id)}"><blockquote lang="ja">${esc(c.text)}</blockquote><p class="minor clip-source">${clipSourceHTML(c)} · ${esc(date)}</p><div class="toolbar"><button data-clip-ask="${esc(c.id)}">${t('clip.ask')}</button><button data-clip-txt="${esc(c.id)}">${t('clip.exportText')}</button><button data-clip-delete="${esc(c.id)}">${t('clip.delete')}</button></div></article>`;
}
function renderClips() {
  const list = clips(), c = pendingClip;
  $('clip-count').textContent = t('clip.count', {n: list.length, name: who(learner)});
  $('clip-export-all').disabled = !list.length;
  $('clip-incoming').innerHTML = c ? `<article class="note-card clip-card clip-incoming" aria-labelledby="clip-incoming-title"><h3 id="clip-incoming-title" tabindex="-1">${t('clip.incoming')}</h3><p class="minor">${t('clip.incomingHelp')}</p><blockquote lang="ja">${esc(c.text)}</blockquote><p class="minor clip-source">${clipSourceHTML(c)}</p><div class="toolbar"><button id="clip-save" class="primary">${t('clip.save')}</button><button id="clip-discard">${t('clip.discard')}</button></div></article>` : '';
  $('clip-list').innerHTML = list.length ? `<div class="note-grid">${list.map(clipCard).join('')}</div>` : c ? '' : `<p class="empty-panel">${t('clip.empty')}</p>`;
}
function clipFileName(c, ext) { return `${new Date().toLocaleDateString('sv-SE')}_${clipSource(c).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60)}_${t('clip.file')}.${ext}`; }
// Plain text for tools/import_text.py: a "# " title line, a "Source:" line, then the clip's paragraphs.
function clipLessonText(c) { return `# ${c.title || clipSource(c)}\nSource: ${[c.title, c.url].filter(Boolean).join(' · ') || t('clip.noSource')}\n\n${c.text.replace(/\n{3,}/g, '\n\n')}\n`; }
$('clip-bookmarklet').href = bookmarklet();
$('clip-bookmarklet').onclick = e => { e.preventDefault(); notify(t('clip.dragOnly')); };
$('clip-code').value = bookmarklet();
$('clip-desk-url').textContent = location.origin + location.pathname;
$('clip-copy').onclick = async () => {
  if (await copyText($('clip-code').value)) notify(t('clip.codeCopied'));
  else { $('clip-code').focus(); $('clip-code').select(); notify(t('clip.codeManual')); }
};
$('clip-export-all').onclick = () => {
  const list = clips(); if (!list.length) return;
  const date = new Date().toLocaleDateString('sv-SE');
  let md = `---\nlearner: ${who(learner)}\nexported: ${date}\n---\n\n# ${t('clip.exportHeading', {name: who(learner)})}\n\n`;
  for (const c of list) md += `## ${clipSource(c)}\n\n${c.url ? `<${c.url}>\n` : ''}${new Date(c.at).toLocaleDateString('sv-SE')}\n\n${c.text.split('\n').map(l => '> ' + l).join('\n')}\n\n`;
  download(`${date}_${who(learner)}_${t('clip.file')}.md`, md, 'text/markdown'); notify(t('clip.exported'));
};
$('clips').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const list = clips(), find = id => list.find(c => c.id === id);
  if (b.id === 'clip-save' && pendingClip) {
    if (list.length >= CLIP_MAX) { notify(t('clip.full', {n: CLIP_MAX})); return; }
    const c = {id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...pendingClip, at: new Date().toISOString()};
    pendingClip = null; saveClips([c, ...list]); renderClips(); notify(storageOK ? t('clip.saved') : t('save.export'));
    document.querySelector(`[data-clip-ask="${c.id}"]`)?.focus();
  } else if (b.id === 'clip-discard') {
    pendingClip = null; renderClips(); notify(t('clip.discarded')); $('tab-clips').focus();
  } else if (b.dataset.clipAsk && find(b.dataset.clipAsk)) {
    activeClipId = b.dataset.clipAsk; openTutor({section: 'clip', itemId: activeClipId});
  } else if (b.dataset.clipTxt && find(b.dataset.clipTxt)) {
    const c = find(b.dataset.clipTxt); download(clipFileName(c, 'txt'), clipLessonText(c), 'text/plain'); notify(t('clip.exported'));
  } else if (b.dataset.clipDelete && find(b.dataset.clipDelete) && confirm(t('clip.deleteConfirm'))) {
    const id = b.dataset.clipDelete, i = list.findIndex(c => c.id === id);
    saveClips(list.filter(c => c.id !== id)); if (activeClipId === id) activeClipId = '';
    renderClips(); notify(t('clip.deleted')); tutorRefresh();
    (document.querySelectorAll('[data-clip-delete]')[Math.min(i, clips().length - 1)] || $('tab-clips')).focus();
  }
});
function takeClipFromHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (!params.has('clip')) return;
  const clip = readClip(params.get('clip')); params.delete('clip');
  history.replaceState(null, '', location.pathname + location.search + (params.size ? '#' + params : ''));
  if (!clip) { notify(t('clip.invalid')); return; }
  pendingClip = clip; showTab('clips'); $('clip-incoming-title').focus();
}
// Lets a second click of the bookmarklet reach this tab instead of opening another one, where the browser allows it.
window.name = 'bunmyaku';
window.addEventListener('hashchange', takeClipFromHash);

$('print').onclick = () => window.print();
$('ui-lang').innerHTML = UI_LANGS.map(x => `<option value="${x}" lang="${UI_HTML_LANG[x]}">${UI_LANG_NAMES[x]}</option>`).join('');
$('ui-lang').value = UI_LANG;
$('ui-lang').onchange = e => {
  store.set('bunmyaku:ui-lang', e.target.value);
  const params = new URLSearchParams(location.hash.replace(/^#/, '')); params.delete('lang');
  saveStudyPosition(); history.replaceState(null, '', location.pathname + location.search + (params.size ? '#' + params : '')); location.reload();
};
// Classic is the default look; glass (light and dark following the system) is the alternative. page.html applies it before the first paint.
$('ui-look').value = document.documentElement.classList.contains('ap') ? 'glass' : 'classic';
$('ui-look').onchange = e => { coursePicker?.close(); document.documentElement.classList.toggle('ap', e.target.value === 'glass'); store.set(K.look, e.target.value); };
// Glass look: the ruby, vocabulary and grammar switches sit together in one Display menu; each mirrors its original control.
document.querySelectorAll('[data-mirror]').forEach(box => {
  const source = $(box.dataset.mirror);
  const sync = () => { box.checked = source.checked; };
  box.onchange = () => { source.checked = box.checked; source.dispatchEvent(new Event('change')); };
  source.addEventListener('change', sync); sync();
});
const displayMenu = document.querySelector('.display-menu');
displayMenu.addEventListener('toggle', () => { if (displayMenu.open) document.querySelectorAll('[data-mirror]').forEach(box => { box.checked = $(box.dataset.mirror).checked; }); });
document.addEventListener('click', e => { if (displayMenu.open && !displayMenu.contains(e.target)) displayMenu.open = false; });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && displayMenu.open) { displayMenu.open = false; displayMenu.querySelector('summary').focus(); } });

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
  if (name === 'listening') renderListening(); if (name === 'clips') renderClips();
  updateProgress(); window.scrollTo({top: 0, behavior: 'auto'}); tutorRefresh();
}
document.querySelectorAll('[data-tab]').forEach((b, i, arr) => {
  b.onclick = () => showTab(b.dataset.tab);
  b.onkeydown = e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const j = e.key === 'Home' ? 0 : e.key === 'End' ? arr.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + arr.length) % arr.length; showTab(arr[j].dataset.tab); arr[j].focus(); } };
});
function renderAll() { renderPassage(); renderDetail(); renderWords(); renderGrammars(); renderExercises(); renderListening(); renderNotes(); renderClips(); updateProgress(); }
let coursePicker = null; // set once the course list exists (glass look)
function switchCourse(id) {
  saveStudyPosition();
  L = LESSONS.find(l => l.id === String(id)) || LESSONS[0]; course = L.id;
  selected = null; lastAnchor = null; exerciseGroup = null; listeningId = null; $('search').value = ''; $('course').value = course;
  const index = LESSONS.indexOf(L);
  $('course-heading').textContent = `／ ${L.number ? t('course.number', {n: L.number}) : L.title}`; $('course-subtitle').textContent = [L.title, L.theme].filter(Boolean).join(' · ');
  $('course-status').textContent = L.status || PACK.description || '';
  $('passage-heading').innerHTML = rubyHTML(L.title, L.title_ruby); $('passage-source').textContent = L.source || '';
  $('passage-note').textContent = (L.paragraphs || []).some(p => (p.translation || {}).status === 'machine' || p.ruby_status === 'unverified') ? t('read.noteUnchecked') : t('read.noteDefault');
  $('tab-words').textContent = `${t('tab.words')} · ${vocab().length}`; $('tab-grammar').textContent = `${t('tab.grammar')} · ${grammar().length}`;
  $('tab-listening').textContent = `${t('tab.listening')}${(L.listening || []).length ? ' · ' + L.listening.length : ''}`;
  $('prev-course').disabled = index === 0; $('next-course').disabled = index === LESSONS.length - 1;
  $('course-position').textContent = `${index + 1} / ${LESSONS.length}`; $('course').title = $('course').selectedOptions[0]?.textContent || '';
  coursePicker?.set(course);
  document.title = `${L.title} · Bunmyaku`;
  renderAll(); showTab('read');
  $('save-status').textContent = storageOK ? t('save.local') : t('save.export');
}
$('course').innerHTML = LESSONS.map(l => `<option value="${esc(l.id)}">${l.number ? esc(t('course.number', {n: l.number})) + ' · ' : ''}${esc(l.title)}</option>`).join('');
$('course').onchange = e => switchCourse(e.target.value);

// Glass look: a capsule picker (shared glass kit, 74 appendix B) stands in for the native course select and drives it.
function createPicker(parent, options, value, onChange, label) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'ap-picker';
  button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
  if (label) button.setAttribute('aria-label', label);
  const valueEl = document.createElement('span'); valueEl.className = 'ap-picker-value'; button.append(valueEl); parent.append(button);
  let current = value, menu = null, holder = null, focused = 0;
  const render = () => { const o = options.find(x => x.value === current); valueEl.textContent = o ? o.label : current; button.title = o ? o.label : ''; };
  const onOutside = e => { if (menu && !menu.contains(e.target) && !button.contains(e.target)) close(); };
  const onScroll = e => { if (menu && !menu.contains(e.target)) close(); };
  function close() {
    if (!menu) return;
    holder.remove(); menu = null; holder = null; button.setAttribute('aria-expanded', 'false');
    window.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onOutside, true); document.removeEventListener('scroll', onScroll, true);
  }
  const choose = i => { const o = options[i]; if (!o) return; close(); button.focus(); if (o.value !== current) { current = o.value; render(); onChange(current); } };
  const move = i => {
    if (!menu) return;
    focused = (i + options.length) % options.length;
    const items = [...menu.querySelectorAll('.ap-menu-item')];
    items.forEach((item, j) => item.classList.toggle('is-focused', j === focused));
    menu.setAttribute('aria-activedescendant', items[focused]?.id || '');
    items[focused]?.scrollIntoView({block: 'nearest'});
  };
  const open = () => {
    menu = document.createElement('div'); menu.className = 'ap ap-menu'; menu.setAttribute('role', 'listbox'); menu.tabIndex = -1;
    if (label) menu.setAttribute('aria-label', label);
    options.forEach((o, i) => {
      const item = document.createElement('div'); item.className = 'ap-menu-item'; item.id = `${parent.id}-option-${i}`;
      item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(o.value === current));
      const text = document.createElement('span'); text.className = 'ap-menu-label'; text.textContent = o.label; item.append(text);
      item.addEventListener('mousemove', () => move(i)); item.addEventListener('click', () => choose(i));
      menu.append(item);
    });
    // On top of everything, inside a labelled region so the list still sits in a landmark.
    holder = document.createElement('div'); holder.setAttribute('role', 'region'); if (label) holder.setAttribute('aria-label', label);
    holder.append(menu); document.body.append(holder);
    const rect = button.getBoundingClientRect();
    menu.style.minWidth = `${Math.max(180, rect.width)}px`;
    const box = menu.getBoundingClientRect();
    // Line the list up with the button's nearer edge, then keep it on screen.
    const start = rect.left + rect.width / 2 > innerWidth / 2 ? rect.right - box.width : rect.left;
    menu.style.left = `${Math.min(Math.max(8, start), innerWidth - box.width - 8)}px`;
    menu.style.top = `${rect.bottom + 6 + box.height > innerHeight - 8 ? Math.max(8, rect.top - box.height - 6) : rect.bottom + 6}px`;
    button.setAttribute('aria-expanded', 'true');
    move(Math.max(0, options.findIndex(o => o.value === current)));
    window.addEventListener('keydown', onKey, true); menu.focus();
    document.addEventListener('mousedown', onOutside, true); document.addEventListener('scroll', onScroll, true);
  };
  function onKey(e) {
    if (e.key === 'ArrowDown') move(focused + 1);
    else if (e.key === 'ArrowUp') move(focused - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(options.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') choose(focused);
    else if (e.key === 'Escape' || e.key === 'Tab') { close(); button.focus(); }
    else return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  }
  button.addEventListener('click', () => (menu ? close() : open()));
  button.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!menu) open(); } });
  render();
  return {button, set(next) { current = next; render(); }, close};
}
coursePicker = createPicker($('course-picker'), [...$('course').options].map(o => ({value: o.value, label: o.textContent})), $('course').value, v => switchCourse(v), t('course.select'));
$('prev-course').onclick = () => { const i = LESSONS.indexOf(L); if (i > 0) switchCourse(LESSONS[i - 1].id); };
$('next-course').onclick = () => { const i = LESSONS.indexOf(L); if (i < LESSONS.length - 1) switchCourse(LESSONS[i + 1].id); };
$('pack-title').textContent = PACK.title || PACK_ID; $('pack-license').textContent = PACK.license ? t('license', {license: PACK.license}) : '';

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
  const h = $('tutor-resize'); h.setAttribute('aria-valuemin', min); h.setAttribute('aria-valuemax', max); h.setAttribute('aria-valuenow', width); h.setAttribute('aria-valuetext', t('tutor.pixels', {n: width}));
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
function chatKey() { return tutorSection === 'clip' ? `${learner}:clip:${tutorItem}` : `${learner}:${course}:${tutorSection}`; }
function chat() { return tutorChats[chatKey()] || (tutorChats[chatKey()] = []); }
// On the clips panel the tutor talks about one clip (the last one asked about or selected in, else the newest) instead of the lesson.
const currentClip = () => { const list = clips(); return list.find(c => c.id === activeClipId) || list[0] || null; };
function currentSection() { return !$('listening').hidden ? 'listening' : !$('clips').hidden && currentClip() ? 'clip' : 'read'; }
function sectionItem(section) { return section === 'listening' ? (listeningId || '') : section === 'clip' ? currentClip().id : ''; }
function tutorRefresh() { if (tutorBusy) return; tutorSection = currentSection(); tutorItem = sectionItem(tutorSection); tutorSelection = ''; if (!$('tutor-dialog').hidden) tutorRender(); }
const tutorClip = () => tutorSection === 'clip' ? clips().find(c => c.id === tutorItem) || null : null;
function tutorItemLabel() {
  for (const g of L.exercises || []) { const i = g.items.findIndex(e => e.id === tutorItem); if (i >= 0) return t('tutor.exerciseItem', {group: g.title, n: i + 1}); }
  for (const x of L.listening || []) { if (x.id === tutorItem) return t('tutor.listeningItem', {title: x.title}); const i = (x.questions || []).findIndex(q => q.id === tutorItem); if (i >= 0) return t('tutor.listeningQuestion', {title: x.title, n: i + 1}); }
  return '';
}
function tutorRender() {
  if (tutorSection === 'clip' && !tutorClip()) { tutorSection = 'read'; tutorItem = ''; }
  const clip = tutorClip();
  $('tutor-selection').hidden = !tutorSelection; $('selection-text').textContent = tutorSelection;
  const prompts = t(tutorSelection ? 'tutor.q.selection'
    : clip ? 'tutor.q.clip'
    : tutorItem && tutorSection !== 'listening' ? 'tutor.q.exercise'
    : tutorSection === 'listening' ? 'tutor.q.listening'
    : !$('grammar').hidden ? 'tutor.q.grammar'
    : !$('words').hidden ? 'tutor.q.words'
    : 'tutor.q.read');
  $('tutor-suggestions').innerHTML = prompts.map(q => `<button type="button" class="suggestion">${esc(q)} <span aria-hidden="true">↗</span></button>`).join('');
  $('tutor-suggestions').querySelectorAll('button').forEach(b => b.onclick = () => { $('tutor-question').value = b.textContent.replace(/ ↗$/, ''); $('tutor-question').focus(); });
  $('tutor-context').textContent = clip ? `${t('clip.title')} · ${clipSource(clip)} · ${who(learner)}${tutorSelection ? t('tutor.withSelection') : ''}`
    : `${L.title}${tutorSection === 'listening' ? t('tutor.listening') : ''} · ${who(learner)}${tutorItem && tutorItemLabel() ? ' · ' + tutorItemLabel() : ''}${tutorSelection ? t('tutor.withSelection') : ''}`;
  $('tutor-messages').innerHTML = chat().map(m => `<div class="chat-message ${m.role}"><strong class="chat-author">${m.role === 'user' ? t('tutor.me') : t('tutor.teacher')}</strong><div class="chat-content">${m.role === 'assistant' ? tutorMarkdown(m.content) : esc(m.content).replace(/\n/g, '<br>')}</div></div>`).join('');
  $('tutor-send').disabled = tutorBusy || STATIC_DEMO; $('tutor-cancel').hidden = !tutorBusy;
  const copyMode = tutorConfigured === false;
  $('tutor-dialog').classList.toggle('copy-mode', copyMode); $('tutor-copy').hidden = !copyMode;
}
async function tutorStatus() {
  if (STATIC_DEMO) { tutorConfigured = null; $('tutor-status').textContent = t('tutor.static'); tutorRender(); return; }
  try {
    const r = await fetch('/api/status', {cache: 'no-store'}); if (!r.ok) throw Error();
    const a = await r.json(); tutorToken = a.token; tutorConfigured = a.configured === true;
    $('tutor-status').textContent = a.configured ? t('tutor.connected', {preset: a.preset === 'custom' ? t('tutor.custom') : a.preset, model: a.model}) : t('tutor.notConfigured');
  } catch { tutorConfigured = null; $('tutor-status').textContent = t('tutor.offline'); }
  tutorRender();
}
function selectedStudyText() {
  const sel = window.getSelection(); if (!sel || sel.isCollapsed) return '';
  const node = sel.anchorNode?.parentElement; if (!node?.closest('main')) return '';
  const fragment = sel.getRangeAt(0).cloneContents(); fragment.querySelectorAll('rt').forEach(x => x.remove());
  return fragment.textContent.trim().slice(0, 2000);
}
document.addEventListener('selectionchange', () => {
  clearTimeout(window.selectionTimer);
  window.selectionTimer = setTimeout(() => {
    const text = selectedStudyText(); if (!text || tutorBusy) return;
    const card = window.getSelection().anchorNode?.parentElement?.closest('[data-clip]'); if (card) activeClipId = card.dataset.clip;
    tutorSelection = text; tutorSection = currentSection(); tutorItem = sectionItem(tutorSection);
    if (!$('tutor-dialog').hidden) tutorRender();
  }, 150);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('tutor-dialog').hidden && !document.querySelector('dialog[open]')) $('tutor-close').click(); });
function openTutor(options = {}) {
  if (tutorBusy && options.itemId) { notify(t('tutor.busy')); return; }
  tutorSection = options.section || currentSection();
  const selection = selectedStudyText();
  tutorItem = options.itemId || sectionItem(tutorSection);
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
$('tutor-clear').onclick = () => { if (tutorBusy) return; delete tutorChats[chatKey()]; tutorItem = ''; tutorSelection = ''; $('tutor-prompt-out').hidden = true; tutorRender(); };
$('tutor-cancel').onclick = () => tutorController?.abort();
function requestBody(question) {
  const clip = tutorClip();
  return {lesson: course, section: tutorSection, itemId: tutorItem, question, history: chat().slice(-8), mode: $('tutor-mode').value, selection: tutorSelection,
    ...(clip ? {clip: {text: clip.text, title: clip.title, url: clip.url}} : {})};
}
// navigator.clipboard exists only in secure contexts (https, localhost); a phone on http://192.168.x.x has none.
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) { try { await navigator.clipboard.writeText(text); return true; } catch {} }
  const area = document.createElement('textarea'); area.value = text; area.setAttribute('readonly', ''); area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(area); area.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch {}
  area.remove(); return ok;
}
$('tutor-copy').onclick = async () => {
  const question = $('tutor-question').value.trim(); if (!question || tutorBusy) { notify(t('tutor.writeFirst')); return; }
  try {
    if (!tutorToken) await tutorStatus();
    const response = await fetch('/api/prompt', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Study-Token': tutorToken}, body: JSON.stringify(requestBody(question))});
    const result = await response.json(); if (!response.ok) throw Error(result.error || t('tutor.requestFailed'));
    const out = $('tutor-prompt-out');
    if (await copyText(result.prompt)) { out.hidden = true; $('tutor-result').textContent = t('tutor.copied'); }
    else { out.value = result.prompt; out.hidden = false; out.focus(); out.select(); $('tutor-result').textContent = t('tutor.copyManual'); }
  } catch (err) { $('tutor-result').textContent = err.message; }
};
$('tutor-form').onsubmit = async e => {
  e.preventDefault();
  if (STATIC_DEMO) return;
  if (tutorConfigured === false) { $('tutor-copy').click(); return; }
  const question = $('tutor-question').value.trim(); if (!question || tutorBusy) return;
  const key = chatKey(), messages = chat(), body = requestBody(question);
  messages.push({role: 'user', content: question});
  tutorBusy = true; tutorController = new AbortController(); $('tutor-question').value = ''; tutorRender(); $('tutor-result').textContent = t('tutor.thinking');
  const timer = setTimeout(() => tutorController.abort(), 100000);
  try {
    if (!tutorToken) await tutorStatus();
    const response = await fetch('/api/chat', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Study-Token': tutorToken}, body: JSON.stringify(body), signal: tutorController.signal});
    const result = await response.json(); if (!response.ok) throw Error(result.error || t('tutor.requestFailed'));
    messages.push({role: 'assistant', content: result.answer}); $('tutor-result').textContent = '';
  } catch (err) {
    $('tutor-result').textContent = err.name === 'AbortError' ? t('tutor.cancelled') : err.message;
    $('tutor-question').value = question; messages.pop();
  } finally { clearTimeout(timer); tutorBusy = false; tutorController = null; if (chatKey() === key) tutorRender(); }
};

// ------------------------------------------------------------------ boot

document.addEventListener('click', e => { document.querySelectorAll('.context-info[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; }); });
// The top bar sticks on wide screens; the player and the reading companion stick just below it.
if (window.ResizeObserver) new ResizeObserver(([entry]) => document.documentElement.style.setProperty('--head-h', Math.ceil(entry.target.offsetHeight) + 'px')).observe(document.querySelector('.workspace>header'));
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
    if (panel && PANELS.includes(panel)) showTab(panel);
    if (params.get('word') && vocab().some(e => e.id === params.get('word'))) { showTab('read'); selectEntry(params.get('word')); }
    if (params.get('answers') === '1') { exerciseView.answers = true; if (panel === 'exercises') renderExercises(); if (panel === 'listening') renderListening(); }
    if (params.has('tutor')) openTutor({selection: params.get('tutor') || ''});
  } finally { restoringStudy = false; }
})();
takeClipFromHash();
studyReady = true;
setInterval(saveStudyPosition, 1500);
