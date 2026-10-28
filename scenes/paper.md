---
{
  "id": "paper", "name": "论文", "group": "knowledge", "color": "#a596f5",
  "detect": "论文、arXiv/OpenReview/ACL/DOI 链接、PDF 截图、\"这篇 paper\"",
  "fields": [
    { "key": "problem", "label": "解决什么", "type": "longtext", "required": true },
    { "key": "method", "label": "怎么做", "type": "longtext" },
    { "key": "evaluation", "label": "怎么评测", "type": "longtext" },
    { "key": "findings", "label": "结论", "type": "longtext" },
    { "key": "authors", "label": "作者/机构", "type": "text" },
    { "key": "venue", "label": "发表于", "type": "text", "hint": "会议/期刊/年份" },
    { "key": "why", "label": "我为什么存它", "type": "text" }
  ],
  "ask": ["why"],
  "enrich": "联网读论文摘要和正文要点；作者、年份、发表处必须来自来源",
  "card": "note"
}
---
## 怎么整理
- 这是一条**文献笔记**：用中文讲清论文本身，不加评价。
