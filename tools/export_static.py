#!/usr/bin/env python3
"""Export a course pack as a static demo page (no tutor), e.g. for GitHub Pages.

    python3 tools/export_static.py examples/demo-pack --out _site

Writes index.html (the same page serve.py assembles, marked as static) and copies the audio
files the pack references. Reading, words, grammar, exercises, listening and notes all work;
the tutor needs the local server and is shown as unavailable. Only publish packs whose
content you have the right to share.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import packlib  # noqa: E402
import serve  # noqa: E402

MARK = '<html lang="zh-CN">'


def export(content_dir: Path, out: Path) -> list[Path]:
    content = serve.load_content(content_dir)
    page = serve.build_page(serve.SRC, content['pack'])
    if page.count(MARK) != 1:
        raise ValueError('页面模板的 <html> 标签已改，静态导出需要同步更新')
    out.mkdir(parents=True, exist_ok=True)
    written = [out / 'index.html']
    written[0].write_text(page.replace(MARK, '<html lang="zh-CN" data-static="1">'), encoding='utf-8')
    for url, file in sorted(content['media'].items()):
        target = out / url.lstrip('/')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, target)
        written.append(target)
    return written


def main(argv=None) -> int:
    packlib.safe_console()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('content', type=Path, help='课程包目录')
    parser.add_argument('--out', type=Path, required=True, help='输出目录')
    args = parser.parse_args(argv)
    try:
        written = export(args.content, args.out)
    except (packlib.PackError, OSError, ValueError) as e:
        print('导出失败：' + str(e), file=sys.stderr)
        return 1
    print(f'已导出 {len(written)} 个文件到 {args.out}；答疑在静态页里不可用。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
