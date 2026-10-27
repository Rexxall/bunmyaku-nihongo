#!/usr/bin/env python3
"""Local, immutable study releases: snapshot the code and a course pack, verify, publish, roll back.

A release is a folder under .local/releases/<name> holding ``code/`` (this repository's
sources), ``content/`` (a copy of the course pack) and ``materials/index.html`` (the page built
from both), plus a SHA-256 manifest. ``publish`` switches an atomic ``current`` pointer and
``run`` supervises a server that follows that pointer. Nothing here touches Git.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import packlib

BASE = Path(__file__).resolve().parent
LOCAL = BASE / '.local'
RELEASES = LOCAL / 'releases'
CODE_FILES = ['serve.py', 'packlib.py', 'manage.py', 'configure_ai.py', 'bunmyaku.command', 'bunmyaku.bat', 'test_server.py', 'test_releases.py',
              'test_pack_tools.py', 'README.md', 'LICENSE']
PAGE = Path('materials/index.html')


def digest(p: Path) -> str:
    h = hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def release(name: str) -> Path:
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}', name):
        raise ValueError('版本名称只能包含英文字母、数字、点、横线和下划线')
    return RELEASES / name


def build(code: Path, content: Path) -> str:
    import serve
    pack = packlib.load_pack(content)
    return serve.build_page(code / 'src', pack)


def create(name: str, content_dir: Path) -> None:
    dest = release(name)
    if dest.exists():
        raise ValueError('版本已存在，不能覆盖；请使用新版本号')
    pack = packlib.load_pack(content_dir)  # fail early on a broken pack
    RELEASES.mkdir(parents=True, exist_ok=True)
    temp = RELEASES / ('.building-' + name)
    if temp.exists():
        raise ValueError('存在未完成构建，请检查 ' + str(temp))
    temp.mkdir()
    try:
        shutil.copytree(BASE / 'src', temp / 'code/src')
        (temp / 'code/tools').mkdir()
        for f in CODE_FILES:
            if (BASE / f).exists():
                shutil.copy2(BASE / f, temp / 'code' / f)
        for f in (BASE / 'tools').glob('*.py'):
            shutil.copy2(f, temp / 'code/tools' / f.name)
        shutil.copytree(BASE / 'bunmyaku', temp / 'code/bunmyaku', ignore=shutil.ignore_patterns('__pycache__'))
        shutil.copytree(content_dir, temp / 'content', ignore=shutil.ignore_patterns('.*', '__pycache__'))
        target = temp / PAGE
        target.parent.mkdir(parents=True)
        target.write_text(build(temp / 'code', temp / 'content'), encoding='utf-8')
        files = {str(p.relative_to(temp)): digest(p) for p in sorted(temp.rglob('*')) if p.is_file()}
        try:
            revision = subprocess.check_output(['git', '-C', str(BASE), 'rev-parse', 'HEAD'], text=True, stderr=subprocess.DEVNULL).strip()
        except (OSError, subprocess.SubprocessError):
            revision = None
        manifest = {'version': name, 'created': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'base_commit': revision,
                    'pack': {'id': pack.get('id'), 'title': pack.get('title'), 'revision': pack.get('revision')},
                    'files': files, 'scope': 'Application code, course pack and built page; excludes API keys and browser records.'}
        (temp / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temp.rename(dest)
    except Exception:
        shutil.rmtree(temp)
        raise
    print('已创建本地完整版本：' + str(dest))


def verify(name: str) -> Path:
    folder = release(name)
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
    actual = {str(p.relative_to(folder)) for p in folder.rglob('*') if p.is_file()} - {'manifest.json'}
    if actual != set(manifest['files']):
        raise ValueError('版本文件清单不匹配')
    for file, expected in manifest['files'].items():
        p = folder / file
        if not p.resolve().is_relative_to(folder.resolve()) or digest(p) != expected:
            raise ValueError('版本文件校验失败：' + file)
    if build(folder / 'code', folder / 'content') != (folder / PAGE).read_text(encoding='utf-8'):
        raise ValueError('源码与生成网页不一致')
    return folder


def check(name: str) -> None:
    folder = verify(name)
    env = dict(os.environ, BUNMYAKU_CONTENT=str(folder / 'content'), PYTHONDONTWRITEBYTECODE='1')
    subprocess.run([sys.executable, '-m', 'unittest', '-q', 'test_server'], cwd=folder / 'code', env=env, check=True)
    checks = LOCAL / 'checks'
    checks.mkdir(exist_ok=True)
    (checks / (name + '.sha256')).write_text(digest(folder / 'manifest.json'))
    print('完整性与后端回归通过：' + name)


def publish(name: str) -> None:
    folder = verify(name)
    stamp = LOCAL / 'checks' / (name + '.sha256')
    if not stamp.exists() or stamp.read_text() != digest(folder / 'manifest.json'):
        raise ValueError('必须先运行 check 验证这个版本')
    current = LOCAL / 'current'
    old = current.resolve().name if current.exists() else None
    link = LOCAL / ('.current-' + str(os.getpid()))
    link.symlink_to(folder)
    os.replace(link, current)
    with (LOCAL / 'deployments.jsonl').open('a', encoding='utf-8') as f:
        f.write(json.dumps({'time': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'from': old, 'to': name}) + '\n')
    print('当前正式版本：' + name + '（运行中的管理服务会自动切换）')


def run(bind: str, port: int, name=None) -> None:
    """Supervisor: restart only our own child when the release pointer changes."""
    process = None
    active = None

    def stop(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        while True:
            target = release(name) if name else (LOCAL / 'current').resolve()
            if not target.is_dir() or not (target / 'manifest.json').exists():
                raise ValueError('还没有可运行的版本，请先 create、check、publish')
            if target != active:
                verify(target.name)
                if process:
                    process.terminate()
                    process.wait(timeout=15)
                env = dict(os.environ, BUNMYAKU_CONTENT=str(target / 'content'), BUNMYAKU_VERSION=target.name, PYTHONDONTWRITEBYTECODE='1')
                process = subprocess.Popen([sys.executable, str(target / 'code/serve.py'), '--bind', bind, '--port', str(port)], env=env)
                active = target
            if process.poll() is not None:
                raise RuntimeError('服务退出，请检查端口是否被占用')
            time.sleep(1)
    finally:
        if process and process.poll() is None:
            process.terminate()
            process.wait(timeout=15)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    creator = sub.add_parser('create', help='snapshot code + course pack as a new release')
    creator.add_argument('version')
    creator.add_argument('--content', help='course pack directory (default: BUNMYAKU_CONTENT or examples/demo-pack)')
    for action in ['check', 'publish', 'rollback']:
        sub.add_parser(action).add_argument('version')
    sub.add_parser('status')
    runner = sub.add_parser('run')
    runner.add_argument('--bind', default='127.0.0.1')
    runner.add_argument('--port', type=int, default=8765)
    runner.add_argument('--release')
    args = parser.parse_args()
    try:
        if args.command == 'create':
            create(args.version, packlib.resolve_content_dir(args.content))
        elif args.command == 'check':
            check(args.version)
        elif args.command in ['publish', 'rollback']:
            publish(args.version)
        elif args.command == 'run':
            run(args.bind, args.port, args.release)
        else:
            print('当前：' + ((LOCAL / 'current').resolve().name if (LOCAL / 'current').exists() else '尚未发布'))
            for p in sorted(RELEASES.glob('*/manifest.json')):
                print(p.parent.name)
    except KeyboardInterrupt:
        pass
    except (ValueError, OSError, RuntimeError, subprocess.SubprocessError, packlib.PackError) as e:
        parser.exit(1, str(e) + '\n')


if __name__ == '__main__':
    main()
