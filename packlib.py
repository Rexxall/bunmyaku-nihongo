"""Course pack (Pack v1) loading shared by the server, the release manager and the tools.

A pack is a directory with ``pack.json`` and, usually, ``lessons/*.json`` and ``media/``.
Nothing here renders HTML; it only resolves files, inlines lessons and lists the media
files the server may serve. Validation with readable messages lives in tools/validate_pack.py.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

PACK_FORMAT = 'bunmyaku-pack'
PACK_VERSION = 1
ID_PATTERN = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}')
MEDIA_TYPES = {
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
    '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.webm': 'audio/webm',
}
BASE = Path(__file__).resolve().parent
DEFAULT_CONTENT = BASE / 'examples' / 'demo-pack'


class PackError(ValueError):
    """Raised when a pack cannot be loaded at all (missing or unreadable files)."""


def safe_console() -> None:
    """Chinese messages must not crash a command whose output goes to a non-UTF-8 pipe (Windows)."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(errors='backslashreplace')


def resolve_content_dir(arg: str | None = None) -> Path:
    """``--content`` argument > ``BUNMYAKU_CONTENT`` > bundled demo pack."""
    value = arg or os.environ.get('BUNMYAKU_CONTENT', '').strip()
    path = Path(value).expanduser() if value else DEFAULT_CONTENT
    return path.resolve()


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        raise PackError(f'找不到文件：{path}')
    except json.JSONDecodeError as e:
        raise PackError(f'{path.name} 不是合法 JSON：第 {e.lineno} 行第 {e.colno} 列，{e.msg}')


def safe_child(root: Path, relative: str) -> Path:
    """Resolve ``relative`` under ``root``; refuse absolute paths and ``..`` escapes."""
    if not isinstance(relative, str) or not relative or relative.startswith(('/', '\\')) or '\x00' in relative:
        raise PackError(f'非法相对路径：{relative!r}')
    candidate = (root / relative).resolve()
    if root.resolve() not in candidate.parents:
        raise PackError(f'路径越出课程包目录：{relative}')
    return candidate


def load_pack(content_dir: Path) -> dict:
    """Return pack.json with every lesson inlined under ``lessons``.

    Each lesson gets ``_file`` (relative path or None) so validators can point at the source.
    """
    content_dir = Path(content_dir)
    manifest = read_json(content_dir / 'pack.json')
    if not isinstance(manifest, dict):
        raise PackError('pack.json 顶层必须是对象')
    lessons = manifest.get('lessons')
    if not isinstance(lessons, list):
        raise PackError('pack.json 缺少 lessons 列表')
    inlined = []
    for i, entry in enumerate(lessons):
        if not isinstance(entry, dict):
            raise PackError(f'lessons[{i}] 必须是对象')
        if 'file' in entry:
            path = safe_child(content_dir, entry['file'])
            lesson = read_json(path)
            if not isinstance(lesson, dict):
                raise PackError(f'{entry["file"]} 顶层必须是对象')
            lesson = {**lesson, '_file': entry['file']}
            if 'id' in entry and lesson.get('id') not in (None, entry['id']):
                raise PackError(f'lessons[{i}] 的 id {entry["id"]!r} 与 {entry["file"]} 内的 id {lesson.get("id")!r} 不一致')
            lesson.setdefault('id', entry.get('id'))
        else:
            lesson = {**entry, '_file': None}
        inlined.append(lesson)
    pack = {**manifest, 'lessons': inlined}
    pack['_dir'] = str(content_dir)
    return pack


def media_references(pack: dict) -> list[str]:
    """Relative media paths referenced by lessons plus any listed under pack['media']."""
    refs: list[str] = []
    for lesson in pack.get('lessons', []):
        for item in lesson.get('listening', []) or []:
            audio = item.get('audio') if isinstance(item, dict) else None
            if isinstance(audio, str) and audio:
                refs.append(audio)
    for entry in pack.get('media', []) or []:
        path = entry.get('path') if isinstance(entry, dict) else entry
        if isinstance(path, str) and path:
            refs.append(path)
    seen: list[str] = []
    for r in refs:
        if r not in seen:
            seen.append(r)
    return seen


def media_files(pack: dict) -> dict[str, Path]:
    """Map URL path (``/media/x.wav``) to the file on disk, for the server allowlist.

    Only files that exist, sit inside the pack directory and have a known audio suffix are
    included; everything else is silently left out so a typo can never expose a directory.
    """
    root = Path(pack['_dir'])
    out: dict[str, Path] = {}
    for relative in media_references(pack):
        try:
            file = safe_child(root, relative)
        except PackError:
            continue
        if file.suffix.lower() in MEDIA_TYPES and file.is_file():
            out['/' + relative.replace(os.sep, '/')] = file
    return out


def public_pack(pack: dict) -> dict:
    """The pack as sent to the browser: no filesystem details."""
    clean = {k: v for k, v in pack.items() if not k.startswith('_')}
    clean['lessons'] = [{k: v for k, v in lesson.items() if not k.startswith('_')} for lesson in pack['lessons']]
    return clean


if __name__ == '__main__':
    target = resolve_content_dir(sys.argv[1] if len(sys.argv) > 1 else None)
    loaded = load_pack(target)
    print(f"{loaded.get('title')} · {len(loaded['lessons'])} lessons · media: {sorted(media_files(loaded))}")
