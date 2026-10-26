# iPhone：从"分享"菜单直接投进 life

目标：在 B 站、相册、Safari 等任何 App 里点「分享」→「丢进 life」，几秒内就收好，不用打开网站。

## 准备

- 站点网址：`https://<你的域名>`
- `API_TOKEN`：服务器 `.env` 里的那串（不是网站登录口令）。只放在这条快捷指令里，别发给别人。

## 创建快捷指令（iPhone「快捷指令」App）

1. 右上角 ＋ 新建，命名「丢进 life」。
2. 点右上角 ⓘ（设置）→ 打开「在共享表单中显示」，「接收」勾选：**URL、文本、图像**（其余取消）。
3. 添加动作 **「获取 URL 内容」**：
   - URL：`https://<你的域名>/api/capture`
   - 方法：**POST**
   - 请求头：`Authorization` = `Bearer <API_TOKEN>`
   - 请求正文：**表单**，添加字段：
     | 键 | 类型 | 值 |
     |---|---|---|
     | `clientId` | 文本 | 先加一个「随机数」动作（范围 1–999999999），再加「当前日期」动作，把这两个变量按顺序拼进来；每次投递值不同即可 |
     | `text` | 文本 | 变量「快捷指令输入」 |
     | `images` | 文件 | 变量「快捷指令输入」（输入是图片时） |
   - 如果想让链接、文字、图片走不同分支：先加「如果」动作按「快捷指令输入」的类型分开，各自只传对应字段（链接/文字传 `text`，图片传 `images`）。
4. 最后加动作 **「显示通知」**：内容「已收好 ✓」。
5. 在分享菜单里把它拖到常用位置。

## 先在电脑上验证接口（把域名和 token 换成你的）

```bash
curl -i -X POST https://<你的域名>/api/capture \
  -H "Authorization: Bearer <API_TOKEN>" \
  -F "clientId=$(uuidgen)" \
  -F "text=测试 https://example.com" \
  -F "images=@some.png"
```

期望：`HTTP/2 201`，返回 `{"id":"...","status":"saved"}`。不带 `Authorization` 应返回 401。

## 注意

- `clientId` 每次投递要不同；同一个 `clientId` 重复提交只会保存一份（断网重试不会重复）。
- 图片不超过 10MB；只支持 png/jpg/webp/heic。
- 投递成功只代表"已收好"，整理在后台进行，稍后在网站「待你确认」里看。
