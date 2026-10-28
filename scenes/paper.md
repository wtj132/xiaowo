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
  "card": "note",
  "cards": true
}
---
## 怎么整理
- 这是一条**文献笔记**：用中文讲清论文本身，不加评价。
- 另外提议 1–3 张**卡片**（cards），每张只讲一个可以脱离这篇论文也读得懂的观点：
  - title 是一句完整的话（"用历史轨迹回放评测自进化 agent，避免自己出题自己考"），不是主题词。
  - draft 是一两句初稿，主人可能会改写。
  - links：从「已有条目」里挑 0–3 张真正相关的，type 取 对比/前身/用到/支持/反驳/同主题 之一，reason 写一句为什么相关。没有就给空数组，不要硬凑。
- 拆不出完整观点时 cards 给空数组。
