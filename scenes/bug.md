---
{
  "id": "bug",
  "name": "踩坑",
  "group": "knowledge",
  "color": "#62b6ea",
  "detect": "报错、异常、配置失败、调试过程、\"踩坑\"\"终于搞定\"\"原来是\"；终端/日志截图",
  "fields": [
    {
      "key": "symptom",
      "label": "现象",
      "type": "longtext",
      "required": true
    },
    {
      "key": "cause",
      "label": "原因",
      "type": "longtext"
    },
    {
      "key": "fix",
      "label": "怎么修",
      "type": "longtext",
      "hint": "可以放命令或代码"
    },
    {
      "key": "lesson",
      "label": "下次注意",
      "type": "text"
    },
    {
      "key": "stack",
      "label": "技术栈",
      "type": "text",
      "hint": "如 Caddy / Node / iOS"
    },
    {
      "key": "solved",
      "label": "已解决",
      "type": "enum",
      "options": [
        "已解决",
        "未解决"
      ],
      "default": "已解决"
    }
  ],
  "ask": [
    "solved"
  ],
  "enrich": "报错信息可以联网查原因和官方修法，附来源",
  "card": "note"
}
---
## 怎么整理
- 标题写成"现象 + 关键词"，方便日后按报错搜到，比如「Caddy 证书签发失败：80 端口被占」。
- 现象里保留原始报错文字（原样，不翻译）。
- 主人没说原因或修法时不要编，留空并只问"解决了吗"。
- 「下次注意」如果是一条能推广的经验（不只适用于这一次），就提议成一张卡片。
