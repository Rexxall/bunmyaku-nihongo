# 参与贡献

欢迎提问题、报错、改代码，也欢迎贡献原创课程包。Issues and pull requests in English or Japanese are welcome too. 日本語でも英語でも大丈夫です。

## 先读这条：内容授权

- **版权教材永远不进仓库。** 教科书课文、出版社的词表和录音，即使只用来测试或举例，也不能出现在 issue、PR、截图或测试里。复现问题请用 `examples/demo-pack/`，或者自己写几句原创句子。
- 贡献给 `examples/` 的课程包必须是你自己写的原创内容，并同意以 CC0 发布。
- 不要在 issue 或 PR 里贴 API 密钥、`tutor.json`、私人笔记或本机路径。

## 报告问题

用 [Issues](https://github.com/Rexxall/bunmyaku-nihongo/issues/new/choose) 里的模板。请附上：

- `python3 -m bunmyaku --version` 的输出、操作系统、Python 版本和浏览器；
- 能复现的深链接，例如 `http://127.0.0.1:8765/#lesson=02&panel=listening`（支持 `lesson`、`panel`、`word`、`answers=1`、`tutor`）；
- 课程包问题附上 `python3 tools/validate_pack.py <目录>` 的输出。

## 改代码

```sh
git clone https://github.com/Rexxall/bunmyaku-nihongo.git
cd bunmyaku-nihongo
python3 -m bunmyaku --open
```

约定：

- 服务端只用 Python 标准库，支持 Python 3.9 及以上；前端不引入构建工具，页面由 `src/page.html` 在内存里拼装。
- 改课程包格式时，先改 [docs/pack-format.md](docs/pack-format.md) 和校验器，再改代码。
- 改样式或页面结构后跑 `test_layout.cjs`：它会在每课 × 八种宽度 × 七个面板下检查横向滚动、文字溢出和标签折行。
- 改颜色、按钮或弹出层后跑 `test_a11y.cjs`：axe-core 无障碍扫描加键盘焦点路径。新按钮要有能读出来的文字，文字颜色对比度至少 4.5:1。
- 界面文字写进 `src/i18n.js`，中、日、英三种同时给；不会写某种语言就先照搬中文并在 PR 里说明，维护者补齐。译文改进也欢迎单独提 PR。
- 提交信息写一行英文，说明做了什么，例如 `Fix ruby spacing in vocabulary cards`。

提交 PR 前在本机跑：

```sh
python3 -m unittest -v
python3 tools/validate_pack.py examples/demo-pack --strict
python3 -m bunmyaku --port 8766 &
node test_browser.cjs && node test_learning.cjs && node test_resume.cjs && node test_extension.cjs && node test_layout.cjs && node test_a11y.cjs
```

浏览器测试需要 Playwright 和 axe-core，安装方法见 [部署与开发](docs/development.md#测试)。GitHub Actions 会在 Linux、Windows、macOS 和 Python 3.9／最新版上再跑一遍。

## 贡献课程包

想做自己的课程包，看 [课程包格式](docs/pack-format.md)；用 Claude Code、Codex 等 agent 来做，它会读仓库里的 `AGENTS.md` 和 `.claude/skills/make-course-pack/`。课程包不需要合并进本仓库，放在你自己的目录，用 `--content` 指向即可。

## 许可

提交代码即表示你同意以 [MIT](LICENSE) 许可发布；贡献到 `examples/` 的内容以 CC0 发布。
