"""Release gates: create → check stamp → publish/rollback → tamper rejection, using the demo pack."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import manage as m
import packlib


class Releases(unittest.TestCase):
    def test_create_verify_publish_rollback(self):
        with tempfile.TemporaryDirectory() as tmp:
            local = Path(tmp) / 'local'
            releases = local / 'releases'
            with patch.object(m, 'LOCAL', local), patch.object(m, 'RELEASES', releases):
                m.create('first', packlib.DEFAULT_CONTENT)
                manifest = json.loads((releases / 'first/manifest.json').read_text(encoding='utf-8'))
                self.assertEqual(manifest['pack']['id'], 'demo-pack')
                self.assertIn('materials/index.html', manifest['files'])
                self.assertIn('content/media/02-counter.wav', manifest['files'])
                self.assertIn('code/src/app.js', manifest['files'])
                with self.assertRaises(ValueError):
                    m.create('first', packlib.DEFAULT_CONTENT)
                with self.assertRaises(ValueError):
                    m.publish('first')  # not checked yet
                (local / 'checks').mkdir()
                (local / 'checks/first.sha256').write_text(m.digest(releases / 'first/manifest.json'), encoding='utf-8')
                m.publish('first')
                self.assertEqual(m.current_release().name, 'first')
                shutil.copytree(releases / 'first', releases / 'next')
                (local / 'checks/next.sha256').write_text(m.digest(releases / 'next/manifest.json'), encoding='utf-8')
                m.publish('next')
                self.assertEqual(m.current_release().name, 'next')
                m.publish('first')
                self.assertEqual(m.current_release().name, 'first')
                page = releases / 'next' / m.PAGE
                page.write_text(page.read_text(encoding='utf-8') + '<!-- tampered -->', encoding='utf-8')
                with self.assertRaises(ValueError):
                    m.publish('next')
                self.assertEqual(m.current_release().name, 'first')
                with self.assertRaises(ValueError):
                    m.release('../escape')
                self.assertEqual((local / 'current').read_text(encoding='utf-8').strip(), 'first')

    def test_legacy_symlink_pointer_is_still_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            local = Path(tmp) / 'local'
            releases = local / 'releases'
            (releases / 'old').mkdir(parents=True)
            try:
                (local / 'current').symlink_to(releases / 'old')
            except OSError:
                self.skipTest('this system does not allow symlinks')
            with patch.object(m, 'LOCAL', local), patch.object(m, 'RELEASES', releases):
                self.assertEqual(m.current_release().name, 'old')


if __name__ == '__main__':
    unittest.main()


class Extension(unittest.TestCase):
    """The browser extension ships with the release: same version, every message in every language, no missing file."""

    def test_manifest_matches_release_and_locales(self):
        import re
        import bunmyaku
        root = Path(__file__).resolve().parent / 'extension'
        manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['manifest_version'], 3)
        self.assertEqual(manifest['version'], bunmyaku.__version__)
        self.assertNotIn('host_permissions', manifest)
        self.assertEqual(sorted(manifest['permissions']), ['activeTab', 'contextMenus', 'scripting', 'storage'])
        used = set(re.findall(r'__MSG_(\w+)__', json.dumps(manifest)))
        for source in ('background.js', 'options.js', 'options.html'):
            text = (root / source).read_text(encoding='utf-8')
            used |= set(re.findall(r"(?:getMessage|msg)\('(\w+)'\)", text)) | set(re.findall(r'data-msg="(\w+)"', text))
        locales = {d.name: set(json.loads((d / 'messages.json').read_text(encoding='utf-8'))) for d in (root / '_locales').iterdir()}
        self.assertEqual(set(locales), {'en', 'ja', 'zh_CN'})
        self.assertIn(manifest['default_locale'], locales)
        for name, keys in locales.items():
            self.assertEqual(keys, locales['en'], name)
            self.assertLessEqual(used, keys, name)
        files = [manifest['background']['service_worker'], manifest['options_ui']['page'], *manifest['icons'].values(), *manifest['action']['default_icon'].values()]
        for name in files:
            self.assertTrue((root / name).is_file(), name)


class Appearance(unittest.TestCase):
    """Light and dark come from the tokens in glass.css, so the older stylesheets must not hard-code colours."""

    def test_layout_styles_use_tokens_only(self):
        import re
        src = Path(__file__).resolve().parent / 'src'
        for name in ('base.css', 'theme.css', 'app.css'):
            text = re.sub(r'@media print\{(?:[^{}]|\{[^{}]*\})*\}', '', (src / name).read_text(encoding='utf-8'))
            values = re.findall(r'[\w-]+\s*:\s*([^;{}]+)', text)
            fixed = [v for v in values if re.search(r'#[0-9a-fA-F]{3,8}\b|(?<![\w-])(?:white|black)(?![\w-])', v)]
            self.assertEqual(fixed, [], name)
        page = (src / 'page.html').read_text(encoding='utf-8')
        self.assertLess(page.index('@@SOURCE:app.css@@'), page.index('@@SOURCE:apple-kit.css@@'))
        self.assertLess(page.index('@@SOURCE:apple-kit.css@@'), page.index('@@SOURCE:glass.css@@'))
        self.assertIn('<body class="ap">', page)
