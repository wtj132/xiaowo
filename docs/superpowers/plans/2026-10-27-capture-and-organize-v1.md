# 个人知识站 v1（随手投递 + 助手整理）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一个单用户、受登录保护的网站：手机/电脑随手投递链接、图片、文字，DeepSeek Harness 助手在后台整理成条目草稿，用户确认后入库。

**Architecture:** 单个 Node/TypeScript 服务（Hono）同时提供 API、静态前端和后台整理队列。数据全部是纯文件，存放在一个独立的私有 Git 仓库目录（`DATA_DIR`），每次变更自动提交。整理时，服务先通过 MCP 客户端调用 free-search-mcp 抓取网页/联网查资料、用本地 `tesseract` 识别图中文字，再把材料交给常驻的 `dsh --profile sdk-minimal` 子进程（stdio JSON-RPC）生成草稿 JSON。

**Tech Stack:** Node 24、TypeScript、Hono、vitest、`@modelcontextprotocol/sdk`（连接 free-search-mcp）、系统 `tesseract`（chi_sim+eng）、`git`、原生 JS/CSS 前端（无框架）、Caddy（HTTPS）。

**Spec:** `docs/superpowers/specs/2026-10-27-personal-knowledge-site-design.md`

## Global Constraints

- 仅单用户；所有 `/api/*`（除登录）必须鉴权；站点无公开页面。
- 界面和条目输出一律中文；英文来源由助手翻译/概括并保留原文链接。
- 投递**不得**要求选择分类/标签/表单字段；点发送即保存原料，永不因整理失败而丢失。
- 助手未经用户确认不得写入 `entries/`；已确认条目可再编辑。
- 数据为 Markdown + 图片文件，是唯一真源；`DATA_DIR` 是独立 Git 仓库，导出 = 克隆。
- DSH：`provider=deepseek-official`、`model=deepseek-v4-pro`、profile `sdk-minimal`；必须先 `initialize` 再 `session/prompt`；assistant 文本按 `message.id` 分组、只取 `type=text` 块；spawn 前剔除继承的 `DSH_HOME`、`DSH_PROFILE`、`DSH_WEB_URL`，改设项目内 `DSH_BRIDGE_HOME`；API key 只注入子进程环境，不进仓库、不进日志。
- DSH 的沙箱必须收紧（低权限系统用户、限定工作目录），不得以 danger-full-access 暴露到公网。
- 图片不发给第三方，只用本地 OCR。
- 外观参考 Claude：暖色纸张底色、安静、文字优先；"顺手"高于美观。
- 不在 v1：搜索页、旅行日志、随笔、小工具页、推送通知、多条原料合并。

## Review Focus

- 超长/垃圾输入（空提交、仅空白、10MB 图片、非图片文件）：应被拒绝并给出明确中文错误，不产生空原料。
- 同一个链接重复投递：应各自保存为独立原料（不丢），整理时在草稿中提示"可能重复"。
- DSH 返回的不是合法 JSON（夹带说明文字或代码围栏）：应容错提取；仍失败则原料保留、状态标记为"整理失败"并可重试。
- 网页抓取失败（B 站拦截、超时）：不应让整理失败；只用链接标题/用户描述继续，并在问题里告知用户。
- 手机端投递中途断网/重复点击：不应产生两份原料（客户端携带幂等 `clientId`）。

---

## File Structure

```
life/
  package.json, tsconfig.json, vitest.config.ts, .gitignore (data/, .env, .dsh/)
  src/
    config.ts           环境变量 → Config
    auth.ts             口令登录、会话 Cookie、Bearer token（给 iOS 快捷指令）
    store.ts            原料/草稿/条目的文件读写 + git 提交
    ocr.ts              tesseract 包装
    search.ts           free-search-mcp 的 MCP 客户端（fetchPage / research）
    dsh.ts              DSH JSON-RPC 桥（接口 DshClient；另有 FakeDsh 供测试）
    organizer.ts        拼提示词、调用 DSH、解析草稿 JSON
    queue.ts            串行后台队列，状态机
    api.ts              Hono 路由
    server.ts           入口：装配并监听
  public/               index.html, app.js, style.css, manifest.webmanifest, icons
  test/                 与 src 同名的 *.test.ts，test/fixtures/
  deploy/               Dockerfile 或 systemd 单元、Caddyfile、hardening.md、ios-shortcut.md
```

数据目录（独立 Git 仓库，`DATA_DIR`）：

```
inbox/<id>/raw.json          原料元数据：{id, clientId, createdAt, text, urls[], images[], note?, status, ocrText?}
inbox/<id>/img-<n>.<ext>     原图
drafts/<id>.json             草稿：{id, rawId, version, draft: Draft|null, questions: string[], status, error?, history[]}
entries/<id>.md              已确认条目（frontmatter + 正文）
```

共享类型（定义在 `src/store.ts` 并导出）：

```ts
type RawStatus = 'saved' | 'organizing' | 'drafted' | 'failed' | 'confirmed' | 'discarded';
interface Raw { id: string; clientId: string; createdAt: string; text: string; urls: string[];
  images: string[]; status: RawStatus; ocrText?: string }
interface Draft { title: string; summary: string; keyPoints: string[]; tags: string[];
  sourceUrls: string[]; possibleDuplicateOf?: string }
interface DraftRecord { id: string; rawId: string; version: number; draft: Draft | null;
  questions: string[]; status: 'pending' | 'confirmed' | 'discarded' | 'failed'; error?: string }
```

---

### Task 1: 项目脚手架与配置

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/config.ts`, `test/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): Config`，`Config = { port: number; dataDir: string; password: string; apiToken: string; dshBin: string; dshHome: string; dshWorkspace: string; searchCmd: string[]; tesseractLangs: string }`

- [ ] **Step 1:** `git init` 项目根；写失败测试 `loadConfig` 缺少 `APP_PASSWORD`/`API_TOKEN`/`DATA_DIR` 时抛出含变量名的错误；齐全时返回默认 `port=8080`、`tesseractLangs='chi_sim+eng'`。
- [ ] **Step 2:** `npx vitest run test/config.test.ts`，预期 FAIL。
- [ ] **Step 3:** 实现 `loadConfig`；`package.json` 脚本 `dev`、`test`、`build`、`start`。
- [ ] **Step 4:** 同一命令，预期 PASS。
- [ ] **Step 5:** 提交 `chore: scaffold project and config`。

### Task 2: 文件存储与 Git 提交

**Files:**
- Create: `src/store.ts`, `test/store.test.ts`

**Interfaces:**
- Produces（均基于 `Store` 类，构造参数 `dataDir: string`；首次使用若不是 git 仓库则 `git init`）：
  - `createRaw(input: {clientId: string; text: string; urls: string[]; images: {name: string; data: Buffer}[]}): Promise<Raw>` —— 同一 `clientId` 重复调用返回已有原料
  - `getRaw(id)`, `updateRaw(id, patch: Partial<Raw>)`, `listRaw(status?: RawStatus)`
  - `saveDraft(rec: DraftRecord)`, `getDraft(id)`, `listDrafts(status?)`
  - `confirmDraft(draftId: string, edited: Draft): Promise<{entryId: string}>` —— 写 `entries/<id>.md`（frontmatter：title、tags、sources、createdAt、rawId；正文含摘要、要点、保留的原始文字原文）
  - `getEntry(id)`, `listEntries()`, `updateEntry(id, edited: Draft)`
  - 每次写操作后 `git add -A && git commit -m "<动作>: <id>"`

- [ ] **Step 1:** 失败测试（临时目录）：`createRaw` 保存 `raw.json` 与图片并产生一次提交；相同 `clientId` 第二次调用不新增目录；`confirmDraft` 生成的 md 含原始文字原文；`listRaw('saved')` 只返回对应状态。
- [ ] **Step 2:** 运行，预期 FAIL。
- [ ] **Step 3:** 实现 `Store`。id 用时间戳 + 随机后缀（`20261027-153000-ab12`）。用 `child_process.execFile('git', ...)`，串行化写操作避免并发提交冲突。
- [ ] **Step 4:** 运行，预期 PASS。
- [ ] **Step 5:** 提交 `feat: file store with git commits`。

### Task 3: 鉴权

**Files:**
- Create: `src/auth.ts`, `test/auth.test.ts`

**Interfaces:**
- Produces: `authMiddleware(cfg: Config): MiddlewareHandler`（放行 `/api/login`、`/login*`、静态资源 `/manifest.webmanifest`、`/icons/*`；其余要求有效会话 Cookie **或** `Authorization: Bearer <apiToken>`）；`loginRoute(cfg)`：`POST /api/login {password}` 正确则设置 `HttpOnly; Secure; SameSite=Lax`、有效期 90 天的会话 Cookie。

- [ ] **Step 1:** 失败测试：无凭据访问 `/api/inbox` → 401；错误口令 → 401；正确口令 → 200 且 `Set-Cookie`；带该 Cookie 访问 → 200；Bearer token 访问 `/api/capture` → 非 401；连续 10 次错误口令后同 IP 被限速（429）。
- [ ] **Step 2:** 运行，预期 FAIL。
- [ ] **Step 3:** 实现；口令比较用 `timingSafeEqual`；会话为签名 Cookie（HMAC，密钥由 `APP_PASSWORD` 派生）；按 IP 简单内存限速。
- [ ] **Step 4:** 运行，预期 PASS。
- [ ] **Step 5:** 提交 `feat: password session and bearer auth`。

### Task 4: 投递接口

**Files:**
- Create: `src/api.ts`（先含 capture 路由）, `test/capture.test.ts`

**Interfaces:**
- Consumes: `Store.createRaw`、`authMiddleware`
- Produces: `POST /api/capture`，`multipart/form-data` 或 JSON：字段 `clientId`（必填）、`text`、`url`（可重复，也自动从 `text` 中提取 http(s) 链接）、`images`（可重复文件）。成功 `201 {id, status:'saved'}`；立即返回，不等整理。

- [ ] **Step 1:** 失败测试：仅文字 → 201；仅链接 → 201 且 `urls` 含该链接；一张 PNG → 201 且文件落盘；空/纯空白无附件 → 400 `{error:"内容不能为空"}`；单图 >10MB → 413；非图片文件 → 400；同一 `clientId` 重复提交 → 200 返回同一 `id`，目录不新增。
- [ ] **Step 2:** 运行，预期 FAIL。
- [ ] **Step 3:** 实现路由与校验（图片类型限 png/jpeg/webp/heic，HEIC 在 Task 5 的 OCR 前转换）；保存后调用 `queue.enqueue(rawId)`（Task 8 提供，此处先注入一个可替换的 `enqueue` 回调）。
- [ ] **Step 4:** 运行，预期 PASS。
- [ ] **Step 5:** 提交 `feat: capture endpoint`。

### Task 5: 本地 OCR

**Files:**
- Create: `src/ocr.ts`, `test/ocr.test.ts`, `test/fixtures/hello-zh-en.png`

**Interfaces:**
- Produces: `ocrImage(path: string, langs: string): Promise<string>`；HEIC 先用 `sips`/`heif-convert`（服务器 Linux 用 `heif-convert`）转 PNG；`tesseract` 缺失时抛出带安装提示的错误。

- [ ] **Step 1:** 失败测试：对含"你好 hello"的夹具图返回文本包含 `hello`；不存在的文件抛错；`tesseract` 不在 PATH 时（测试里临时改 PATH）错误信息含 `tesseract`。
- [ ] **Step 2:** 运行，预期 FAIL。
- [ ] **Step 3:** 实现：`execFile('tesseract', [path, 'stdout', '-l', langs])`，超时 60 秒。
- [ ] **Step 4:** 运行，预期 PASS（需本机已装 tesseract 与 chi_sim 数据；README 写明）。
- [ ] **Step 5:** 提交 `feat: local OCR`。

### Task 6: 搜索与网页抓取（free-search-mcp 客户端）

**Files:**
- Create: `src/search.ts`, `test/search.test.ts`

**Interfaces:**
- Produces: `interface SearchClient { fetchPage(url: string): Promise<{ok: boolean; title?: string; markdown?: string; error?: string}>; research(question: string): Promise<{ok: boolean; markdown?: string; error?: string}>; close(): Promise<void> }`；`createSearchClient(cmd: string[]): SearchClient`（用 MCP SDK 的 stdio 传输拉起 `cfg.searchCmd`，调用其 `fetch` 与 `research` 工具）；`FakeSearch` 供测试。**任何异常/超时（30 秒）都返回 `{ok:false, error}`，不抛出。**

- [ ] **Step 1:** 失败测试（针对一个用 Node 写的假 MCP 服务器夹具，实现 `fetch`/`research` 两个工具）：`fetchPage` 返回其 markdown；夹具故意超时 → `ok:false` 且含 `error`；夹具进程崩溃后再次调用能重启连接。
- [ ] **Step 2:** 运行，预期 FAIL。
- [ ] **Step 3:** 实现；连接懒启动，崩溃后下次调用重建。
- [ ] **Step 4:** 运行，预期 PASS。
- [ ] **Step 5:** 提交 `feat: search client over MCP`。

### Task 7: DSH 桥

**Files:**
- Create: `src/dsh.ts`, `test/dsh.test.ts`, `test/fixtures/fake-dsh.mjs`

**Interfaces:**
- Produces: `interface DshClient { ask(prompt: string, opts?: {timeoutMs?: number}): Promise<string>; close(): Promise<void> }`；`createDshClient(cfg: Config): DshClient`。`ask` 每次**新会话**（新 `sessionId`，避免条目间串话），返回该 turn 内所有 `type=text` 块按 `message.id` 分组后的最终文本拼接；`turn/end` 的 `reason` 非 `completed` 时抛错；默认超时 180 秒。进程崩溃/退出后下次 `ask` 自动重启并重新 `initialize`。
- 实现 JSON-RPC 的 `initialize`（provider/model/cwd）→ `session/prompt`（contentBlocks）→ 监听 `session.event`（`assistant/message`、`turn/end`）与 `session.status`。参考用户的 `~/Desktop/dsh-embed/server.mjs`（已跑通）。

- [ ] **Step 1:** 失败测试（用 `fake-dsh.mjs` 按真实协议响应的假进程，经 `DSH_BIN` 指向）：未 `initialize` 前发 prompt 的假进程会拒绝，客户端必须先握手；同一 turn 两条 assistant 消息（先工具调用空文本、后正文）→ 只返回正文；`reasoning` 块不出现在结果里；`turn/end` reason=`max-tokens` → 抛错；假进程中途退出 → 下一次 `ask` 成功；子进程环境不含 `DSH_PROFILE`、`DSH_WEB_URL`，`DSH_HOME` 等于配置的 bridge home。
- [ ] **Step 2:** 运行，预期 FAIL。
- [ ] **Step 3:** 实现；换行分帧；API key 从 `DEEPSEEK_API_KEY` 环境变量读取并仅注入子进程环境，日志中不得出现。
- [ ] **Step 4:** 运行，预期 PASS。
- [ ] **Step 5:** 提交 `feat: DSH stdio JSON-RPC bridge`。

### Task 8: 整理器与后台队列

**Files:**
- Create: `src/organizer.ts`, `src/queue.ts`, `test/organizer.test.ts`, `test/queue.test.ts`

**Interfaces:**
- Consumes: `Store`、`DshClient`、`SearchClient`、`ocrImage`
- Produces:
  - `organize(raw: Raw, deps: {store; dsh; search; ocr}, note?: string): Promise<{draft: Draft; questions: string[]}>`：① OCR 全部图片并写入 `raw.ocrText`；② 对每个链接 `fetchPage`，失败则记录原因继续；③ 若材料仍很少则 `research` 用标题/用户描述查补充；④ 拼提示词（中文输出、只输出一个 JSON 对象 `{title, summary, keyPoints, tags, questions}`、材料不足时在 `questions` 里提最多 3 个简单问题但**仍尽力给出草稿**、英文材料译为中文并保留原文链接、与已有条目标题高度相似时设置 `possibleDuplicateOf`）；⑤ `dsh.ask` 并解析。
  - `parseDraftJson(text: string): unknown` 容错：去掉代码围栏、从夹杂说明中提取第一个平衡的 `{...}`，仍失败则抛错。
  - `class Queue { constructor(deps, opts); enqueue(rawId: string): void; redo(draftId: string, note: string): void; onIdle(): Promise<void> }`：**串行**执行；`raw.status` 流转 `saved → organizing → drafted | failed`；失败写 `DraftRecord{status:'failed', error}`；启动时把遗留的 `organizing` 重置为 `saved` 并重新入队。

- [ ] **Step 1:** 失败测试（`FakeDsh` 返回预设文本，`FakeSearch`、假 OCR）：只有 B 站链接 + 用户一句话 → 草稿含该描述的信息，且 `FakeSearch.research` 被调用；`fetchPage` 失败 → 仍产出草稿且 `questions` 非空并提到抓取失败；DSH 返回带 ```json 围栏且前后有说明 → 解析成功；DSH 返回无 JSON → `raw.status==='failed'`，原料文件仍在；英文网页材料 → 提示词中包含"中文"与原文链接；两个原料同时入队 → 严格按序处理（`FakeDsh` 记录调用时间不重叠）；`redo(draftId, note)` → 提示词含该 note 且 `version` 递增；服务重启场景（预置 `organizing` 的原料）→ 被重新处理。
- [ ] **Step 2:** 运行，预期 FAIL。
- [ ] **Step 3:** 实现以上签名；提示词模板放在 `src/organizer.ts` 顶部常量，便于日后调整。
- [ ] **Step 4:** 运行，预期 PASS。
- [ ] **Step 5:** 提交 `feat: organizer and serial queue`。

### Task 9: 草稿与条目 API

**Files:**
- Modify: `src/api.ts`
- Create: `test/drafts-api.test.ts`

**Interfaces:**
- Produces（均需鉴权）：
  - `GET /api/inbox` → `{items: {raw: Raw; draft?: DraftRecord}[]}`，待处理优先、按时间倒序
  - `GET /api/drafts/:id`
  - `POST /api/drafts/:id/confirm` body `{draft: Draft}`（可为用户编辑后的版本）→ `{entryId}`
  - `POST /api/drafts/:id/discard`
  - `POST /api/drafts/:id/redo` body `{note: string}` → `202`
  - `POST /api/drafts/:id/answer` body `{answers: string}` → 等同带回答的 redo
  - `POST /api/raw/:id/retry`（整理失败后重试）
  - `GET /api/entries`、`GET /api/entries/:id`、`PUT /api/entries/:id`、`GET /api/files/:rawId/:name`（原图，需鉴权，防路径穿越）

- [ ] **Step 1:** 失败测试：confirm 后 `entries/` 出现文件且原料 `confirmed`；对 `failed` 草稿 confirm → 409；discard 后不入库；redo 触发 `queue.redo`；`/api/files/../../etc/passwd` → 400/404；未鉴权 → 401。
- [ ] **Step 2:** 运行，预期 FAIL。
- [ ] **Step 3:** 实现路由。
- [ ] **Step 4:** 运行，预期 PASS。
- [ ] **Step 5:** 提交 `feat: draft and entry endpoints`。

### Task 10: 服务入口装配

**Files:**
- Create: `src/server.ts`, `test/e2e.test.ts`

**Interfaces:**
- Consumes: 以上所有；Produces: `createApp(cfg, deps?)`（便于测试注入假依赖）与可执行入口。

- [ ] **Step 1:** 失败的端到端测试（全部使用假依赖，真实 Store 与临时目录）：登录 → `POST /api/capture`（一个链接+一句话）→ `await queue.onIdle()` → `GET /api/inbox` 出现状态 `drafted` 的草稿 → confirm → `GET /api/entries` 含该条目 → `DATA_DIR` 的 git log 含对应提交。
- [ ] **Step 2:** 运行，预期 FAIL。
- [ ] **Step 3:** 实现装配；静态资源从 `public/` 提供；优雅退出时关闭 DSH 与 MCP 子进程。
- [ ] **Step 4:** 运行 `npx vitest run`，预期全部 PASS。
- [ ] **Step 5:** 提交 `feat: wire server`。

### Task 11: 前端（手机优先，Claude 风格）

**Files:**
- Create: `public/index.html`, `public/app.js`, `public/style.css`, `public/manifest.webmanifest`, `public/icons/*`

**Interfaces:**
- Consumes: Task 4、9 的 API。

页面要求（用 `mcp__Claude_Browser__*` 实测，手机视口 375 宽与桌面各截图）：
- 登录页（单口令）。
- 首页：**顶部大输入框始终可见**，可粘贴文字/链接、点按钮或直接粘贴图片添加图片，一个"发送"按钮；发送成功立刻清空并出现"已收好"，每次提交生成 `clientId`（UUID）以便断网重试不重复。
- 其下是"待你确认"列表（草稿卡片 + 助手的问题 + 回答框）与"最近入库"列表；整理中/失败有明确状态与"重试"。
- 草稿详情：可直接编辑标题/摘要/要点/标签，按钮：确认入库、丢弃、让助手重做（带一句话）。
- 条目详情页：渲染摘要、要点、原链接、原图、原始文字。
- PWA：`manifest.webmanifest`（名称、图标、`display: standalone`）；无需离线缓存。
- 风格：暖色纸张底、衬线标题、克制配色，支持深色模式（`prefers-color-scheme`）；触控目标 ≥44px；无水平滚动。

- [ ] **Step 1:** 实现页面与脚本。
- [ ] **Step 2:** 用 `FakeDsh` 模式（环境变量 `FAKE_ORGANIZER=1` 启动本地服务）端到端手测：投递 → 看到草稿 → 确认 → 出现在"最近入库"；读取控制台无报错。
- [ ] **Step 3:** 手机与桌面视口各截图，核对输入框在首屏、无水平滚动。
- [ ] **Step 4:** 提交 `feat: frontend`。

### Task 12: iOS 分享通道

**Files:**
- Create: `deploy/ios-shortcut.md`

- [ ] **Step 1:** 写出 iOS 快捷指令的逐步配置（接收"分享菜单"的 URL/文本/图片 → "获取 URL 内容"POST 到 `https://<域名>/api/capture`，表单字段 `clientId`（用"随机数/UUID"动作）、`text`、`url`、`images`，请求头 `Authorization: Bearer <API_TOKEN>`；成功后显示通知"已收好"）。
- [ ] **Step 2:** 在本地服务上用 `curl` 以同样的请求头和字段验证接口返回 201（命令写进该文档）。
- [ ] **Step 3:** 提交 `docs: iOS shortcut setup`。

### Task 13: 部署与加固

**Files:**
- Create: `deploy/Dockerfile`（或 systemd 单元）、`deploy/Caddyfile`、`deploy/hardening.md`、`deploy/README.md`

**Interfaces:** 服务器为 Linux（用户将租用）；用户需提供域名与服务器登录方式——**此任务开始前先向用户确认这两项**。

- [ ] **Step 1:** 在服务器上验证 DSH：装 Node 24，`npm i -g @deepseek-ai/dsh`（锁定当前 0.2.1-rc.2），用低权限专用系统用户配置 `DEEPSEEK_API_KEY`，运行最小 JSON-RPC 握手脚本，预期收到 `turn/end` completed。若安装失败，停下来向用户汇报，不要自行换方案。
- [ ] **Step 2:** 安装 `tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-eng libheif-examples git` 与 `uv`，按 free-search-mcp README 启动其 MCP 服务，验证 `fetch` 一个公开网页成功。
- [ ] **Step 3:** 以专用低权限用户运行本服务（systemd：`NoNewPrivileges`、`ProtectSystem=strict`、`ReadWritePaths` 仅限 `DATA_DIR` 与 DSH home、`PrivateTmp`）；DSH 的工作目录限定在一个空的专用目录；Caddy 提供 HTTPS 并反代；防火墙仅开放 80/443/SSH。
- [ ] **Step 4:** 为 `DATA_DIR` 配置私有 Git 远端的定时推送（每日），作为备份；在 `hardening.md` 记录恢复步骤。
- [ ] **Step 5:** 线上验收：手机浏览器登录；iOS 快捷指令从 B 站分享一个链接 → 数分钟内出现草稿 → 确认入库；`git log` 有对应提交。提交 `chore: deployment`。

---

## Self-Review

- **Spec coverage:** 投递（T4、T11、T12）、立即保存（T2/T4）、后台整理含联网/问题/OCR（T5–T8）、草稿确认/编辑/丢弃/重做（T9、T11）、条目结构含原文与原图（T2、T11）、Git 真源与导出（T2、T13）、登录（T3）、iOS 分享（T12）、PWA（T11）、DSH 接入与安全收紧（T7、T13）、中文输出（T8 提示词）。非目标均未包含。
- **Type consistency:** `Raw`/`Draft`/`DraftRecord` 在文件结构一节统一定义，T2、T8、T9 使用同名；`DshClient.ask`、`SearchClient.fetchPage/research`、`Queue.enqueue/redo/onIdle` 在定义与使用处一致。
- **Proportion:** 计划只给出签名、测试断言与具体值，未写函数体。
