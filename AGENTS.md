# 给 agent 的说明

本仓库是 Bunmyaku（文脈）：本地日语精读学习台，Python 标准库服务 ＋ 单页前端，内容来自课程包。

## 仓库约定

- 运行：`python3 -m bunmyaku`（默认演示包，`python3 serve.py` 等价）；测试：`python3 -m unittest`，浏览器测试 `node test_*.cjs`（需要 Playwright，见 `docs/development.md`）；改样式或页面结构后必须跑 `test_layout.cjs`，改颜色、按钮或弹出层后必须跑 `test_a11y.cjs`，并用 `TEST_APPEARANCE=dark`、`reduced` 各跑一遍。颜色只用 `src/glass.css` 里的令牌，不在 `base.css`／`theme.css`／`app.css` 写死颜色；玻璃只给浮在内容上的东西，内容本身保持实底（见 `docs/development.md`“界面样式”）。
- 服务端无第三方依赖；前端不引入构建工具；新功能先改课程包格式说明再改代码。
- 界面文字一律写进 `src/i18n.js`，中、日、英三种同时写；页面固定文字用 `data-i18n`，脚本里用 `t()`。课程包内容不翻译。改完在 `TEST_LOCALE=ja-JP`、`en-US` 下各跑一遍布局与无障碍测试。
- 版权教材内容、私人课程包、密钥永远不进仓库：私人包放仓库外，用 `--content` 指向。`.gitignore` 里的 `content/`、`.local/`、`tutor.json` 不要去掉。
- 提交信息一行，说明做了什么。README 与代码不写开发过程说明。

## 把材料做成课程包

目标产物：一个目录，`pack.json` ＋ `lessons/*.json` ＋ 可选 `media/`，通过 `python3 tools/validate_pack.py <目录>` 零错误。格式以 `docs/pack-format.md` 为准，样例 `examples/demo-pack/`。

1. 先读材料全文再动手；扫描件先转文字，转写结果标 `unverified`。
2. 问清授权与去向；有版权的材料只做仓库外的私人包，`license` 如实填。
3. 按原文自然段切分 `paragraphs[].text`，段内不改字、不润色；`sentences[].text` 必须是本段子串。
4. 词条只取自原文：`forms` 必须是正文里的实际词形；不凑数。
5. 译文标来源：自己或模型翻译的标 `machine`，人审过的才标 `human`。
6. 注音逐词核：`漢字[かんじ]` 标注每个汉字串，确定的标 `human`／`verified`，拿不准的标 `unverified` 并写进清单，不猜。
7. 语法 `phrase` 取原文片段；例句可原创但不得冒充出处；练习答案要有材料依据，开放题用 `reference`。
8. 音频只用用户提供的，`audio_status` 如实；没有就 `null`。
9. 跑校验器修到零错误，警告逐条解释。
10. 交付时列“需要人核对”清单：所有 `unverified`／`machine` 项、拿不准的读音、意译处、依据不足的答案。

禁止：编造例句出处、页码、作者、词源；把没核过的注音标成已核；在课程包里写私人信息、密钥或本机绝对路径；为了“完整”补写材料里没有的内容。

最小起点：`python3 tools/import_text.py --text 课文.txt --vocab 词表.csv --out 目录 --id 包id` 生成全部 `unverified` 的骨架，再按上面的步骤补齐。用户给的是学习台“网页剪贴”导出的 `.txt` 时，直接作为 `--text`（第一行标题、`Source:` 行出处会被读入）；网页文字的版权属于原网站，课程包授权要写成私人材料。用户给的是 Anki 牌组时，`--vocab` 直接接 Anki 导出的 `.txt` 或旧格式 `.apkg`，用 `--map` 指明列，见 `docs/development.md`。
