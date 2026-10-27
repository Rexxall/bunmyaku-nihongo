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
| 学习记录 | 在浏览器的 localStorage 里，按课程包、课、档案分键；页面“我的笔记”可导出 Markdown |

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
```

## 目录

```text
bunmyaku/           python3 -m bunmyaku 入口与版本号
serve.py            本地 HTTP 服务：在内存里拼页面、按允许列表提供媒体、转发答疑
packlib.py          课程包加载：解析 pack.json、内联各课、生成媒体允许列表
manage.py           版本快照、校验、发布、回退与监督运行
configure_ai.py     答疑接口配置（端点、模型、密钥）
src/                page.html 骨架、app.js、三份样式、marked.js（MIT）
tools/              validate_pack.py 校验器、import_text.py 导入器、占位音频脚本
examples/demo-pack  原创演示课程包（CC0）
docs/               格式说明、答疑协议、本页、难点与踩坑、截图
test_*.py / *.cjs   服务端、发布流程、工具、浏览器测试
```

## 测试

```sh
python3 -m unittest -v                 # 服务端、发布流程、工具、启动入口
python3 tools/validate_pack.py examples/demo-pack --strict
python3 -m bunmyaku --port 8766 &      # 浏览器测试默认访问这个端口
node test_browser.cjs && node test_learning.cjs && node test_resume.cjs && node test_layout.cjs
```

`test_layout.cjs` 按每课 × 八种宽度（1440 到 360）× 六个面板逐一打开页面，宽屏时答疑栏开关各测一次，检查：页面横向滚动、文字超出自身盒子、元素超出侧栏或卡片、界面标签折成两行、填空横线被拆开；再检查右上角菜单在选完、按 Esc、点别处时收起，以及播放中切走后旧音频事件不报错。宽度可用 `LAYOUT_WIDTHS=1440,390` 缩小范围。改样式后先跑它。

浏览器测试需要 `npm install --no-save playwright@1.64.1 && npx playwright install chromium`；通过 `STUDY_URL` 改地址，`PLAYWRIGHT_MODULE` 指定已装好的 Playwright，`PLAYWRIGHT_CHANNEL=chrome` 使用本机 Chrome。GitHub Actions 在每次推送时跑全部测试（`.github/workflows/test.yml`），不发布任何东西：服务端、发布流程、工具和启动入口的测试在 Linux、Windows、macOS 上各跑一遍，Python 用 3.9 和当前最新版（GitHub 的 macOS 与最新 Ubuntu 机器没有 3.9 安装包，3.9 在 Windows 和 Ubuntu 24.04 上跑），并实际运行 `bunmyaku.command`／`bunmyaku.bat`；浏览器测试在 Linux 上跑。

## 截图

`docs/assets/` 用演示包重截：

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --window-size=1440,1000 --virtual-time-budget=5000 --screenshot=docs/assets/study-reading.png \
  "http://127.0.0.1:8765/#lesson=01&panel=read&word=v8"
```

页面支持 `#lesson=`、`panel=`（read／words／grammar／exercises／listening／notes）、`word=`、`answers=1`、`tutor=选中文字` 深链接。截图不得出现版权教材页面、个人笔记或密钥。
