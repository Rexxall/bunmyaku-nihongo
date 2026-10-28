"""Pack loader, validator and importer tests (demo pack must validate cleanly)."""
import copy
import json
import shutil
import sqlite3
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

import packlib

sys.path.insert(0, str(Path(__file__).with_name('tools')))
import export_static  # noqa: E402
import import_text  # noqa: E402
import validate_pack  # noqa: E402


def write_pack(folder: Path, pack: dict, lessons: dict) -> None:
    (folder / 'lessons').mkdir(parents=True, exist_ok=True)
    (folder / 'pack.json').write_text(json.dumps(pack, ensure_ascii=False), encoding='utf-8')
    for name, lesson in lessons.items():
        (folder / 'lessons' / f'{name}.json').write_text(json.dumps(lesson, ensure_ascii=False), encoding='utf-8')


class DemoPack(unittest.TestCase):
    def test_demo_pack_is_clean(self):
        rep = validate_pack.validate(packlib.DEFAULT_CONTENT)
        self.assertEqual(rep.errors, [])
        self.assertEqual(rep.warnings, [])
        self.assertEqual(rep.covered, rep.runs)
        self.assertGreater(rep.runs, 100)

    def test_loader_inlines_lessons_and_lists_media(self):
        pack = packlib.load_pack(packlib.DEFAULT_CONTENT)
        self.assertEqual([l['id'] for l in pack['lessons']], ['01', '02'])
        self.assertEqual(list(packlib.media_files(pack)), ['/media/02-counter.wav'])
        public = packlib.public_pack(pack)
        self.assertNotIn('_dir', public)
        self.assertNotIn('_file', public['lessons'][0])


class Validator(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        shutil.copytree(packlib.DEFAULT_CONTENT, self.tmp / 'pack')
        self.folder = self.tmp / 'pack'
        self.lesson_path = self.folder / 'lessons/01.json'
        self.lesson = json.loads(self.lesson_path.read_text(encoding='utf-8'))

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def run_with(self, lesson):
        self.lesson_path.write_text(json.dumps(lesson, ensure_ascii=False), encoding='utf-8')
        return validate_pack.validate(self.folder)

    def test_ruby_mismatch_and_missing_reading(self):
        lesson = copy.deepcopy(self.lesson)
        lesson['paragraphs'][0]['ruby'] = lesson['paragraphs'][0]['ruby'].replace('去年[きょねん]', '去年')
        rep = self.run_with(lesson)
        self.assertTrue(any('有汉字没有注音' in e and '去年' in e for e in rep.errors), rep.errors)
        lesson['paragraphs'][0]['ruby'] = lesson['paragraphs'][0]['ruby'].replace('春[はる]', '春[hr]')
        rep = self.run_with(lesson)
        self.assertTrue(any('不是纯假名' in e for e in rep.errors), rep.errors)
        lesson['paragraphs'][0]['ruby'] = '別の文[ぶん]'
        rep = self.run_with(lesson)
        self.assertTrue(any('与 text 不一致' in e for e in rep.errors), rep.errors)

    def test_unverified_counts_and_status_values(self):
        lesson = copy.deepcopy(self.lesson)
        lesson['paragraphs'][1]['ruby_status'] = 'unverified'
        lesson['paragraphs'][1]['translation']['status'] = 'machine'
        rep = self.run_with(lesson)
        self.assertEqual(rep.errors, [])
        self.assertEqual(rep.unverified, 1)
        lesson['paragraphs'][1]['translation']['status'] = 'guess'
        rep = self.run_with(lesson)
        self.assertTrue(any('translation.status' in e for e in rep.errors), rep.errors)

    def test_exercise_answers(self):
        lesson = copy.deepcopy(self.lesson)
        lesson['exercises'][0]['items'][0]['answers'] = ['a', 'b']
        lesson['exercises'][1]['items'][0]['answer'] = '不在选项里'
        lesson['exercises'][2]['items'][0]['id'] = 'fill-1'
        rep = self.run_with(lesson)
        self.assertTrue(any('数量不一致' in e for e in rep.errors), rep.errors)
        self.assertTrue(any('与某个选项完全一致' in e for e in rep.errors), rep.errors)
        self.assertTrue(any('题目 id 重复：fill-1' in e for e in rep.errors), rep.errors)

    def test_media_and_forms_warnings(self):
        lesson2 = json.loads((self.folder / 'lessons/02.json').read_text(encoding='utf-8'))
        lesson2['listening'][0]['audio'] = 'media/none.wav'
        (self.folder / 'lessons/02.json').write_text(json.dumps(lesson2, ensure_ascii=False), encoding='utf-8')
        lesson = copy.deepcopy(self.lesson)
        lesson['vocabulary'][0]['forms'] = ['正文里没有的词形']
        rep = self.run_with(lesson)
        self.assertTrue(any('文件不存在' in e for e in rep.errors), rep.errors)
        self.assertTrue(any('正文里找不到' in w for w in rep.warnings), rep.warnings)
        lesson2['listening'][0]['audio'] = '../../etc/passwd'
        (self.folder / 'lessons/02.json').write_text(json.dumps(lesson2, ensure_ascii=False), encoding='utf-8')
        rep = self.run_with(lesson)
        self.assertTrue(any('越出' in e for e in rep.errors), rep.errors)

    def test_manifest_fields(self):
        pack = json.loads((self.folder / 'pack.json').read_text(encoding='utf-8'))
        pack['id'] = 'Bad ID'
        del pack['license']
        (self.folder / 'pack.json').write_text(json.dumps(pack, ensure_ascii=False), encoding='utf-8')
        rep = validate_pack.validate(self.folder)
        self.assertTrue(any('pack.json.id' in e for e in rep.errors), rep.errors)
        self.assertTrue(any('pack.json.license' in e for e in rep.errors), rep.errors)
        self.assertEqual(validate_pack.main([str(self.folder)]), 1)


class Importer(unittest.TestCase):
    def test_text_and_csv_become_a_valid_pack(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / 'lesson.txt').write_text('# 朝の散歩\n\n毎朝、公園を\n歩く。\n\n犬も一緒だ。\n', encoding='utf-8')
            (tmp / 'words.csv').write_text('word,reading,meaning,forms\n公園,こうえん,公园,公園\n歩く,あるく,走路,歩く\nいっしょ,,一起,一緒\n', encoding='utf-8')
            (tmp / 'zh.txt').write_text('每天早上在公园散步。\n\n狗也一起。\n', encoding='utf-8')
            out = tmp / 'out'
            code = import_text.main(['--text', str(tmp / 'lesson.txt'), '--vocab', str(tmp / 'words.csv'), '--translation', str(tmp / 'zh.txt'),
                                     '--out', str(out), '--id', 'walk', '--license', 'CC0-1.0'])
            self.assertEqual(code, 0)
            pack = packlib.load_pack(out)
            lesson = pack['lessons'][0]
            self.assertEqual(lesson['title'], '朝の散歩')
            self.assertEqual([p['text'] for p in lesson['paragraphs']], ['毎朝、公園を歩く。', '犬も一緒だ。'])
            self.assertEqual(lesson['paragraphs'][0]['translation'], {'text': '每天早上在公园散步。', 'status': 'unverified'})
            self.assertEqual(lesson['vocabulary'][0]['reading_status'], 'unverified')
            self.assertEqual(lesson['vocabulary'][2]['reading_status'], 'verified')
            rep = validate_pack.validate(out)
            self.assertEqual(rep.errors, [], rep.errors)
            self.assertTrue(any('缺少注音' in w for w in rep.warnings))

    def import_words(self, tmp: Path, vocab: Path, *extra: str, errors: int = 0) -> list[dict]:
        (tmp / 'lesson.txt').write_text('毎朝、公園を歩く。日本語を勉強する。\n', encoding='utf-8')
        out = tmp / 'out'
        code = import_text.main(['--text', str(tmp / 'lesson.txt'), '--vocab', str(vocab), *extra, '--out', str(out), '--id', 'anki', '--license', 'CC0-1.0'])
        self.assertEqual(code, 0)
        self.assertEqual(len(validate_pack.validate(out).errors), errors)
        return packlib.load_pack(out)['lessons'][0]['vocabulary']

    def test_anki_plain_text_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            deck = tmp / 'deck.txt'
            deck.write_text('#separator:tab\n#html:true\n#columns:Expression\tMeaning\tAudio\n'
                            ' 公園[こうえん]\t公园<br>park\t[sound:a.mp3]\n'
                            ' 日本[にほん] 語[ご]\t日语&amp;日本话\t\n', encoding='utf-8')
            words = self.import_words(tmp, deck, '--map', 'word=Expression,meaning=Meaning')
            self.assertEqual([(w['word'], w['reading'], w['meaning']) for w in words],
                             [('公園', 'こうえん', '公园／park'), ('日本語', 'にほんご', '日语&日本话')])
            self.assertEqual({w['reading_status'] for w in words}, {'unverified'})

    def test_legacy_apkg(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            db_path = tmp / 'collection.anki2'
            db = sqlite3.connect(db_path)
            db.execute('create table col (models text)')
            db.execute('create table notes (id integer, mid integer, flds text)')
            model = {'1': {'flds': [{'name': 'Reading', 'ord': 1}, {'name': 'Front', 'ord': 0}, {'name': 'Back', 'ord': 2}]}}
            db.execute('insert into col values (?)', (json.dumps(model),))
            db.executemany('insert into notes values (?, 1, ?)', [(1, '歩く\x1fあるく\x1f走路'), (2, '公園\x1f\x1f公园')])
            db.commit(); db.close()
            apkg = tmp / 'deck.apkg'
            with zipfile.ZipFile(apkg, 'w') as z:
                z.write(db_path, 'collection.anki2')
                z.writestr('media', '{}')
            words = self.import_words(tmp, apkg, '--map', 'word=Front,reading=Reading,meaning=Back', errors=1)  # 公園 has no reading: the importer never guesses one
            self.assertEqual([(w['word'], w['reading'], w['meaning']) for w in words], [('歩く', 'あるく', '走路'), ('公園', '', '公园')])

    def test_new_apkg_format_explains_the_way_out(self):
        with tempfile.TemporaryDirectory() as tmp:
            apkg = Path(tmp) / 'deck.apkg'
            with zipfile.ZipFile(apkg, 'w') as z:
                z.writestr('collection.anki21b', b'zstd')
            with self.assertRaises(SystemExit) as caught:
                import_text.read_vocab(apkg, '')
            self.assertIn('Support older Anki versions', str(caught.exception))


class StaticExport(unittest.TestCase):
    def test_demo_pack_exports_page_and_audio(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'site'
            written = export_static.export(packlib.DEFAULT_CONTENT, out)
            page = (out / 'index.html').read_text(encoding='utf-8')
            self.assertIn('data-static="1"', page)
            self.assertNotIn('@@', page)
            self.assertIn('"id": "demo-pack"', page)
            self.assertTrue((out / 'media' / '02-counter.wav').is_file())
            self.assertEqual(len(written), 2)
            self.assertFalse(any(p.suffix == '.json' for p in out.rglob('*')))


if __name__ == '__main__':
    unittest.main()
