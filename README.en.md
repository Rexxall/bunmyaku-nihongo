<div align="center">

# Bunmyaku · 文脈

**Turn any Japanese material you already have into a local study desk: read it, look things up, practise, and ask questions in context.**

Learn Japanese in context · reading · vocabulary · listening · a tutor that knows the lesson

[中文](README.md) · [日本語](README.ja.md) · English

[Try it online](https://rexxall.github.io/bunmyaku-nihongo/) · [Three-minute start](#three-minute-start) · [Pack format](docs/pack-format.md) · [Let an agent build packs](#let-an-agent-build-course-packs) · [Deploy and develop](docs/development.md)

</div>

![Reading: furigana, highlighted vocabulary, underlined grammar and inline explanations](docs/assets/study-reading.png)

## What it is

Bunmyaku is a local web app. It ships no textbook. You (or your AI agent) arrange a text, a word list, a dialogue script and a recording into a **course pack** folder, and Bunmyaku turns it into a study desk:

| Activity | What you can do |
| --- | --- |
| Reading | Furigana on the original text, vocabulary highlighted, grammar underlined, tap a word for its entry; translation on demand, sentence-by-sentence close reading |
| Vocabulary | Cards with whole-word readings, plain-Japanese definitions, near-synonym notes, word-building hints; write your own gloss, jump to the word in the text |
| Exercises | Fill-in answers shown in place, correct choices marked, rewriting and open questions; hints, answers and explanations toggle separately |
| Listening | Play, change speed, ±5 s, replay, A/B loop and saved segments; transcript lines and translations hide independently |
| Tutor | Select any word or sentence and ask; the server sends the model only the proofread text of the current lesson. No API key? Copy the assembled prompt instead |
| Web clips | Select Japanese on any page and send it to the study desk with a bookmarklet or the browser extension (Chrome, Edge); once saved under the current profile, ask the tutor about it or export it as plain text and turn it into a lesson with the importer |
| Records | Notes, answers and listening progress are saved in the browser per learner profile; one profile by default, more if you study with someone; export to Markdown, and vocabulary to Anki with the sentence it came from and your own explanation |
| Interface | Chinese, Japanese or English, following the browser language; switch in the top-right menu. Course content itself is not translated |

The server is a single Python standard-library script. No database, no account, no cloud. Content comes from a folder on your machine, keys stay on your machine, and tutor calls are billed to your own API account.

![Listening: player, transcript lines and furigana](docs/assets/study-listening.png)

![Exercises and tutor: answers in place, selected text carried into the question, copy-prompt mode without a key](docs/assets/study-tutor.png)

![On a phone: reading with furigana, a vocabulary card, the listening player](docs/assets/study-mobile.png)

## Three-minute start

To look before installing, [try it online](https://rexxall.github.io/bunmyaku-nihongo/) with the demo lessons: reading, vocabulary, exercises, listening and notes all work; the tutor needs a local run.

Python 3.9 or newer. Nothing to install.

```sh
git clone https://github.com/Rexxall/bunmyaku-nihongo.git
cd bunmyaku-nihongo
python3 -m bunmyaku --open
```

Your browser opens <http://127.0.0.1:8765/> with two original demo lessons (CC0). Prefer not to type? Double-click `bunmyaku.command` (macOS/Linux) or `bunmyaku.bat` (Windows). To study from a phone, pass `--bind` with your computer's LAN address.

**Connect a tutor** (optional):

```sh
python3 configure_ai.py
```

Pick a preset: any OpenAI-compatible endpoint, DeepSeek, OpenAI, or a local Ollama (no key needed). Without a configuration the tutor panel still works: it assembles your question and the lesson material into one prompt you can paste into any chat tool. What the server sends is documented in the [tutor protocol](docs/tutor-protocol.md).

**Use your own material**:

```sh
python3 -m bunmyaku --content ~/my-pack
```

A course pack is one folder: `pack.json` + `lessons/*.json` + an optional `media/`. Fields are described in the [pack format](docs/pack-format.md); `examples/demo-pack/` is a complete example.

## Let an agent build course packs

The pack format is written for people to read and for agents to write. The repository ships a `.claude/skills/make-course-pack/` skill and an `AGENTS.md`. Tell Claude Code, Codex or a similar agent "make this lesson into a course pack" and it follows fixed steps: read the whole material first, split by paragraph and sentence, take vocabulary only from the text, mark translations as machine or human, check every reading, run the validator, and finish with a "needs human review" list. It may not invent example sources, and it may not mark unchecked readings as verified.

Two local tools support this:

```sh
python3 tools/validate_pack.py my-pack          # structure, references, furigana coverage, exercise answers
python3 tools/import_text.py --text lesson.txt --vocab words.csv --out my-pack --id my-pack   # plain text → minimal pack
```

An Anki deck works as the word list too: export "Notes in Plain Text" (.txt), or an .apkg with "Support older Anki versions" ticked, and say which field is which with `--map word=1,reading=2,meaning=3`. Anki-style furigana `日本[にほん]語[ご]` is split into word and reading.

## Data and privacy

- Study records live in the current browser, separated by pack, lesson and profile; nothing syncs across devices unless you export.
- Web clips stay in the current browser under the current profile; the server has no endpoint that stores anything. The bookmarklet hands the study page only the selected text, the page title and its address.
- The server serves only the page, its API and the audio files a pack references; pack files and repository files are never exposed.
- The tutor receives the question, the selected text, the proofread lesson text and recent turns at send time; when you ask about a clip, the clip is sent instead of the lesson text. Audio, notes and keys are never sent.
- Keep copyrighted textbooks and private packs outside the repository and point `--content` at them. Never commit them.

## Layout

```text
bunmyaku/           python3 -m bunmyaku entry point and version
serve.py            local HTTP server and tutor relay
packlib.py          course pack loader
manage.py           release snapshots, checks, publish and rollback
configure_ai.py     tutor endpoint configuration
src/                page skeleton, behaviour and styles
tools/              pack validator, importer and static export
examples/demo-pack  original demo pack (CC0)
docs/               format, tutor protocol, deployment, design notes
test_*              server, release, tool and browser tests
```

## Contributing

Bug reports, ideas and code are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) (written in Chinese; issues in English or Japanese are fine). Please never paste copyrighted textbook content into issues or PRs.

## License

Code is [MIT](LICENSE). Demo lesson content is CC0. The bundled [Marked](https://github.com/markedjs/marked) keeps its MIT license. Your own packs follow the license of their content.
