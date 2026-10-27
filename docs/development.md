# 开发与部署

## 环境

- Python 3.9 或更新；服务端只用标准库。
- 现代浏览器。同一局域网内的手机、平板可以访问本机服务。
- 浏览器回归测试另需 Node.js 18+ 与 Playwright（`npm install --no-save playwright@1.64.1 && npx playwright install chromium`）。

## 目录

```text
serve.py            本地 HTTP 服务：在内存里拼页面、按允许列表提供媒体、转发答疑
packlib.py          课程包加载：解析 pack.json、内联各课、生成媒体允许列表
manage.py           版本快照、校验、发布、回退与监督运行
configure_ai.py     答疑接口配置（端点、模型、密钥）
src/                page.html 骨架、app.js、三份样式、marked.js（MIT）
tools/              validate_pack.py 校验器、import_text.py 导入器、占位音频脚本
examples/demo-pack  原创演示课程包（CC0）
docs/               格式说明、答疑协议、本页、截图
test_*.py / *.cjs   服务端、发布流程、工具、浏览器测试
```

## 运行

```sh
python3 serve.py                      # 演示包，http://127.0.0.1:8765/
python3 serve.py --content ~/my-pack  # 自己的课程包
BUNMYAKU_CONTENT=~/my-pack python3 serve.py --bind 192.168.1.20 --port 8765   # 局域网
```

页面每次请求时由 `src/` 与课程包现拼，改源码或课程包后刷新即可，没有构建步骤。服务只提供 `/`、`/api/*` 和课程包里引用到的音频；`pack.json`、课文件和仓库文件都不会被暴露。

## 答疑接口

```sh
python3 configure_ai.py          # 交互式：自定义 OpenAI 兼容端点 / DeepSeek / OpenAI / Ollama
python3 configure_ai.py --show   # 查看（密钥打码）
```

或用环境变量 `BUNMYAKU_PRESET`、`BUNMYAKU_BASE_URL`、`BUNMYAKU_MODEL`、`BUNMYAKU_API_KEY`。没有配置时页面进入“复制提示词”模式。发送内容见 [答疑上下文协议](tutor-protocol.md)。

## 课程包

格式见 [pack-format.md](pack-format.md)。改完内容先校验：

```sh
python3 tools/validate_pack.py examples/demo-pack --strict
python3 tools/import_text.py --text 课文.txt --vocab 词表.csv --out ~/my-pack --id my-pack
```

## 版本快照与回退

```sh
python3 manage.py create v1.0.0 --content ~/my-pack
python3 manage.py check v1.0.0
python3 manage.py publish v1.0.0
python3 manage.py run --bind 127.0.0.1 --port 8765     # 跟随 current 指针，发布后自动切换
python3 manage.py status
python3 manage.py rollback v0.9.0
```

`create` 把源码、课程包和拼好的页面连同 SHA-256 清单存进 `.local/releases/<版本>/`；`check` 验证完整性并在快照里跑服务端测试；`publish`／`rollback` 原子切换指针。`.local/` 不进 Git，也不是异地备份。

## 测试

```sh
python3 -m unittest -v                 # 服务端、发布流程、课程包工具
python3 serve.py --port 8766 &         # 浏览器测试默认访问这个端口
node test_browser.cjs && node test_learning.cjs && node test_resume.cjs
```

浏览器测试通过 `STUDY_URL` 改地址，`PLAYWRIGHT_MODULE` 指定已装好的 Playwright，`PLAYWRIGHT_CHANNEL=chrome` 使用本机 Chrome。GitHub Actions 在每次推送时跑全部测试（`.github/workflows/test.yml`），不发布任何东西。

## 截图

`docs/assets/` 用演示包重截：

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --window-size=1440,1000 --virtual-time-budget=4000 --screenshot=docs/assets/study-reading.png \
  "http://127.0.0.1:8765/#lesson=01&panel=read&word=v8"
```

页面支持 `#lesson=`、`panel=`（read／words／grammar／exercises／listening／notes）、`word=`、`answers=1`、`tutor=选中文字` 深链接。截图不得出现版权教材页面、个人笔记或密钥。
