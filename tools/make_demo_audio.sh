#!/bin/sh
# Regenerate the demo listening audio with the macOS system voice (for personal use).
# The repository ships a CC0 placeholder tone instead, because redistributing
# synthesized system-voice audio is not clearly permitted. Usage:
#   sh tools/make_demo_audio.sh [examples/demo-pack/media/02-counter.wav]
set -e
OUT="${1:-examples/demo-pack/media/02-counter.wav}"
if ! command -v say >/dev/null 2>&1; then echo "needs macOS 'say'"; exit 1; fi
TEXT='本をお借りになりますか。はい、この一冊をお願いします。利用カードはお持ちですか。いえ、今日初めて来たんです。では、こちらの用紙にお名前とご住所をお書きください。二週間お借りになれます。ありがとうございます。雨の日に来てよかったです。'
TMP="$(mktemp -t bunmyaku).aiff"
say -v Kyoko -r 150 -o "$TMP" "$TEXT"
afconvert -f WAVE -d LEI16@22050 "$TMP" "$OUT"
rm -f "$TMP"
echo "wrote $OUT (system-voice audio: keep it local unless you have checked the licence)"
