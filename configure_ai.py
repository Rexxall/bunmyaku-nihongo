#!/usr/bin/env python3
"""Store the tutor connection (endpoint, model, key) in the user's config directory.

The key never enters the web page, the course pack or Git. Run without arguments for an
interactive setup, ``--show`` to print the current settings (key masked), ``--clear`` to remove.
Environment variables BUNMYAKU_BASE_URL / BUNMYAKU_MODEL / BUNMYAKU_API_KEY / BUNMYAKU_PRESET
override the file at run time.
"""
import argparse
import getpass
import json
import os
import tempfile

import packlib
from serve import PRESETS, config_dir

PATH = config_dir() / 'tutor.json'


def current() -> dict:
    try:
        value = json.loads(PATH.read_text(encoding='utf-8'))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def save(values: dict) -> None:
    PATH.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.tutor-', dir=PATH.parent)
    try:
        if hasattr(os, 'fchmod'):  # POSIX only; on Windows the file inherits the user profile's ACL
            os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(values, f, ensure_ascii=False, indent=2)
        os.replace(tmp, PATH)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def show() -> None:
    values = current()
    if not values:
        print(f'尚未配置（{PATH}）。')
        return
    masked = {**values, 'api_key': ('已设置，' + str(len(values['api_key'])) + ' 字符') if values.get('api_key') else '未设置'}
    print(json.dumps(masked, ensure_ascii=False, indent=2))


def interactive() -> None:
    print('答疑接口只保存在这台电脑的用户目录，权限仅本人可读写，不进入网页或 Git。')
    print(f'配置文件：{PATH}')
    print('选择预设：1 OpenAI 兼容自定义端点  2 DeepSeek  3 OpenAI  4 Ollama（本机，不需要密钥）')
    choice = input('编号（直接回车取消）：').strip()
    preset = {'2': 'deepseek', '3': 'openai', '4': 'ollama'}.get(choice)
    if choice == '':
        print('已取消，原配置未改动。')
        return
    if choice not in ('1', '2', '3', '4'):
        print('没有这个编号，未保存。')
        raise SystemExit(1)
    values = dict(current())
    if preset:
        values.update({'preset': preset, 'base_url': PRESETS[preset]['base_url'], 'needs_key': PRESETS[preset]['needs_key']})
        model = input(f"模型名（回车用 {PRESETS[preset]['model']}）：").strip()
        values['model'] = model or PRESETS[preset]['model']
    else:
        values.pop('preset', None)
        base_url = input('base_url（如 https://api.example.com/v1）：').strip().rstrip('/')
        model = input('模型名：').strip()
        if not base_url.startswith(('http://', 'https://')) or not model:
            print('base_url 或模型名不正确，未保存。')
            raise SystemExit(1)
        values.update({'base_url': base_url, 'model': model, 'needs_key': True})
    if values.get('needs_key', True):
        key = getpass.getpass('API Key（输入时不显示；回车保留原值）：').strip()
        if key:
            if len(key) > 512 or any(c.isspace() for c in key):
                print('密钥格式不正确，未保存。')
                raise SystemExit(1)
            values['api_key'] = key
    else:
        values.pop('api_key', None)
    persona = input('给辅导老师的补充说明（可选，如“学习者母语是英语，用英语解释”）：').strip()
    if persona:
        values['persona'] = persona
    save(values)
    print('已保存。回学习页点“重新检查连接”，无需重启服务。密钥是否有效将在首次提问时验证。')


def main() -> None:
    packlib.safe_console()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--show', action='store_true', help='print the current configuration with the key masked')
    parser.add_argument('--clear', action='store_true', help='delete the configuration file')
    args = parser.parse_args()
    if args.show:
        show()
    elif args.clear:
        try:
            PATH.unlink()
            print('已删除配置。')
        except FileNotFoundError:
            print('本来就没有配置。')
    else:
        interactive()


if __name__ == '__main__':
    main()
