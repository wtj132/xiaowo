---
{
  "id": "book", "name": "阅读", "group": "taste", "color": "#ef8160",
  "detect": "书、小说、漫画、长文；豆瓣读书/微信读书/Kindle 截图；\"读了\"\"在读\"\"划线\"\"摘抄\"",
  "fields": [
    { "key": "work", "label": "书名", "type": "text", "required": true },
    { "key": "author", "label": "作者", "type": "text" },
    { "key": "status", "label": "状态", "type": "enum", "options": ["想读", "在读", "读完", "弃了"], "default": "在读" },
    { "key": "progress", "label": "读到哪", "type": "text", "hint": "页码或百分比" },
    { "key": "date", "label": "日期", "type": "date" },
    { "key": "highlights", "label": "划线", "type": "list", "hint": "一行一条，可带页码" },
    { "key": "thoughts", "label": "我的想法", "type": "longtext" },
    { "key": "rating", "label": "星级", "type": "stars", "hint": "读完再打" }
  ],
  "ask": ["progress"],
  "enrich": "联网补 作者、出版年；只补事实",
  "card": "cover"
}
---
## 怎么整理
- 截图里 OCR 出来的段落放进「划线」，一段一条；保留主人原文，不改写。
- 「我的想法」只放主人自己写的话，没有就留空。
- 读完时才问星级；在读时问"读到哪了"。
