# 部署与开发

Bunmyaku 是一个 Python 标准库脚本加一个静态页面。部署的全部含义是：把仓库放到一台机器上，指向一个课程包目录，让 `serve.py` 一直跑着。本页按从简到繁写：本机、局域网、常驻服务、更新与备份、安全边界，最后是开发与测试。

## 环境

- Python 3.9 或更新；服务端不装任何第三方包。
- 现代浏览器（Chrome、Safari、Firefox、Edge 近两年版本）。
- 可选：Node.js 18+ 与 Playwright，只在跑浏览器回归测试时需要。

## 本机运行

```sh
python3 -m bunmyaku --open                      # 演示包，自动开浏览器
python3 -m bunmyaku --content ~/my-pack          # 自己的课程包
BUNMYAKU_CONTENT=~/my-pack python3 -m bunmyaku   # 同上，用环境变量
python3 -m bunmyaku --version                    # 版本号
```

`bunmyaku.command`（macOS／Linux）和 `bunmyaku.bat`（Windows）做的就是第一条命令，双击即可；改脚本里的 `BUNMYAKU_CONTENT` 或在运行前设置该环境变量就能换课程包。`python3 serve.py` 与 `python3 -m bunmyaku` 等价。

页面每次请求时由 `src/` 与课程包现拼，改源码或课程包后刷新即可，没有构建步骤。

## 局域网（手机、平板）

```sh
python3 -m bunmyaku --bind 192.168.1.20 --port 8765 --content ~/my-pack
```

把 `--bind` 换成这台电脑在局域网里的地址，手机浏览器打开 `http://192.168.1.20:8765/`。服务用 Host 头核对访问地址，所以必须用启动时的那个地址访问，不能用别名或反向代理改写。

不要把它绑到公网地址：服务没有登录，答疑接口按你的 API 账户计费。需要远程使用时走 VPN、Tailscale 一类的私有网络，仍然绑在私有地址上。

## 常驻服务

两种做法。单课程包、不需要回退，直接让系统拉起 `serve.py`；需要“改了内容先试再发布、出问题一秒回退”，用 `manage.py run`，它跟随 `current` 指针，发布后自动切换，详见下一节。

**Linux（systemd 用户服务）** `~/.config/systemd/user/bunmyaku.service`：

```ini
[Unit]
Description=Bunmyaku study server

[Service]
WorkingDirectory=/path/to/bunmyaku-nihongo
Environment=BUNMYAKU_CONTENT=/path/to/my-pack
ExecStart=/usr/bin/python3 -m bunmyaku --bind 192.168.1.20 --port 8765
Restart=on-failure

[Install]
WantedBy=default.target
```

```sh
systemctl --user daemon-reload && systemctl --user enable --now bunmyaku
loginctl enable-linger "$USER"      # 注销后继续运行
```

**macOS（launchd）** `~/Library/LaunchAgents/bunmyaku.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>bunmyaku</string>
  <key>WorkingDirectory</key><string>/path/to/bunmyaku-nihongo</string>
  <key>EnvironmentVariables</key><dict><key>BUNMYAKU_CONTENT</key><string>/path/to/my-pack</string></dict>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/python3</string><string>-m</string><string>bunmyaku</string>
    <string>--bind</string><string>192.168.1.20</string><string>--port</string><string>8765</string>
  </array>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
</dict></plist>
```

```sh
launchctl load ~/Library/LaunchAgents/bunmyaku.plist
```

**Windows**：任务计划程序新建任务，“登录时”触发，操作为 `py -3 -m bunmyaku --content C:\path\to\my-pack`（没有 `py` 启动器时用 `python`），起始于仓库目录；或直接把 `bunmyaku.bat` 的快捷方式放进启动文件夹。

## 版本快照、发布与回退

```sh
python3 manage.py create 2026-10-27 --content ~/my-pack   # 源码＋课程包＋拼好的页面＋SHA-256 清单
python3 manage.py check 2026-10-27                         # 校验完整性，在快照里跑服务端测试
python3 manage.py publish 2026-10-27                       # 原子切换 current 指针
python3 manage.py run --bind 192.168.1.20 --port 8765      # 跟随 current，发布后自动重启到新快照
python3 manage.py status
python3 manage.py rollback 2026-10-20
```

快照存在 `.local/releases/<名字>/`，不进 Git。常驻服务用 `manage.py run` 代替 `python3 -m bunmyaku` 即可获得这套流程。

## 更新

```sh
git pull
python3 -m unittest -q              # 可选：确认这台机器上一切正常
```

然后重启服务（systemd：`systemctl --user restart bunmyaku`；launchd：`launchctl kickstart -k gui/$(id -u)/bunmyaku`；`manage.py run`：新建并发布一个快照）。课程包格式有变化时 CHANGELOG 会写明，先跑 `python3 tools/validate_pack.py <目录>` 再发布。

## 备份

要备份的只有三样，都在仓库之外：

| 内容 | 位置 |
| --- | --- |
| 课程包 | 你用 `--content` 指向的目录 |
| 答疑配置（含密钥） | macOS `~/Library/Application Support/bunmyaku/tutor.json`；Linux `$XDG_CONFIG_HOME/bunmyaku/tutor.json`；Windows `%APPDATA%\bunmyaku\tutor.json` |
| 学习记录 | 在浏览器的 localStorage 里，按课程包、课、档案分键；右上角菜单可导出 Markdown 笔记，或把本课生词导出成 Anki 可直接导入的文本 |
| 网页剪贴 | 也在 localStorage（`bunmyaku:clips`，按档案分开，不分课程包）；“网页剪贴”面板可全部导出成 Markdown |

`.local/releases/` 是本机快照，不是异地备份。

## 安全边界

- 服务只提供 `/`、`/api/*` 和课程包里引用到的音频文件；课程包 JSON、仓库源码、`.local/` 都不会被读到。
- 每次启动生成一次性 token，答疑接口核对 Host、Origin 和 token；同时最多两个答疑请求在途，上游错误只返回脱敏后的说明。
- 密钥只存在配置文件（权限 0600）或环境变量里，从不进页面、课程包或 Git。
- 没有登录、没有 HTTPS：只绑私有地址。要给多人用，各自跑一份。

## 答疑接口

```sh
python3 configure_ai.py          # 交互式：自定义 OpenAI 兼容端点 / DeepSeek / OpenAI / Ollama
python3 configure_ai.py --show   # 查看（密钥打码）
python3 configure_ai.py --clear  # 删除
```

或用环境变量 `BUNMYAKU_PRESET`、`BUNMYAKU_BASE_URL`、`BUNMYAKU_MODEL`、`BUNMYAKU_API_KEY`、`BUNMYAKU_CONFIG_DIR`，环境变量优先于文件。没有配置时页面进入“复制提示词”模式。发送内容见 [答疑上下文协议](tutor-protocol.md)。

## 课程包

格式见 [pack-format.md](pack-format.md)。改完内容先校验：

```sh
python3 tools/validate_pack.py examples/demo-pack --strict
python3 tools/import_text.py --text 课文.txt --vocab 词表.csv --out ~/my-pack --id my-pack
python3 tools/import_text.py --text 课文.txt --vocab 牌组.txt --map word=1,reading=2,meaning=3 --out ~/my-pack --id my-pack
```

**Anki 词表。** `--vocab` 认三种文件：带表头的 CSV；Anki“Notes in Plain Text”导出的 `.txt`（制表符分隔，可带 `#separator:`、`#html:`、`#columns:` 等文件头）；以及勾选“Support older Anki versions”导出的旧格式 `.apkg`（用标准库的 zipfile 与 sqlite3 读取）。新版 `.apkg` 用 zstd 压缩，Python 标准库读不了，导入器会提示改用上面两种。`--map` 按列号或字段名指定 `word`、`reading`、`meaning`（以及 `forms`、`simple`、`similar`、`memo`），不写时第一列是词、第二列是释义；导出时若勾了 Anki 的牌组、笔记类型或标签列，列号会后移。导入时去掉 HTML 和 `[sound:…]`，Anki 式注音 `日本[にほん]語[ご]` 拆成词和读音；含汉字却没有读音的词条会被列出来，读音一律标 `unverified`，导入器不猜读音。

**导出给 Anki。** 页面右上角菜单的“生词导出给 Anki”生成 Anki 2.1.54 起能识别文件头的 `.txt`：每个词一条，列为词、读音、释义、原文例句（取课文里含这个词的那一句）、我的解释、出处，标签为 `bunmyaku::包id::课id`，自认能解释的词另加 `bunmyaku::known`。这份文件也能反过来交给导入器：`--map word=词,reading=读音,meaning=释义`。

**网页剪贴。** “网页剪贴”面板里有书签小工具（一个 `javascript:` 链接，地址里写着当前学习台的网址）。在别的网页选中文字再点它，它去掉选区里的注音（`<rt>`），把文字（≤4000 字）、网页标题和网址编成 JSON，放进学习台网址的 `#clip=` 后，在名为 `bunmyaku` 的标签页里打开。`#` 后面的部分不会发给服务端；页面读出后立即把它从地址栏去掉，显示“收到一段剪贴”，点“保存”才写进 `bunmyaku:clips`。所以别的网站自己打开这种链接，也只会得到一段待确认的剪贴。只保留 `http`／`https` 网址，文字一律按纯文本显示。每段剪贴可以“问老师”（答疑以这段剪贴代替本课资料，见 [答疑上下文协议](tutor-protocol.md)），或“导出成课文（.txt）”：第一行 `# 标题`，第二行 `Source: 标题 · 网址`，之后是正文，导入器会把 `Source:` 行读成出处：

```sh
python3 tools/import_text.py --text 2026-10-28_町のニュース_网页剪贴.txt --out ~/clip-pack --id clip-pack --license "私人材料，不分发"
```

手机浏览器一般不能把链接拖进书签：先随便收藏一个网页，再把书签地址换成面板里的代码。书签小工具的地址写死了生成它时学习台的网址；换了端口或局域网地址，要重新装一次。网站的内容安全策略可能拦下书签小工具，这时只能手动复制文字。

## 在线演示（静态页）

`tools/export_static.py` 把课程包导出成纯静态页面：一个 `index.html`（与服务端拼出的页面相同，另加静态标记）加上课程包引用的音频。阅读、词汇、语法、练习、听力、笔记和网页剪贴照常可用；答疑需要本机服务，静态页里显示为不可用。

```sh
python3 tools/export_static.py examples/demo-pack --out _site
```

仓库的 `.github/workflows/pages.yml` 在每次推送到 main 时导出演示包并发布到 GitHub Pages（需在仓库设置里把 Pages 来源设为 GitHub Actions）。只导出你有权公开的内容：版权教材和私人课程包不要导出到公开站点。

## 目录

```text
bunmyaku/           python3 -m bunmyaku 入口与版本号
serve.py            本地 HTTP 服务：在内存里拼页面、按允许列表提供媒体、转发答疑
packlib.py          课程包加载：解析 pack.json、内联各课、生成媒体允许列表
manage.py           版本快照、校验、发布、回退与监督运行
configure_ai.py     答疑接口配置（端点、模型、密钥）
src/                page.html 骨架、app.js、三份样式、marked.js（MIT）
tools/              validate_pack.py 校验器、import_text.py 导入器、export_static.py 静态导出、占位音频脚本
examples/demo-pack  原创演示课程包（CC0）
docs/               格式说明、答疑协议、本页、难点与踩坑、截图
test_*.py / *.cjs   服务端、发布流程、工具、浏览器测试
```

## 测试

```sh
python3 -m unittest -v                 # 服务端、发布流程、工具、启动入口
python3 tools/validate_pack.py examples/demo-pack --strict
python3 -m bunmyaku --port 8766 &      # 浏览器测试默认访问这个端口
node test_browser.cjs && node test_learning.cjs && node test_resume.cjs && node test_layout.cjs && node test_a11y.cjs
for l in ja-JP en-US; do TEST_LOCALE=$l node test_layout.cjs && TEST_LOCALE=$l node test_a11y.cjs; done
```

界面语言跟随浏览器语言，所以测试用 `TEST_LOCALE` 设定浏览器语言（默认 `zh-CN`）。`test_layout.cjs` 与 `test_a11y.cjs` 要在三种语言下各跑一遍：英文标签更长，最容易撑破布局。

`test_layout.cjs` 按每课 × 八种宽度（1440 到 360）× 七个面板逐一打开页面，宽屏时答疑栏开关各测一次，检查：页面横向滚动、文字超出自身盒子、元素超出侧栏或卡片、界面标签折成两行、填空横线被拆开；每种宽度再看一次“网页剪贴”里待确认和已保存的长剪贴（长标题、长网址）以及展开的安装说明；再检查右上角菜单在选完、按 Esc、点别处时收起，以及播放中切走后旧音频事件不报错。宽度可用 `LAYOUT_WIDTHS=1440,390` 缩小范围。改样式后先跑它。

`test_a11y.cjs` 用 axe-core 按 WCAG 2.2 A／AA 和通用最佳实践扫描：每课 × 七个面板，宽屏和手机宽度各一遍，另扫词条抽屉、答疑栏、显示答案、右上角菜单、两个对话框，以及网页剪贴的安装说明、待确认与已保存的剪贴、就剪贴提问的答疑栏；再走一遍键盘路径：第一下 Tab 到“跳到学习内容”、面板标签用方向键切换、词条抽屉打开时焦点进入、按 Esc 回到原词、语法“在正文中定位”把焦点移到正文、答疑栏打开时焦点进输入框、关闭后回到“问老师”；收到剪贴时焦点到“收到一段剪贴”，保存后到这段剪贴，丢弃后回到面板标签。

浏览器测试需要 `npm install --no-save playwright@1.64.1 axe-core@4.10.3 && npx playwright install chromium`；通过 `STUDY_URL` 改地址，`PLAYWRIGHT_MODULE` 指定已装好的 Playwright，`PLAYWRIGHT_CHANNEL=chrome` 使用本机 Chrome。GitHub Actions 在每次推送时跑全部测试（`.github/workflows/test.yml`），这个工作流不发布任何东西：服务端、发布流程、工具和启动入口的测试在 Linux、Windows、macOS 上各跑一遍，Python 用 3.9 和当前最新版（GitHub 的 macOS 与最新 Ubuntu 机器没有 3.9 安装包，3.9 在 Windows 和 Ubuntu 24.04 上跑），并实际运行 `bunmyaku.command`／`bunmyaku.bat`；浏览器测试在 Linux 上跑。

## 截图

`docs/assets/` 用演示包重截：

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --window-size=1440,1000 --virtual-time-budget=5000 --screenshot=docs/assets/study-reading.png \
  "http://127.0.0.1:8765/#lesson=01&panel=read&word=v8"
```

`study-mobile.png` 是三张 390×844、两倍像素的手机截图（课文、词条卡、听力）并排拼成；`social-preview.png`（1280×640）是仓库的分享预览图，在 GitHub 仓库设置的 Social preview 里上传。

页面支持 `#lesson=`、`panel=`（read／words／grammar／exercises／listening／notes／clips）、`word=`、`answers=1`、`tutor=选中文字` 深链接。截图不得出现版权教材页面、个人笔记或密钥。
