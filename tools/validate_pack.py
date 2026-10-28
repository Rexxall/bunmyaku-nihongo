#!/usr/bin/env python3
"""Validate a Bunmyaku course pack (Pack v1) and print readable findings.

    python3 tools/validate_pack.py examples/demo-pack
    python3 tools/validate_pack.py my-pack --strict      # warnings also fail

Checks: manifest fields, lesson structure, id uniqueness, bracket ruby consistency and
coverage, translation/ruby status values, exercise answers, media references, readings table.
Exit code 1 when there are errors (or warnings with --strict).
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import packlib  # noqa: E402

KANJI_RUN = re.compile(r'[一-龯々〆〇]+')
BRACKET = re.compile(r'([一-龯々〆〇]+)\[([^\]]+)\]')
KANA = re.compile(r'^[ぁ-ゖァ-ヺー・ゝゞヽヾ]+$')
BLANK = re.compile(r'＿+|_{2,}')
TEXT_STATUS = {'human', 'machine', 'unverified'}
READING_STATUS = {'verified', 'unverified'}
AUDIO_STATUS = {'recorded', 'tts', 'placeholder', 'none'}
EXERCISE_TYPES = {'fill', 'choice', 'open', 'transform'}
ID = packlib.ID_PATTERN


class Report:
    def __init__(self):
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.runs = 0
        self.covered = 0
        self.unverified = 0

    def error(self, where: str, msg: str):
        self.errors.append(f'ERROR  {where}: {msg}')

    def warn(self, where: str, msg: str):
        self.warnings.append(f'WARN   {where}: {msg}')


def check_ruby(rep: Report, where: str, text: str, ruby, status) -> None:
    """``ruby`` must strip back to ``text``; every kanji run in ``text`` needs a reading."""
    runs = KANJI_RUN.findall(text or '')
    rep.runs += len(runs)
    if status is not None and status not in TEXT_STATUS:
        rep.error(where + '.ruby_status', f'只能是 {sorted(TEXT_STATUS)}，现在是 {status!r}')
    if status == 'unverified':
        rep.unverified += 1
    if ruby is None:
        if runs:
            rep.warn(where + '.ruby', f'缺少注音：{len(runs)} 个汉字串将按课级 readings／词表兜底，兜底不到的不显示假名')
        return
    if not isinstance(ruby, str):
        rep.error(where + '.ruby', '必须是字符串，用 漢字[かんじ] 标注')
        return
    stripped = BRACKET.sub(r'\1', ruby)
    if stripped != text:
        at = next((i for i, (a, b) in enumerate(zip(stripped, text)) if a != b), min(len(stripped), len(text)))
        rep.error(where + '.ruby', f'去掉方括号后与 text 不一致（第 {at + 1} 个字符起不同）：…{stripped[max(0, at - 6):at + 8]}… vs …{text[max(0, at - 6):at + 8]}…')
        return
    for kanji, reading in BRACKET.findall(ruby):
        if not KANA.match(reading):
            rep.error(where + '.ruby', f'「{kanji}」的读音「{reading}」不是纯假名')
    bracketed = BRACKET.findall(ruby)
    covered = len(bracketed)
    rep.covered += min(covered, len(runs))
    leftover = KANJI_RUN.findall(BRACKET.sub('', ruby))
    if leftover:
        rep.error(where + '.ruby', f'有汉字没有注音：{"、".join(leftover[:5])}' + ('…' if len(leftover) > 5 else ''))


def check_exercise(rep: Report, where: str, item, seen_ids: set) -> None:
    if not isinstance(item, dict):
        rep.error(where, '题目必须是对象')
        return
    iid = item.get('id')
    if not isinstance(iid, str) or not ID.fullmatch(iid):
        rep.error(where + '.id', f'题目 id 缺失或不合法：{iid!r}')
    elif iid in seen_ids:
        rep.error(where + '.id', f'题目 id 重复：{iid}')
    else:
        seen_ids.add(iid)
    kind = item.get('type')
    if kind not in EXERCISE_TYPES:
        rep.error(where + '.type', f'type 只能是 {sorted(EXERCISE_TYPES)}，现在是 {kind!r}')
        return
    question = item.get('question')
    if not isinstance(question, str) or not question.strip():
        rep.error(where + '.question', '缺少题干')
        return
    if kind == 'fill':
        blanks = len(BLANK.findall(question))
        answers = item.get('answers')
        if blanks == 0:
            rep.error(where + '.question', 'fill 题的题干里没有 ＿＿ 空格')
        if not isinstance(answers, list) or not all(isinstance(a, str) and a for a in answers):
            rep.error(where + '.answers', 'fill 题需要 answers 字符串列表，按空格顺序')
        elif len(answers) != blanks:
            rep.error(where + '.answers', f'空格 {blanks} 个，答案 {len(answers)} 个，数量不一致')
    elif kind == 'choice':
        choices = item.get('choices')
        if not isinstance(choices, list) or len(choices) < 2 or not all(isinstance(c, str) and c for c in choices):
            rep.error(where + '.choices', 'choice 题需要至少两个字符串选项')
        elif len(set(choices)) != len(choices):
            rep.error(where + '.choices', '选项重复')
        elif item.get('answer') not in choices:
            rep.error(where + '.answer', 'answer 必须与某个选项完全一致')
    elif kind == 'transform':
        if not isinstance(item.get('answer'), str) or not item['answer'].strip():
            rep.error(where + '.answer', 'transform 题需要 answer')
    elif kind == 'open':
        if 'answer' in item:
            rep.warn(where, 'open 题建议用 reference（参考说法）而不是 answer')
        if not isinstance(item.get('reference', ''), str):
            rep.error(where + '.reference', 'reference 必须是字符串')
    for key in ('hint', 'explanation'):
        if key in item and not isinstance(item[key], str):
            rep.error(where + '.' + key, '必须是字符串')


def check_lesson(rep: Report, pack_dir: Path, lesson: dict, index: int) -> None:
    where = lesson.get('_file') or f'lessons[{index}]'
    lid = lesson.get('id')
    if not isinstance(lid, str) or not ID.fullmatch(lid):
        rep.error(where + '.id', f'课 id 缺失或不合法：{lid!r}（只允许英文字母、数字、下划线、连字符）')
    if not isinstance(lesson.get('title'), str) or not lesson['title'].strip():
        rep.error(where + '.title', '缺少课标题')
    if 'title_ruby' in lesson and isinstance(lesson.get('title'), str):
        check_ruby(rep, where + '.title', lesson['title'], lesson.get('title_ruby'), None)
    paragraphs = lesson.get('paragraphs')
    if not isinstance(paragraphs, list) or not paragraphs:
        rep.error(where + '.paragraphs', '至少要有一个段落')
        paragraphs = []
    texts = []
    for i, p in enumerate(paragraphs):
        pw = f'{where}.paragraphs[{i}]'
        if not isinstance(p, dict) or not isinstance(p.get('text'), str) or not p['text'].strip():
            rep.error(pw, '段落必须是带 text 的对象')
            continue
        texts.append(p['text'])
        check_ruby(rep, pw, p['text'], p.get('ruby'), p.get('ruby_status'))
        tr = p.get('translation')
        if tr is None:
            rep.warn(pw + '.translation', '没有译文')
        elif not isinstance(tr, dict) or not isinstance(tr.get('text'), str):
            rep.error(pw + '.translation', '译文必须是 {text, status} 对象')
        elif tr.get('status') not in TEXT_STATUS:
            rep.error(pw + '.translation.status', f'只能是 {sorted(TEXT_STATUS)}，现在是 {tr.get("status")!r}')
        for j, s in enumerate(p.get('sentences') or []):
            sw = f'{pw}.sentences[{j}]'
            if not isinstance(s, dict) or not isinstance(s.get('text'), str):
                rep.error(sw, '句子必须是带 text 的对象')
                continue
            if s['text'] not in p['text']:
                rep.error(sw + '.text', '句子不在本段 text 里（逐句精讲只能引用原文）')
            check_ruby(rep, sw, s['text'], s.get('ruby'), s.get('ruby_status'))
            if isinstance(s.get('example'), str):
                check_ruby(rep, sw + '.example', s['example'], s.get('example_ruby'), None)
    full = '\n'.join(texts)
    seen = set()
    for i, e in enumerate(lesson.get('vocabulary') or []):
        vw = f'{where}.vocabulary[{i}]'
        if not isinstance(e, dict):
            rep.error(vw, '词条必须是对象')
            continue
        vid = e.get('id')
        if not isinstance(vid, str) or not ID.fullmatch(vid):
            rep.error(vw + '.id', f'词条 id 缺失或不合法：{vid!r}')
        elif vid in seen:
            rep.error(vw + '.id', f'词条 id 重复：{vid}')
        seen.add(vid)
        word = e.get('word')
        if not isinstance(word, str) or not word.strip():
            rep.error(vw + '.word', '缺少 word')
            continue
        reading = e.get('reading')
        if KANJI_RUN.search(word):
            rep.runs += 1
            if not isinstance(reading, str) or not KANA.match(reading):
                rep.error(vw + '.reading', f'「{word}」含汉字，需要纯假名 reading')
            else:
                rep.covered += 1
            if e.get('reading_status') not in READING_STATUS:
                rep.error(vw + '.reading_status', f'只能是 {sorted(READING_STATUS)}，现在是 {e.get("reading_status")!r}')
            elif e['reading_status'] == 'unverified':
                rep.unverified += 1
        forms = e.get('forms')
        if not isinstance(forms, list) or not forms or not all(isinstance(f, str) and f for f in forms):
            rep.error(vw + '.forms', 'forms 需要至少一个字符串（正文中出现的词形）')
        else:
            missing = [f for f in forms if f not in full]
            if missing:
                rep.warn(vw + '.forms', f'正文里找不到：{"、".join(missing)}（高亮与定位会失效）')
        meaning = e.get('meaning')
        if not (isinstance(meaning, str) and meaning.strip()) and not (isinstance(meaning, dict) and any(isinstance(v, str) and v.strip() for v in meaning.values())):
            rep.error(vw + '.meaning', 'meaning 需要字符串或 {语言: 释义} 对象')
    seen = set()
    for i, g in enumerate(lesson.get('grammar') or []):
        gw = f'{where}.grammar[{i}]'
        if not isinstance(g, dict):
            rep.error(gw, '语法条目必须是对象')
            continue
        gid = g.get('id')
        if not isinstance(gid, str) or not ID.fullmatch(gid):
            rep.error(gw + '.id', f'语法 id 缺失或不合法：{gid!r}')
        elif gid in seen:
            rep.error(gw + '.id', f'语法 id 重复：{gid}')
        seen.add(gid)
        if not isinstance(g.get('name'), str) or not g['name'].strip():
            rep.error(gw + '.name', '缺少 name')
        if isinstance(g.get('phrase'), str) and g['phrase'] and g['phrase'] not in full:
            rep.warn(gw + '.phrase', f'正文里找不到「{g["phrase"]}」（不会画下划线）')
        if isinstance(g.get('example'), str):
            check_ruby(rep, gw + '.example', g['example'], g.get('example_ruby'), None)
        elif 'example' in g:
            rep.error(gw + '.example', '必须是字符串')
    item_ids: set = set()
    group_ids: set = set()
    for i, grp in enumerate(lesson.get('exercises') or []):
        ew = f'{where}.exercises[{i}]'
        if not isinstance(grp, dict) or not isinstance(grp.get('items'), list):
            rep.error(ew, '练习组必须是带 items 列表的对象')
            continue
        gid = grp.get('id')
        if not isinstance(gid, str) or not ID.fullmatch(gid):
            rep.error(ew + '.id', f'练习组 id 缺失或不合法：{gid!r}')
        elif gid in group_ids:
            rep.error(ew + '.id', f'练习组 id 重复：{gid}')
        group_ids.add(gid)
        if not isinstance(grp.get('title'), str) or not grp['title'].strip():
            rep.error(ew + '.title', '缺少 title')
        for j, item in enumerate(grp['items']):
            check_exercise(rep, f'{ew}.items[{j}]', item, item_ids)
    listen_ids: set = set()
    for i, item in enumerate(lesson.get('listening') or []):
        lw = f'{where}.listening[{i}]'
        if not isinstance(item, dict):
            rep.error(lw, '听力条目必须是对象')
            continue
        iid = item.get('id')
        if not isinstance(iid, str) or not ID.fullmatch(iid):
            rep.error(lw + '.id', f'听力 id 缺失或不合法：{iid!r}')
        elif iid in listen_ids:
            rep.error(lw + '.id', f'听力 id 重复：{iid}')
        listen_ids.add(iid)
        if not isinstance(item.get('title'), str) or not item['title'].strip():
            rep.error(lw + '.title', '缺少 title')
        audio = item.get('audio')
        if audio is not None:
            if not isinstance(audio, str) or not audio:
                rep.error(lw + '.audio', 'audio 要么是 null，要么是包内相对路径')
            else:
                try:
                    file = packlib.safe_child(pack_dir, audio)
                    if not file.is_file():
                        rep.error(lw + '.audio', f'文件不存在：{audio}')
                    elif file.suffix.lower() not in packlib.MEDIA_TYPES:
                        rep.error(lw + '.audio', f'不支持的音频后缀 {file.suffix}；可用 {sorted(packlib.MEDIA_TYPES)}')
                    elif not audio.startswith('media/'):
                        rep.warn(lw + '.audio', '音频建议放在 media/ 目录下')
                except packlib.PackError as e:
                    rep.error(lw + '.audio', str(e))
        status = item.get('audio_status')
        if status is not None and status not in AUDIO_STATUS:
            rep.error(lw + '.audio_status', f'只能是 {sorted(AUDIO_STATUS)}，现在是 {status!r}')
        if audio is None and status not in (None, 'none'):
            rep.warn(lw + '.audio_status', '没有音频时 audio_status 应为 "none"')
        lines = item.get('lines')
        if not isinstance(lines, list) or not lines:
            rep.error(lw + '.lines', '至少要有一行文稿')
            lines = []
        for j, line in enumerate(lines):
            xw = f'{lw}.lines[{j}]'
            if not isinstance(line, dict) or not isinstance(line.get('text'), str) or not line['text'].strip():
                rep.error(xw, '每行必须是带 text 的对象')
                continue
            check_ruby(rep, xw, line['text'], line.get('ruby'), line.get('ruby_status'))
        for j, q in enumerate(item.get('questions') or []):
            check_exercise(rep, f'{lw}.questions[{j}]', q, item_ids)
    readings = lesson.get('readings')
    if readings is not None:
        if not isinstance(readings, dict):
            rep.error(where + '.readings', 'readings 必须是 {词: 假名} 对象')
        else:
            for k, v in readings.items():
                if not KANJI_RUN.search(k):
                    rep.warn(where + '.readings', f'「{k}」不含汉字，不需要放进 readings')
                if not isinstance(v, str) or not KANA.match(v):
                    rep.error(where + '.readings', f'「{k}」的读音必须是纯假名，现在是 {v!r}')


def validate(pack_dir: Path) -> Report:
    rep = Report()
    try:
        pack = packlib.load_pack(pack_dir)
    except packlib.PackError as e:
        rep.error('pack.json', str(e))
        return rep
    w = 'pack.json'
    if pack.get('format') != packlib.PACK_FORMAT:
        rep.error(w + '.format', f'必须是 "{packlib.PACK_FORMAT}"')
    if pack.get('version') != packlib.PACK_VERSION:
        rep.error(w + '.version', f'必须是 {packlib.PACK_VERSION}')
    pid = pack.get('id')
    if not isinstance(pid, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', pid):
        rep.error(w + '.id', f'id 必须是小写字母、数字和连字符：{pid!r}')
    for key in ('title', 'revision', 'language', 'translation_language', 'license'):
        if not isinstance(pack.get(key), str) or not pack[key].strip():
            rep.error(f'{w}.{key}', '必填字符串缺失')
    if 'profiles' in pack and (not isinstance(pack['profiles'], list) or not all(isinstance(p, str) and p.strip() for p in pack['profiles'])):
        rep.error(w + '.profiles', '必须是非空字符串列表')
    if 'ui_language' in pack and pack['ui_language'] not in ('zh', 'ja', 'en'):
        rep.error(w + '.ui_language', f'界面语言只能是 zh、ja、en：{pack["ui_language"]!r}')
    tutor = pack.get('tutor')
    if tutor is not None and (not isinstance(tutor, dict) or any(not isinstance(v, str) for v in tutor.values())):
        rep.error(w + '.tutor', 'tutor 必须是 {persona, learner_note} 字符串对象')
    if not pack['lessons']:
        rep.error(w + '.lessons', '至少要有一课')
    ids = [l.get('id') for l in pack['lessons']]
    for dup in {x for x in ids if ids.count(x) > 1}:
        rep.error(w + '.lessons', f'课 id 重复：{dup!r}')
    for i, lesson in enumerate(pack['lessons']):
        check_lesson(rep, pack_dir, lesson, i)
    for entry in pack.get('media') or []:
        path = entry.get('path') if isinstance(entry, dict) else entry
        try:
            if not packlib.safe_child(pack_dir, path).is_file():
                rep.error(w + '.media', f'文件不存在：{path}')
        except packlib.PackError as e:
            rep.error(w + '.media', str(e))
    return rep


def main(argv=None) -> int:
    packlib.safe_console()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('pack', nargs='?', help='course pack directory (default: BUNMYAKU_CONTENT or examples/demo-pack)')
    parser.add_argument('--strict', action='store_true', help='treat warnings as errors')
    args = parser.parse_args(argv)
    pack_dir = packlib.resolve_content_dir(args.pack)
    rep = validate(pack_dir)
    for line in rep.errors + rep.warnings:
        print(line)
    coverage = f'{rep.covered}/{rep.runs}' if rep.runs else '无汉字'
    print(f'注音覆盖：{coverage} 个汉字串有读音；标 unverified 的条目：{rep.unverified}')
    failed = bool(rep.errors) or (args.strict and bool(rep.warnings))
    print(f'{"FAIL" if failed else "OK"}  {pack_dir}  错误 {len(rep.errors)} · 警告 {len(rep.warnings)}')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
