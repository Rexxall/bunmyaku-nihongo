#!/usr/bin/env python3
"""Turn a plain-text lesson and a word list into a minimal course pack. No AI, no network.

    python3 tools/import_text.py --text lesson.txt --vocab words.csv --out my-pack \
        --id my-pack --title "我的课程" --lesson-title "第一课"
    python3 tools/import_text.py --text lesson.txt --vocab deck.txt --map word=1,meaning=2 --out my-pack --id my-pack

Text file: paragraphs separated by blank lines. A first line starting with ``# `` becomes the
lesson title. ``--translation`` takes a second text file with the same number of paragraphs.
CSV columns (header required, extra columns ignored): ``word, reading, meaning`` plus optional
``forms`` (``／``-separated word forms found in the text), ``simple``, ``similar``, ``memo``.
Anki word lists: a "Notes in Plain Text" export (``.txt``, tab-separated, ``#`` header lines allowed)
or a legacy ``.apkg`` (exported with "Support older Anki versions"). ``--map`` says which field is
which, by 1-based number or by field name: ``--map word=Expression,reading=Reading,meaning=Meaning``.
Without ``--map`` the first field is the word and the second the meaning. HTML and ``[sound:…]`` are
removed; Anki-style furigana ``日本[にほん]語[ご]`` gives the plain word and, if no reading is mapped,
the reading.
Readings and translations are marked ``unverified`` until a person checks them; run
``tools/validate_pack.py`` afterwards and read its warnings.
"""
from __future__ import annotations

import argparse
import csv
import html
import json
import re
import sqlite3
import sys
import tempfile
import zipfile
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import packlib  # noqa: E402

KANJI_RUN = re.compile(r'[一-龯々〆〇]+')
FURIGANA = re.compile(r' ?([^ \[\]]+?)\[([^\]]*)\]')
FIELDS = ('word', 'reading', 'meaning', 'forms', 'simple', 'similar', 'memo')
SEPARATORS = {'comma': ',', 'semicolon': ';', 'tab': '\t', 'space': ' ', 'pipe': '|', 'colon': ':'}


def read_paragraphs(path: Path) -> tuple[str | None, list[str]]:
    raw = path.read_text(encoding='utf-8').replace('\r\n', '\n').strip()
    title = None
    if raw.startswith('# '):
        first, _, rest = raw.partition('\n')
        title, raw = first[2:].strip(), rest.strip()
    paragraphs = [re.sub(r'\s*\n\s*', '', block).strip() for block in re.split(r'\n\s*\n', raw) if block.strip()]
    return title, paragraphs


def anki_text(value: str) -> str:
    """Anki field → plain text: drop sound tags and HTML, keep line breaks as ／."""
    value = re.sub(r'\[sound:[^\]]*\]', '', value)
    value = re.sub(r'(?i)<br\s*/?>|</div>|</p>', '／', value)
    value = html.unescape(re.sub(r'<[^>]+>', '', value)).replace('\xa0', ' ')
    return re.sub(r'(／\s*)+', '／', value).strip(' ／')


def split_furigana(value: str) -> tuple[str, str]:
    """``日本[にほん]語[ご]`` → (``日本語``, ``にほんご``). Text without brackets is returned unchanged twice."""
    if '[' not in value:
        return value, value
    return FURIGANA.sub(r'\1', value).strip(), FURIGANA.sub(r'\2', value).replace(' ', '').strip()


def parse_map(spec: str | None) -> dict[str, str]:
    if not spec:
        return {'word': '1', 'meaning': '2'}
    out = {}
    for part in spec.split(','):
        key, _, value = part.partition('=')
        key = key.strip().lower()
        if key not in FIELDS or not value.strip():
            raise SystemExit(f'--map 写法：word=1,reading=2,meaning=3（可用字段 {"、".join(FIELDS)}）；无法理解「{part}」')
        out[key] = value.strip()
    if 'word' not in out:
        raise SystemExit('--map 必须指明 word 是哪一列')
    return out


def map_rows(records: list[list[str]], names: list[str], mapping: dict[str, str]) -> list[dict]:
    index = {}
    for key, ref in mapping.items():
        if ref.isdigit():
            index[key] = int(ref) - 1
        elif ref in names:
            index[key] = names.index(ref)
        else:
            raise SystemExit(f'--map {key}={ref}：没有这一列' + (f'（可用：{"、".join(names)}）' if names else '，请用列号'))
    rows = []
    for record in records:
        row = {key: anki_text(record[i]) if i < len(record) else '' for key, i in index.items()}
        word, kana = split_furigana(row['word'])
        row['word'] = word
        if row.get('reading'):
            row['reading'] = split_furigana(row['reading'])[1]
        elif kana != word:
            row['reading'] = kana
        rows.append(row)
    return rows


def read_anki_text(path: Path, mapping: dict[str, str]) -> list[dict]:
    lines = path.read_text(encoding='utf-8-sig').splitlines()
    headers = {}
    while lines and lines[0].startswith('#') and ':' in lines[0]:
        key, _, value = lines.pop(0)[1:].partition(':')
        headers[key.strip().lower()] = value.strip()
    sep = headers.get('separator', 'tab')
    sep = SEPARATORS.get(sep.lower(), sep[:1] or '\t')
    records = [r for r in csv.reader(lines, delimiter=sep) if any(x.strip() for x in r)]
    names = [x.strip() for x in headers['columns'].split(sep)] if 'columns' in headers else []
    return map_rows(records, names, mapping)


def read_apkg(path: Path, mapping: dict[str, str]) -> list[dict]:
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        member = next((n for n in ('collection.anki21', 'collection.anki2') if n in names), None)
        if member is None:
            raise SystemExit('这个 .apkg 是新版压缩格式，Python 标准库读不了。请在 Anki 导出时勾选'
                             '“Support older Anki versions”，或改用“Notes in Plain Text”导出 .txt。')
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / 'collection.sqlite'
            db_path.write_bytes(z.read(member))
            db = sqlite3.connect(db_path)
            try:
                models = json.loads(db.execute('select models from col').fetchone()[0] or '{}')
                notes = db.execute('select mid, flds from notes order by id').fetchall()
            finally:
                db.close()
    if not notes:
        return []
    first = str(notes[0][0])
    fields = [f['name'] for f in sorted(models.get(first, {}).get('flds', []), key=lambda f: f.get('ord', 0))]
    records = [flds.split('\x1f') for mid, flds in notes if str(mid) == first]
    if len(records) < len(notes):
        print(f'提醒：牌组里有 {len(notes) - len(records)} 条笔记属于其他笔记类型，已跳过；只导入第一种（{"、".join(fields)}）。')
    return map_rows(records, fields, mapping)


def read_csv(path: Path) -> list[dict]:
    with path.open(encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames or not {'word', 'reading', 'meaning'} <= {h.strip().lower() for h in reader.fieldnames}:
            raise SystemExit('词表 CSV 需要表头 word, reading, meaning（可选 forms, simple, similar, memo）')
        return [{(k or '').strip().lower(): (v or '').strip() for k, v in row.items()} for row in reader]


def read_vocab(path: Path, full_text: str, mapping: str | None = None) -> list[dict]:
    suffix = path.suffix.lower()
    if suffix == '.apkg':
        rows = read_apkg(path, parse_map(mapping))
    elif suffix in ('.txt', '.tsv') or mapping:
        rows = read_anki_text(path, parse_map(mapping))
    else:
        rows = read_csv(path)
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
        elif KANJI_RUN.search(word) and not entry['reading']:
            entry['_note'] = '缺读音，请补纯假名 reading（校验器会报错）'
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
    vocab = read_vocab(Path(args.vocab), full, args.map) if args.vocab else []
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
    packlib.safe_console()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--text', required=True, help='plain-text lesson, paragraphs separated by blank lines')
    parser.add_argument('--vocab', help='word list: CSV with a header, Anki plain-text export (.txt) or legacy .apkg')
    parser.add_argument('--map', help='Anki fields, by number or name: word=1,reading=2,meaning=3 (default word=1,meaning=2)')
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
