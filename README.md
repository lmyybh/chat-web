# Chat Web

Chat Web 是一个本地优先的 AI 对话工具，支持 OpenAI 兼容接口。对话、分组、模型配置和消息记录保存在本机 SQLite 数据库中。

## 功能

- 管理多个模型提供方和模型，可为不同对话切换模型。
- 使用流式响应，并支持停止生成和模型思考内容展示。
- 创建对话分组，为同一分组下的对话共享系统提示词。
- 编辑历史用户消息并从该位置重新生成回答。
- 渲染 Markdown/GFM、代码高亮，并支持复制消息或代码块。
- 在桌面端和移动端使用同一套响应式界面。

## 本地开发

建议使用 Node.js 20 或更高版本。

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。首次启动时会自动创建数据库和默认的 OpenAI 提供方、模型及对话分组。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `OPENAI_API_KEY` | 默认 OpenAI 提供方使用的服务端 API Key。 |
| `OPENAI_BASE_URL` | 默认 OpenAI 兼容接口地址，缺省为 `https://api.openai.com/v1`。 |
| `OPENAI_COMPATIBLE_PROVIDERS` | 新数据库首次初始化时使用的提供方 JSON 数组。 |
| `CHAT_WEB_DB_PATH` | 可选的 SQLite 文件路径，缺省为 `data/chat-web.sqlite`。 |

提供方也可以在设置面板中添加、编辑和删除。界面中录入的 API Key 保存在本机 SQLite 中，不会通过提供方查询接口返回浏览器；由环境变量提供的 Key 不会复制进数据库。

本项目没有用户账户和远程访问鉴权，适合在本机或可信网络环境中运行。

## 数据与命令

默认数据库位于 `data/chat-web.sqlite`，对应的 WAL/SHM 文件同样位于 `data/`。这些运行数据已被 Git 忽略。

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm start
```
