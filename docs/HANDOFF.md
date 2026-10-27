# 交接文档：个人知识站（xiaowo）

最后更新：2026-10-27。写给下一个接手的人（或下一次会话的 Claude）。文档里**不含任何密码、密钥、口令**，它们的存放位置见第 4 节。

## 1. 这是什么

一个只给主人自己用的私有网站：随手把链接、图片、文字丢进去，助手（DeepSeek，经 dsh）整理成草稿，主人确认后入库。最终分两个板块：

- **life**：旅行、日记、小事、探店等。
- **knowledge**：知识卡片（论文、项目/工具、前端动效、概念/教程、会议笔记、踩坑记录）。

主人懂代码但不想自己改代码，改功能由 Claude 完成。最高原则是“顺手”，高于美观。外观方向：Claude 式暖纸张、安静、文字优先。

产品事实见 [PRODUCT.md](../PRODUCT.md)；原始设计见 [设计文档](superpowers/specs/2026-10-27-personal-knowledge-site-design.md)；v1 实施计划见 [计划](superpowers/plans/2026-10-27-capture-and-organize-v1.md)。

## 2. 当前状态

| 部分 | 状态 |
|---|---|
| v1：投递 → OCR → 联网查 → DeepSeek 整理 → 草稿 → 确认入库 | **已上线并跑通**（真实 DeepSeek 已验证） |
| https://xiaowo.work | 已上线，Let's Encrypt 证书，登录保护生效 |
| 代码备份 | github.com/wtj132/xiaowo（`main`） |
| 数据备份 | github.com/wtj132/xiaowo_data（`master`，**必须保持私有**），服务器每天 04:00 自动推送 |
| life / knowledge 两个板块与各类模板 | **只做了设计草图，没有写任何代码** |
| iOS 分享菜单快捷指令 | 说明文档已写（[deploy/ios-shortcut.md](../deploy/ios-shortcut.md)），**没在真机上试过** |
| 搜索、条目之间的链接 | 未做 |

测试：`npm test`，92 个全过；`npx tsc --noEmit` 干净。

## 3. 架构一页纸

- 后端：Node 24 + TypeScript + Hono，代码在 `src/`；前端是原生 JS/CSS，在 `public/`，无框架无构建；可作为 PWA 添加到主屏。
- 数据：纯文件，放在 `DATA_DIR`（服务器上是 `/var/lib/life/data`），它本身是 git 仓库，每次写入自动提交。
  - `inbox/<id>/raw.json` + 原图：原料，永不丢失。
  - `drafts/<id>.json`：助手的草稿和问题，状态 `pending / failed / confirmed / discarded`。
  - `entries/*.md`：确认后的条目，用 `<!--life:section-->` 标记分段。
- 登录：口令换签名 cookie（90 天）；iOS 快捷指令用 `Authorization: Bearer <API_TOKEN>`。有限流。
- 整理流程（`src/organizer.ts`、`src/queue.ts`）：串行队列 → 本地 tesseract OCR（中英文）→ free-search-mcp 联网查 → 调 dsh → 解析 JSON 草稿。来源资料用围栏隔离，防提示注入。
- dsh 对接（`src/dsh.ts`）：起子进程 `dsh --profile sdk-minimal`，换行分帧 JSON-RPC。回合结束的原因可能是字符串 `completed`，**也可能是对象 `{kind:"completed"}`**（线上踩过这个坑，已修）。

## 4. 服务器与账号

- 服务器：阿里云轻量，泰国，公网 IP `8.213.207.76`，用 `ssh admin@8.213.207.76`（公钥登录，不是 root，需要时 `sudo`）。不需要 ICP 备案。
- 域名：`xiaowo.work`（阿里云/万网注册，已实名；DNS 在阿里云云解析，`@` 指向服务器）。
- 反代：Caddy（`/etc/caddy/Caddyfile`），HTTPS 自动签发；站点本身监听 `127.0.0.1:8080`。
- 进程与用户（做了隔离）：
  - `life.service` 以用户 `life` 运行，代码在 `/opt/life`（已编译的 `dist/`）。
  - dsh 以另一个用户 `lifeagent` 运行，经 `sudo` 包装脚本 `/usr/local/lib/life/dsh-as-agent`（目的：助手读网页有提示注入风险，不能让它读到站点的密钥）。
- 机密存放位置（只写位置，不写内容）：
  - `/etc/life.env`（root 可读）：`APP_PASSWORD`、`API_TOKEN`、各路径配置。
  - `/var/lib/lifeagent/deepseek.key`（lifeagent 0600）：DeepSeek 密钥，由主人通过 `life-setup` 写入，Claude 从没见过。
- 备份：`life-backup.timer` 每天 04:00 把数据仓库推到 GitHub。用的是服务器上专用的 deploy key（`/var/lib/life/.ssh/id_backup`，只对 xiaowo_data 有写权限）。
- 本机（Mac）GitHub：访问 wtj132 的仓库要用 SSH 别名 `github-wtj132`（密钥 `~/.ssh/id_ed25519_wtj132`）。原来的 `id_ed25519` 属于另一个 GitHub 账号，别用错。

## 5. 常用操作

部署一次改动（目前是手工的，还没有一键脚本）：

```bash
cd /Users/wangtian/Desktop/life
npm test && npm run build
scp -r dist admin@8.213.207.76:/tmp/dist-new
ssh admin@8.213.207.76 'sudo rsync -a --chown=life:life /tmp/dist-new/ /opt/life/dist/ && sudo systemctl restart life && systemctl is-active life'
```

只改前端文件时，同理把 `public/` 同步到 `/opt/life/public/`。

看日志与状态：

```bash
ssh admin@8.213.207.76 'sudo journalctl -u life -n 50 --no-pager; systemctl is-active life caddy'
```

某条整理失败：数据仓库里对应 `drafts/<id>.json` 的 `error` 字段写着原因；修好后在页面点重试，或对 `POST /api/raw/<id>/retry` 发请求。

## 6. 已知问题与注意事项

- **主人电脑的 DNS 被代理软件劫持**（`dig` 返回 `198.18.x.x` 的假地址）。本机查域名不可信；要验证解析用 DoH，比如 `curl 'https://dns.alidns.com/resolve?name=xiaowo.work&type=A'`。浏览器打不开站点时先看代理规则。
- `/opt/life` 里有两个多余的东西：一张 `ChatGPT 图像….png` 和一个 `up/` 目录，是早期上传残留，不影响运行，可删。
- 服务器的 Caddy 是 2.6.2（较老）。以后升级不要影响 Let's Encrypt 的 http-01 流程。
- dsh 是预发布版（0.2.1-rc.2），版本已锁定，升级前要测。
- 推迟的小问题（不影响使用）：登录/确认接口收到 `null` 请求体会 500；前端缺少错误提示和 401 自动跳登录；重试/重做连点可能排重复（队列已去重大部分）；`process()` 在特定失败路径可能让原料停在 organizing。完整清单见 `.superpowers/sdd/2026-10-27-capture-and-organize-v1/progress.md`（该目录被 gitignore，只在主人电脑上）。
- 数据仓库里是私人内容和原图，**不要改成公开**。

## 7. 下一步（按顺序）

主人最常做的四件事：随手丢（1）、记踩坑（3）、记旅行/探店（5）、找东西（6）。

1. **先问清一件事**：主人会不会把工作内容（会议、内部方案）放进来。会的话必须做“私密”开关：私密条目只保存，不发给 DeepSeek 整理，也建议不进 GitHub 备份。设计稿里已画了开关，但尚未得到主人确认。
2. 定板块与信息结构：顶层 `life` / `knowledge`；手机底部导航“今天 / life / knowledge / 搜索”；首页“今天”= 输入框 + 待确认草稿 + 最近收的。
3. 各类型的卡片模板（字段见第 8 节），让助手按类型输出结构化字段；草稿确认时可改类型。
4. **按意思搜索**（模糊记忆找卡片，并说明为什么匹配）；卡片之间带关系类型的链接（对比 / 前身 / 用到 / 主题）。
5. 旅行：参考 `~/Downloads/nordic-trip.zip`（按天的行程、票券、账单、行李清单；深色按国家变色的视觉）。尚未决定是只引入“日志”，还是把规划功能也搬进来。
6. 收尾事项：iOS 快捷指令真机测试；一键部署脚本；清理 `/opt/life` 里的残留。

## 8. 设计成果（草图，非代码）

草图在 `.superpowers/brainstorm/83616-1793114374/content/`（gitignore，仅在主人电脑上），用 `home-and-types.html`、`knowledge-templates-v2.html`、`knowledge-card-v2.html` 三个文件即可还原：

- 外观：暖纸张底 `#efeadd`、卡片 `#fbf9f3`、墨色 `#26231f`、主色赭红 `#b85c38`；正文 Noto Sans SC，编号和代码用 IBM Plex Mono。每张卡片像一张**索引卡**：左上角按类型着色的小标签，右上角编号（如 `K-2610-27a`，年月日+序号）。
- 类型与字段：
  - 论文：解决什么 / 怎么做 / 怎么评测 / 结论
  - 项目·工具：用来干嘛 / 怎么装 / 适合场景 / 注意
  - 前端动效：预览 / 怎么实现（代码）/ 要点 / 参考
  - 概念·教程：通俗讲 / 例子 / 容易混 / 相关
  - 会议笔记：参会 / 结论 / 待办 / 下次
  - 踩坑记录：现象 / 原因 / 怎么修 / 下次注意 / 已解决
  - 探店·地点：在哪 / 点了什么 / 人均 / 评分
  - 旅行（按天）：去了 / 花费拆分 / 记一笔
  - 每张卡片开头都是一句话概括。
- 注意：做预览页时别把 CSS 类名取成 `card`，会和预览框架自带样式冲突，被裁掉标签（已踩过，改叫 `kcard`）。
- 也装了 impeccable 设计 skill，写好了 [PRODUCT.md](../PRODUCT.md)；它有提示新版本 v4.8.0，未更新（更新要主人明确同意）。

## 9. 与主人合作的约定

- 用中文回复。主人不想自己改代码，改动由 Claude 完成。
- 往外发内容的操作（推送、部署、改线上配置）先确认；密钥和口令永远让主人自己在终端输入，不要让对话里出现。
- 有“最高原则：顺手”：投递时不能要求选分类、填标签、填表单；助手只提议，不能未经确认覆盖主人的原文。
