#!/usr/bin/env python3
"""Turn a plain-text lesson and a CSV word list into a minimal course pack. No AI, no network.

    python3 tools/import_text.py --text lesson.txt --vocab words.csv --out my-pack \
        --id my-pack --title "我的课程" --lesson-title "第一课"

Text file: paragraphs separated by blank lines. A first line starting with ``# `` becomes the
lesson title. ``--translation`` takes a second text file with the same number of paragraphs.
CSV columns (header required, extra columns ignored): ``word, reading, meaning`` plus optional
``forms`` (``／``-separated word forms found in the text), ``simple``, ``similar``, ``memo``.
Readings and translations are marked ``unverified`` until a person checks them; run
``tools/validate_pack.py`` afterwards and read its warnings.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import packlib  # noqa: E402

KANJI_RUN = re.compile(r'[一-龯々〆〇]+')


def read_paragraphs(path: Path) -> tuple[str | None, list[str]]:
    raw = path.read_text(encoding='utf-8').replace('\r\n', '\n').strip()
    title = None
    if raw.startswith('# '):
        first, _, rest = raw.partition('\n')
        title, raw = first[2:].strip(), rest.strip()
    paragraphs = [re.sub(r'\s*\n\s*', '', block).strip() for block in re.split(r'\n\s*\n', raw) if block.strip()]
    return title, paragraphs


def read_vocab(path: Path, full_text: str) -> list[dict]:
    with path.open(encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames or not {'word', 'reading', 'meaning'} <= {h.strip().lower() for h in reader.fieldnames}:
            raise SystemExit('词表 CSV 需要表头 word, reading, meaning（可选 forms, simple, similar, memo）')
        rows = [{(k or '').strip().lower(): (v or '').strip() for k, v in row.items()} for row in reader]
    entries = []
    for i, row in enumerate(rows, 1):
        word = row.get('word', '')
        if not word:
            continue
        forms = [x.strip() for x in re.split(r'[／/|]', row.get('forms', '')) if x.strip()] or [word]
        entry = {'id': f'v{i}', 'word': word, 'reading': row.get('reading', ''), 'reading_status': 'unverified', 'forms': forms,
                 'meaning': row.get('meaning', '')}
        if not KANJI_RUN.search(word):
            entry['reading_status'] = 'verified'  # nothing to verify: kana-only word
        for key in ('simple', 'similar', 'memo'):
            if row.get(key):
                entry[key] = row[key]
        if not any(form in full_text for form in forms):
            entry['_note'] = '正文里没有找到这个词形'
        entries.append(entry)
    return entries


def build(args) -> tuple[dict, dict, list[str]]:
    title, paragraphs = read_paragraphs(Path(args.text))
    if not paragraphs:
        raise SystemExit('课文为空')
    translations: list[str] = []
    if args.translation:
        _, translations = read_paragraphs(Path(args.translation))
        if len(translations) != len(paragraphs):
            raise SystemExit(f'译文段落数 {len(translations)} 与课文段落数 {len(paragraphs)} 不一致')
    full = '\n'.join(paragraphs)
    vocab = read_vocab(Path(args.vocab), full) if args.vocab else []
    notes = [f"词条「{e['word']}」：{e.pop('_note')}" for e in vocab if '_note' in e]
    lesson = {
        'id': args.lesson_id, 'title': args.lesson_title or title or args.lesson_id, 'source': args.source,
        'status': '由 import_text.py 生成：注音与译文尚未人工核对。',
        'paragraphs': [{'text': p, 'ruby': None, 'ruby_status': 'unverified',
                        **({'translation': {'text': translations[i], 'status': args.translation_status}} if translations else {})}
                       for i, p in enumerate(paragraphs)],
        'vocabulary': vocab, 'grammar': [], 'exercises': [], 'listening': [],
    }
    pack = {
        'format': packlib.PACK_FORMAT, 'version': packlib.PACK_VERSION, 'id': args.id, 'title': args.title or lesson['title'],
        'revision': date.today().isoformat(), 'language': 'ja', 'translation_language': args.translation_language,
        'license': args.license, 'description': '由 tools/import_text.py 从纯文本与 CSV 生成的最小课程包。',
        'lessons': [{'id': args.lesson_id, 'file': f'lessons/{args.lesson_id}.json'}],
    }
    return pack, lesson, notes


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--text', required=True, help='plain-text lesson, paragraphs separated by blank lines')
    parser.add_argument('--vocab', help='CSV word list (word, reading, meaning[, forms, simple, similar, memo])')
    parser.add_argument('--translation', help='plain-text translation with the same paragraph count')
    parser.add_argument('--translation-status', default='unverified', choices=['human', 'machine', 'unverified'])
    parser.add_argument('--translation-language', default='zh')
    parser.add_argument('--out', required=True, help='output pack directory (created; must not exist)')
    parser.add_argument('--id', required=True, help='pack id: lowercase letters, digits, hyphens')
    parser.add_argument('--title', help='pack title (default: lesson title)')
    parser.add_argument('--lesson-id', default='01')
    parser.add_argument('--lesson-title')
    parser.add_argument('--source', default='', help='where the text comes from (shown under the title)')
    parser.add_argument('--license', default='UNLICENSED', help='content license, e.g. CC-BY-4.0 or "私人材料，不分发"')
    args = parser.parse_args(argv)
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', args.id):
        parser.error('--id 只能用小写字母、数字和连字符')
    if not packlib.ID_PATTERN.fullmatch(args.lesson_id):
        parser.error('--lesson-id 只能用字母、数字、下划线和连字符')
    out = Path(args.out)
    if out.exists():
        parser.error(f'{out} 已存在；请指定新目录')
    pack, lesson, notes = build(args)
    (out / 'lessons').mkdir(parents=True)
    (out / 'media').mkdir()
    (out / 'pack.json').write_text(json.dumps(pack, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (out / 'lessons' / f'{args.lesson_id}.json').write_text(json.dumps(lesson, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'已生成 {out}：{len(lesson["paragraphs"])} 段，{len(lesson["vocabulary"])} 个词条。')
    for note in notes:
        print('提醒：' + note)
    print('下一步：补注音（漢字[かんじ]）与译文，把 unverified 改成 human；然后运行 python3 tools/validate_pack.py ' + str(out))
    return 0


if __name__ == '__main__':
    sys.exit(main())
