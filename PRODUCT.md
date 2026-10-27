# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing codebase: Node/TypeScript + Hono server, vanilla JS/CSS frontend in `public/`, installable as a PWA. No frontend framework or build step.

## Users

One person (the owner), Chinese-speaking, comfortable with code but unwilling to edit it. Uses the site on an iPhone while out (dropping links, screenshots, text in the moment) and on a desktop when reviewing, reading and searching. The site is fully private behind a login; no sharing or other viewers.

## Product Purpose

A single private source of truth for what the owner collects and lives: knowledge material, travel logs, diaries, small everyday records. Dropping something in must be as fast as sending it in a chat; an assistant (DeepSeek) then turns the raw material into a finished, searchable entry the owner confirms. Success: material found months later is a complete, usable write-up, not a screenshot nobody can search.

## Positioning

Capture-first, assistant-organised, owner-confirmed. Nothing the assistant writes enters the library until the owner approves it, and the original material is always kept.

## Operating Context

- Two sections: **life** (travel, diary, small everyday notes) and **knowledge**.
- Every entry starts from the shared inbox: one capture box, plus an iOS share-sheet shortcut. The assistant drafts; the owner confirms, edits, redoes or discards.
- Knowledge is atomic cards that link to each other with typed relations (contrast, predecessor, uses, topic). Retrieval is fuzzy: the owner often remembers only a vague idea ("some agent self-evolution paper about evaluation") and needs the right card from that.
- Each entry type has its own template. Knowledge types the owner collects most: papers, open-source projects/tools, front-end motion/technique clips, concepts/tutorials, meeting notes. Life types: trips, diary, small notes.
- Travel reference: `nordic-trip` (a standalone planner with day-by-day itinerary, ticket-style transport legs, bill/budget, packing list, daily journal; dark country-tinted visuals). Source zip: `~/Downloads/nordic-trip.zip`.
- Data is Markdown and images in a git repo, backed up daily to a private GitHub repo.

## Capabilities and Constraints

- Live at https://xiaowo.work (Aliyun Thailand server, Caddy HTTPS). Code: github.com/wtj132/xiaowo. Data: private repo wtj132/xiaowo_data.
- Interface language and entry output are Chinese.
- Source image text comes from local OCR; the assistant does not see images, only extracted text plus the owner's description.
- Open: the exact fields of each template, life/knowledge routing rules, and how much of nordic-trip's planner functions (tickets, bill) come into the site versus only the log.

## Brand Commitments

Look pinned by the owner: Claude-like, warm paper, quiet, text first. Usability ("顺手") outranks beauty; the look is adjusted over time through use.

## Evidence on Hand

- `nordic-trip` bundle (unzipped copy in the session scratchpad) with real trip data structure (`trip.json`), its PRODUCT.md and DESIGN.md.
- Current capture/inbox UI in `public/`.
- Sample knowledge content exists only as mock examples; no real card data yet.

## Product Principles

- Capturing must never need a category, tag or form.
- The assistant proposes; the owner decides. Originals are never overwritten or lost.
- Findable by meaning, not by remembered keywords.
- One card, one idea; links carry the relation type.
- Phone in one hand outside beats polish on desktop.

## Accessibility & Inclusion

Chinese-first typography with readable sizes on phone; visible keyboard focus; respect reduced motion.
