# Bunmyaku 开放版：执行规划（2026-10-27）

Bunmyaku（文脈）：把你手里的任何日语材料变成一个能读、能查、能练、能问的本地学习台。应用本身不带教材；用户或用户的 agent 把课文、词表、音频整理成一个“课程包”（Pack v1），放进文件夹就能用。

本页是从一个私人学习台项目解耦出来的执行规划。规划依据：旧仓库全部源码实读（`serve.py` 171 行、`manage.py` 151 行、`configure_ai.py` 20 行、`src/app.js` 378 行、`src/page.html`、两套 CSS、6 个测试文件）与四个同类开源项目的导入／课程形态。

## 1 旧代码诊断：哪些能留，哪些必须换

| 模块 | 旧状态 | 处理 |
|---|---|---|
| `serve.py` 静态服务 | 允许列表按教材文件名硬编码（练习册 120 张图、60 条音轨、4 份 PDF），根目录是本机绝对路径 | 重写：允许列表从课程包清单与课文内的媒体引用生成；页面在内存里由 `src/` 模板＋课程包 JSON 拼出，不再需要构建步骤 |
| `serve.py` 答疑接口 | 只接 DeepSeek，`SYSTEM` 写死两个具体学习者的名字，上下文按第 N 课／练习册／N1 三套分支 | 重写：OpenAI 兼容端点（`base_url`＋`model`＋`key`），DeepSeek／Ollama／OpenAI 作预设；系统提示 = 中性底稿 ＋ 课程包 `tutor.persona` ＋ 用户设置；上下文只有一套（当前课＋当前小节） |
| `serve.py` 安全设计 | Host 校验、同源 Origin、一次性 token、并发 2、错误脱敏、不记日志、Range 请求 | **保留**，是这个项目的亮点 |
| `manage.py` | 快照＝代码＋内容＋教材媒体，`VAULT` 写死 | 保留快照／校验／发布／回退／监督运行，快照改为 代码＋课程包目录；去掉绝对路径 |
| `configure_ai.py` | macOS 路径、只存 DeepSeek key | 改为跨平台配置目录，存 `provider/base_url/model/api_key`，可选预设 |
| `src/app.js` | 378 行密集代码，N1 单词、练习册页图、汉字页、语言桥、60 分钟双人计划全部绑定一本书 | **按 Pack v1 重写**。保留：注音对齐算法 `sourceReading`、Markdown 白名单渲染、选中即问、答疑栏可调宽、音频 A/B 循环与续听、学习位置恢复、多档案记录。删除：N1、练习册原页、汉字页、语言桥、PDF 页码链接 |
| `src/page.html` | 旧品牌字、学习者两个 option 写死、N1／练习册面板 | 重写骨架，品牌 Bunmyaku，学习者下拉由档案列表渲染 |
| `src/base.css` `src/theme.css` | 与品牌无关 | 直接沿用，仅改一处作者署名残留与品牌字 |
| `src/marked.js` | MIT 打包 | 沿用，许可注释保留 |
| 测试 | 服务端测试断言的是教材数据（第 12 课 43 词、N1 第 951 词等）；浏览器测试同理 | 全部改成断言演示包；`unittest` 结构 |

## 2 四个同类项目的导入／课程形态

| 项目 | 课程／导入形态 | 可借鉴 | 不照搬 |
|---|---|---|---|
| Yomitan 词典 | zip 内 `index.json`（`title`、`revision`、`format`、`author`、`attribution`、`sourceLanguage`、`targetLanguage`）＋ `term_bank_N.json`；结构化释义支持 `ruby`／`rt` 节点 | 清单文件自述标题、修订号、格式版本、作者、授权与源／目标语言；注音作为结构的一部分而不是渲染时猜 | 词典是“查词”的单位，不是“课”的单位；分 bank 文件和压缩包对一门课的几十个词条过重 |
| Anki（apkg／CrowdAnki） | apkg＝SQLite＋数字命名媒体＋媒体映射 JSON；CrowdAnki 把牌组导出成一个目录（`deck.json`＋`media/`）供 git 协作 | “一个目录＝一个单位，媒体放 `media/` 子目录，JSON 直接可 diff、可进 git”——课程包就按这个形态 | 不用 SQLite、不用数字改名媒体；不做间隔重复算法，Bunmyaku 是精读台不是背卡器 |
| LingQ | 任何文本／音频／视频导入即成一课：先切句、点词查义、词汇状态跟踪；音频可自动转写 | “导入即成课”的低门槛：`tools/import_text.py` 要做到纯文本＋词表 CSV 就能生成最小课程包；听力条目天生是“音频＋逐行文稿” | 不做云端、不做自动转写、不做已知词计数；译文与注音必须有人核对标记 |
| Readlang | 点词即译、短语保存、词表练卡；上传文本或浏览器扩展 | 选中即问（已在旧版实现）；词条“正文定位”是 Readlang 式阅读体验的本地版 | 不做机器即时翻译；词条只取自原文并带人校标记，不以“点哪里译哪里”为核心 |
| Mokuro（本地优先的日语漫画阅读器） | 离线 OCR 出 `.mokuro` JSON＋图片目录；旧版生成自包含 HTML，拷到手机即可读 | “处理在本机、产物是一个文件夹、拷走就能用”；自包含单页 HTML 的离线分发思路与 Bunmyaku 一致 | 以图片为中心、按像素框定位文字；Bunmyaku 以已校对文字为中心 |

## 3 Pack v1 字段草案

一个课程包就是一个目录：

```
my-pack/
  pack.json          清单（必填）
  lessons/01.json    每课一个文件（pack.json 用 lessons[].file 指向）
  media/*.mp3|m4a|wav|ogg   音频（可选）
  LICENSE            内容授权（建议）
```

`pack.json`

| 字段 | 必填 | 说明 |
|---|---|---|
| `format` | ✓ | 固定 `bunmyaku-pack` |
| `version` | ✓ | 格式版本，`1` |
| `id` | ✓ | 包 ID，`[a-z0-9-]`，作为浏览器记录键的一部分 |
| `title` | ✓ | 包名 |
| `revision` | ✓ | 内容修订号，如 `2026-10-27` |
| `language` / `translation_language` | ✓ | 学习语言 `ja`；译文语言 `zh` 等 |
| `license` | ✓ | 内容授权，SPDX 标识或文字 |
| `author` / `description` / `source` | 可选 | 来源说明 |
| `profiles` | 可选 | 学习档案名列表，缺省 `["我"]` |
| `tutor.persona` / `tutor.learner_note` | 可选 | 答疑系统提示的追加段 |
| `lessons[]` | ✓ | `{id, file}` 或内联课对象 |

课文件（lesson）

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` `title` | ✓ | 课 ID（`[A-Za-z0-9_-]`）与标题 |
| `title_ruby` `theme` `source` `status` | 可选 | 标题注音、主题一句话、来源、进度说明 |
| `paragraphs[]` | ✓ | `{text, ruby, ruby_status, translation:{text,status}, sentences[]?}`；`ruby` 用 `漢字[かんじ]` 标注，`status` ∈ `human`／`machine`／`unverified` |
| `vocabulary[]` | ✓ | `{id, word, reading, reading_status, forms[], meaning:{zh,en?}, simple, similar?, memo?}`；`forms` 为正文中出现的词形，用于高亮与定位 |
| `grammar[]` | 可选 | `{id, name, phrase?, meaning, connection?, example, example_ruby?, trap?}` |
| `exercises[]` | 可选 | 组 `{id, title, instruction?, items[]}`；题 `{id, type: fill|choice|open|transform, question, answers[]?, answer?, choices[]?, hint?, explanation?}`；`fill` 的空用 `＿＿`，`answers` 按空顺序 |
| `listening[]` | 可选 | `{id, title, audio?, audio_status?, lines:[{speaker?, text, ruby?, ruby_status?, translation?}], questions[]?}`；`audio` 为包内相对路径或 `null` |
| `readings` | 可选 | 课级 `词→假名` 词典，供正文自动注音兜底，标 `unverified` 的不进此表 |

注音规则：假名只放 `ruby`／`reading`，正文 `text` 保持原文；凡机器猜测未经人核的注音标 `ruby_status: "unverified"`，校验器统计覆盖率并列出未核对项；渲染时 `unverified` 加虚线下标。

## 4 分批与文件改动清单

### 第一批：解耦与演示课程

| # | 事项 | 文件 |
|---|---|---|
| 1 | 新仓库、只拷贝需要的源码 | `git init`；拷 `src/base.css` `src/theme.css` `src/marked.js`；其余重写 |
| 2 | 改名与键迁移 | `src/page.html` `src/app.js`（`bunmyaku:` 键前缀＋一次性 `futari-*` 迁移）；`configure_ai.py`（跨平台配置目录） |
| 3 | 内容配置化 | `serve.py`（`--content`／`BUNMYAKU_CONTENT`／默认 `examples/demo-pack`，允许列表从包生成，内存拼页）；`manage.py` |
| 4 | 档案可配置 | `app.js`：档案来自 `pack.profiles` → 用户设置；记录键按 包 ID／课 ID／档案名 |
| 5 | 答疑提供商 | `serve.py`：OpenAI 兼容端点＋预设；`/api/prompt` 无 key 复制模式；系统提示拼接 |
| 6 | 演示课程包 | `examples/demo-pack/`：两课原创课文、各 10 词、3 语法、6 练习；听力条目各一（一条有占位音频、一条无音频） |
| 7 | 测试与 CI | `test_server.py` `test_releases.py` `test_pack_tools.py` `test_browser.cjs` `test_learning.cjs` `test_resume.cjs`；`.github/workflows/test.yml` |
| 8 | 许可证 | `LICENSE`（MIT，Rexxall）；演示包 `examples/demo-pack/LICENSE`（CC0） |

### 第二批：课程包格式与 agent 技能

| # | 事项 | 文件 |
|---|---|---|
| 1 | 格式说明 | `docs/pack-format.md` |
| 2 | 校验器 | `tools/validate_pack.py` |
| 3 | 导入器 | `tools/import_text.py`（纯文本＋CSV → 最小包，不调 AI） |
| 4 | agent 技能 | `.claude/skills/make-course-pack/SKILL.md`；`AGENTS.md` 同段 |
| 5 | 答疑协议 | `docs/tutor-protocol.md` |

### 收尾

`README.md`（中文版，首屏一句话＋三张演示包截图＋三分钟跑起来）、`CHANGELOG.md` 从 0.1.0、`docs/development.md`、本地提交、建仓与推送命令清单（不执行）。

## 5 已知限制与待定项

- 界面三语（中、日、英）已在第四批完成，见 CHANGELOG。
- 网页剪贴有书签小工具和 Chrome／Edge 扩展（Manifest V3，1.2.0）；扩展未上架商店，Firefox、Safari 未测。
- 演示包音频为本机生成的占位音（CC0），`tools/make_demo_audio.sh` 可在 macOS 用系统语音重生成，但系统语音输出的再分发授权不明，仓库内不放语音合成文件。
- 本机没有 Node／npm／Playwright，浏览器测试以 CI 为准；本地验证用桌面内置浏览器手工走一遍。
