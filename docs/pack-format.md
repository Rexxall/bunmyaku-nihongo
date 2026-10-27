# 课程包格式 Pack v1

一个课程包就是一个目录。放进 `--content` 指向的位置（或设置 `BUNMYAKU_CONTENT`），`serve.py` 就能把它变成学习台。

```
my-pack/
  pack.json            清单（必填）
  lessons/01.json      每课一个文件（也可以直接内联在 pack.json 里）
  media/02-dialog.mp3  音频（可选）
  LICENSE              内容授权说明（建议）
```

校验：`python3 tools/validate_pack.py my-pack`。错误会阻止发布级使用，警告提示“页面会降级显示的地方”。演示包 `examples/demo-pack/` 是本格式的完整样例，必须零错误零警告通过。

## 1 `pack.json`

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `format` | ✓ | string | 固定 `"bunmyaku-pack"` |
| `version` | ✓ | number | 格式版本，当前 `1`。字段只增不改时不升版本；改语义时升版本 |
| `id` | ✓ | string | 包 ID，`[a-z0-9-]`。浏览器记录键用它区分不同课程包，改了 ID 旧笔记就对不上 |
| `title` | ✓ | string | 显示在侧栏 |
| `revision` | ✓ | string | 内容修订号，建议日期 `2026-10-27` 或 `1.2.0`；改内容就改它 |
| `language` | ✓ | string | 学习语言，`ja` |
| `translation_language` | ✓ | string | 译文语言代码（`zh`、`en`…）。答疑系统提示用它决定解释语言 |
| `license` | ✓ | string | 内容授权，SPDX 标识（`CC0-1.0`、`CC-BY-4.0`）或说明文字（`私人材料，不分发`） |
| `author` `description` `source` | | string / object | 来源说明；`source` 可为 `{title, url, note}` |
| `profiles` | | string[] | 学习档案名，缺省 `["我"]`；两人结伴学时写两个。用户可在页面里改，页面设置优先 |
| `tutor.persona` | | string | 追加到答疑系统提示的一段话，描述学习者与材料。不写人名也能用 |
| `tutor.learner_note` | | string | 同上，偏学习者背景（母语、已学程度） |
| `media` | | array | 可选，额外要提供给页面的媒体 `[{path, type, license}]`；课文件里引用的音频不必重复列 |
| `lessons` | ✓ | array | `{id, file}` 指向 `lessons/*.json`，或直接写课对象 |

## 2 课文件

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✓ | `[A-Za-z0-9_-]`，与 `pack.json` 里的一致 |
| `number` | | 课序号，用于“第 N 课”显示 |
| `title` ✓ `title_ruby` | | 标题与标题注音 |
| `theme` | | 一句话主题，显示在页眉 |
| `source` | | 原文来源说明，显示在标题下 |
| `status` | | 给学习者看的进度／核对说明 |
| `paragraphs[]` | ✓ | 见 2.1 |
| `vocabulary[]` | ✓ | 见 2.2 |
| `grammar[]` | | 见 2.3 |
| `exercises[]` | | 见 2.4 |
| `listening[]` | | 见 2.5 |
| `readings` | | 课级 `{词: 假名}` 表，正文没有 `ruby` 时的兜底注音；只放人核过的 |

### 2.1 段落 `paragraphs[]`

```json
{
  "text": "去年の春、私は仕事の都合で小さな町に引っ越した。",
  "ruby": "去年[きょねん]の春[はる]、私[わたし]は仕事[しごと]の都合[つごう]で小[ちい]さな町[まち]に引[ひ]っ越[こ]した。",
  "ruby_status": "human",
  "translation": { "text": "去年春天，我因为工作的关系搬到了一个小镇。", "status": "human" },
  "sentences": [ { "text": "…", "ruby": "…", "translation": "…", "structure": "…", "usage": "…", "example": "…", "example_ruby": "…", "example_translation": "…" } ]
}
```

- `text`（必填）是原文，不含任何标记。
- `ruby`（可选但强烈建议）用 **`漢字[かんじ]`** 标注：方括号只跟在汉字串后面，去掉方括号后必须与 `text` 完全一致，每个汉字串都要有读音。送り仮名留在括号外：`引[ひ]っ越[こ]した`。
- `ruby_status`：`human`（人核过）、`machine`（机器生成未核）、`unverified`（来源不明或未核）。非 `human` 的注音在页面上带虚线标记，校验器会统计。
- `translation`（建议）：`{text, status}`，`status` 同上三选一；`machine` 显示“机器译”标签。
- `sentences[]`（可选）逐句精讲；`text` 必须是本段原文的子串。

### 2.2 词条 `vocabulary[]`

```json
{ "id": "v1", "word": "都合", "reading": "つごう", "reading_status": "verified", "forms": ["都合"],
  "meaning": { "zh": "情况；（是否）方便", "en": "circumstances" }, "simple": "何かをするときの、時間や事情のこと。",
  "similar": "…", "memo": "…" }
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✓ | 课内唯一。笔记按 `id` 保存，改 `id` 会丢笔记 |
| `word` | ✓ | 词典形 |
| `reading` | 含汉字时 ✓ | 整词假名；页面用对齐算法把它分配到各汉字串上，分不唯一时整词显示 |
| `reading_status` | 含汉字时 ✓ | `verified` 或 `unverified` |
| `forms` | ✓ | 正文中实际出现的词形，用于高亮与“课文定位”；校验器对找不到的词形给警告 |
| `meaning` | ✓ | 字符串，或 `{语言代码: 释义}`；页面优先显示 `translation_language` 那一项 |
| `simple` | | 简单日语释义（给学习者“用已会的词解释”的示范） |
| `similar` `memo` | | 近义辨析、汉字／构词提示 |

### 2.3 语法 `grammar[]`

`{id ✓, name ✓, phrase, phrase_ruby, meaning, connection, example, example_ruby, example_translation, trap}`。`phrase` 是正文里的原句片段，找到就画下划线；找不到只给警告。`example` 必须是原创或注明来源，不得冒充教材原句。

### 2.4 练习 `exercises[]`

组：`{id ✓, title ✓, instruction, items[] ✓}`。题（`id` 在整课内唯一，含听力题）：

| `type` | 必填字段 | 说明 |
|---|---|---|
| `fill` | `question`（含 `＿＿`）、`answers[]` | 空格数与答案数一致，按顺序；页面在原位显示答案 |
| `choice` | `question`、`choices[]`（≥2）、`answer` | `answer` 必须与某个选项逐字一致 |
| `transform` | `question`、`answer` | 改写题 |
| `open` | `question`，可选 `reference` | 开放题，`reference` 是参考说法，页面注明“答案不唯一” |

所有题可带 `hint`、`explanation`。

### 2.5 听力 `listening[]`

```json
{ "id": "l1", "title": "カウンターで", "audio": "media/02-counter.wav", "audio_status": "recorded",
  "note": "…", "intro": "…",
  "lines": [ { "speaker": "職員", "text": "本をお借りになりますか。", "ruby": "本[ほん]をお借[か]りになりますか。", "ruby_status": "human", "translation": "您要借书吗？", "note": "…" } ],
  "questions": [ … 同练习题 … ] }
```

- `audio`：包内相对路径（建议 `media/` 下），或 `null` 表示只有文稿。服务器只提供课文件里引用到的音频，其他文件一概 404。支持 `.mp3 .m4a .wav .ogg .opus .webm`。
- `audio_status`：`recorded`（真人录音）、`tts`（语音合成）、`placeholder`（占位）、`none`。
- `lines[]` 每行 `text` 必填，`ruby`／`ruby_status`／`translation`／`note` 可选。

## 3 注音规则小结

1. 假名只放 `ruby`（段落、句子、台词、例句）和 `reading`（词条）；`text` 永远是干净原文。
2. 括号紧跟汉字串，一个汉字串一个读音；送り仮名在括号外。
3. 人核过的标 `human`／`verified`；机器猜的标 `unverified`（或译文标 `machine`），不要假装核过。
4. 校验器输出“注音覆盖 N/M”和 unverified 计数；公开分发的包应做到全覆盖、零 unverified。
5. 没有 `ruby` 的文本按课级 `readings` → 词表 `reading` 兜底；兜底不到的汉字不显示假名，不猜。

## 4 媒体引用与授权

- 音频只能通过课文件 `listening[].audio` 或 `pack.json.media[]` 引用；路径不得以 `/` 开头或含 `..`。
- 包目录里放一份 `LICENSE` 说明文字与音频各自的授权；演示包用 CC0。
- 不要把有版权的教材扫描、录音放进公开仓库；私人包放在仓库外的目录，用 `--content` 指向即可。

## 5 版本

- 格式版本 `version: 1`。新增可选字段不升版本；改字段语义或删字段升到 2，并在 CHANGELOG 记录迁移方法。
- 内容修订用 `revision`；浏览器记录与 `revision` 无关，只跟 `id`、课 `id`、词条／题 `id` 绑定。
