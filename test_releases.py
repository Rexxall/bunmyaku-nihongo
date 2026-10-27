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
                manifest = json.loads((releases / 'first/manifest.json').read_text())
                self.assertEqual(manifest['pack']['id'], 'demo-pack')
                self.assertIn('materials/index.html', manifest['files'])
                self.assertIn('content/media/02-counter.wav', manifest['files'])
                self.assertIn('code/src/app.js', manifest['files'])
                with self.assertRaises(ValueError):
                    m.create('first', packlib.DEFAULT_CONTENT)
                with self.assertRaises(ValueError):
                    m.publish('first')  # not checked yet
                (local / 'checks').mkdir()
                (local / 'checks/first.sha256').write_text(m.digest(releases / 'first/manifest.json'))
                m.publish('first')
                self.assertEqual((local / 'current').resolve().name, 'first')
                shutil.copytree(releases / 'first', releases / 'next')
                (local / 'checks/next.sha256').write_text(m.digest(releases / 'next/manifest.json'))
                m.publish('next')
                self.assertEqual((local / 'current').resolve().name, 'next')
                m.publish('first')
                self.assertEqual((local / 'current').resolve().name, 'first')
                page = releases / 'next' / m.PAGE
                page.write_text(page.read_text() + '<!-- tampered -->')
                with self.assertRaises(ValueError):
                    m.publish('next')
                self.assertEqual((local / 'current').resolve().name, 'first')
                with self.assertRaises(ValueError):
                    m.release('../escape')


if __name__ == '__main__':
    unittest.main()
