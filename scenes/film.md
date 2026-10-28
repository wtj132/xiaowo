---
{
  "id": "film", "name": "影视", "group": "taste", "color": "#f2b544",
  "detect": "电影、剧集、纪录片、动画、综艺；豆瓣/IMDb/B站番剧/各视频平台的影视链接；\"看了\"\"二刷\"\"追剧\"\"想看\"",
  "fields": [
    { "key": "work", "label": "片名", "type": "text", "required": true },
    { "key": "year", "label": "年份", "type": "number" },
    { "key": "creator", "label": "导演/主创", "type": "text" },
    { "key": "status", "label": "状态", "type": "enum", "options": ["想看", "在看", "看完", "弃了"], "default": "看完" },
    { "key": "progress", "label": "进度", "type": "text", "hint": "在看时填，如 第 9/12 集" },
    { "key": "date", "label": "看的日期", "type": "date" },
    { "key": "with", "label": "和谁", "type": "text" },
    { "key": "rating", "label": "星级", "type": "stars" },
    { "key": "review", "label": "一句话", "type": "text" },
    { "key": "quotes", "label": "台词/片段", "type": "list" }
  ],
  "ask": ["rating", "with"],
  "enrich": "联网补 年份、导演/主创；只补事实，不替主人写感受",
  "card": "poster"
}
---
## 怎么整理
- 标题用片名（剧集可带季数）。oneLine 优先用主人原话的感受，没有就写一句片子是什么。
- 「一句话」原样保留主人的感受，不要润色成影评。
- 主人说"想看"时 status=想看，不问星级和和谁。
- 台词只收主人自己写下的，不要从网上抄台词。
- 已有条目里有同一部作品时，用 possibleDuplicateOf 指出（二刷）。
