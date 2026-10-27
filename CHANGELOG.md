# Changelog

## 0.1.0 · 2026-10-27

第一个开放版本。

- 课程包格式 Pack v1：`pack.json` ＋ `lessons/*.json` ＋ `media/`；注音用 `漢字[かんじ]`，译文与注音带 `human`／`machine`／`unverified` 标记。
- `serve.py` 只认课程包：`--content` 或 `BUNMYAKU_CONTENT` 指定目录，媒体允许列表由课程包生成，页面在内存里拼装。
- 学习档案可配置：默认单人“我”，可在页面里加第二个人；笔记、作答、听力进度按包、课、档案分开保存。
- 答疑接口通用化：任意 OpenAI 兼容端点，DeepSeek／OpenAI／Ollama 预设；没有密钥时“复制提示词”；系统提示中性，个性化只来自课程包 `tutor` 字段和用户配置。
- 原创演示课程包（两课，CC0）与占位音频。
- `tools/validate_pack.py`、`tools/import_text.py`；`.claude/skills/make-course-pack` 与 `AGENTS.md` 给 agent 的课程包制作步骤。
- 服务端、发布流程、工具的 `unittest` 与三个 Playwright 浏览器测试；GitHub Actions 只跑测试。
- MIT 许可证（代码）；演示内容 CC0。
