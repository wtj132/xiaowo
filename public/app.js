const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
let timer = null;

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
};

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 1800);
}

class AuthError extends Error {}
async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...opts });
  if (res.status === 401) throw new AuthError();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

const STATUS = { saved: '已收好', organizing: '整理中…', drafted: '待确认', failed: '整理失败' };
const section = (name, count, more) => h('h2', { class: 'section' }, name, count != null ? h('span', { class: 'count' }, count) : null, more ?? null);
const fmt = (id) => `${id.slice(4, 6)}-${id.slice(6, 8)} ${id.slice(9, 11)}:${id.slice(11, 13)}`;

// ------------------------------------------------------------------ 登录
function renderLogin() {
  clearInterval(timer);
  const input = h('input', { class: 'field', type: 'password', placeholder: '口令', autocomplete: 'current-password', 'aria-label': '口令' });
  const err = h('div', { class: 'hint' });
  const go = async () => {
    try {
      await post('/api/login', { password: input.value });
      route();
    } catch (e) { err.textContent = e.message; }
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  app.replaceChildren(h('div', { class: 'login' }, h('h1', {}, '进来'), input, err, h('div', { class: 'row end', style: 'margin-top:12px' }, h('button', { class: 'primary', onclick: go }, '登录'))));
  input.focus();
}

// ------------------------------------------------------------------ 首页
let compose = { clientId: crypto.randomUUID(), files: [] };

const DAY = 864e5;
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const idDate = (id) => `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}`;
const greet = () => { const hr = new Date().getHours(); return hr < 5 ? '夜深了' : hr < 11 ? '早上好' : hr < 14 ? '中午好' : hr < 18 ? '下午好' : '晚上好'; };
const imgUrl = (rawId, name) => `/api/files/${rawId}/${name}`;

// 与旅程页一致的国家色
const COUNTRY_COLOR = { DK: '#E9798A', SE: '#8DB0EE', NO: '#7CCAA9', FI: '#A3D9E8', IS: '#C3CDE0', DE: '#E2B98A', EE: '#9AB7D6', IE: '#8FCB8F' };

async function renderHome() {
  const ta = h('textarea', { placeholder: '丢点什么进来：刚看完的电影、一张截图、一个链接、一句话…', 'aria-label': '投递内容', rows: 2 });
  const thumbs = h('div', { class: 'thumbs' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const send = h('button', { class: 'primary' }, '收下');
  const priv = h('input', { type: 'checkbox', 'aria-label': '私密' });

  const drawThumbs = () => thumbs.replaceChildren(...compose.files.map((f, i) =>
    h('img', { src: URL.createObjectURL(f), alt: f.name, title: '点一下移除', onclick: () => { compose.files.splice(i, 1); drawThumbs(); } })));
  const addFiles = (list) => { compose.files.push(...[...list].filter((f) => f.type.startsWith('image/'))); drawThumbs(); };
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  ta.addEventListener('paste', (e) => { const imgs = [...e.clipboardData.files]; if (imgs.length) { e.preventDefault(); addFiles(imgs); } });
  // 文字多了输入框跟着长高
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`; });

  send.addEventListener('click', async () => {
    if (!ta.value.trim() && !compose.files.length) return toast('先写点什么，或者贴张图');
    const fd = new FormData();
    fd.append('clientId', compose.clientId);
    fd.append('text', ta.value);
    if (priv.checked) fd.append('private', '1');
    compose.files.forEach((f) => fd.append('images', f));
    send.disabled = true;
    try {
      await api('/api/capture', { method: 'POST', body: fd });
      compose = { clientId: crypto.randomUUID(), files: [] };
      ta.value = ''; ta.style.height = ''; priv.checked = false; drawThumbs(); toast('收下了 ✓');
      loadLists();
    } catch (e) {
      if (e instanceof AuthError) return renderLogin();
      toast(e.message === 'Failed to fetch' ? '网络不通，内容还在，再点一次' : e.message);
    } finally { send.disabled = false; }
  });

  const now = new Date();
  const sub = h('p', {}, `${now.getMonth() + 1} 月 ${now.getDate()} 日 · 周${WEEK[now.getDay()]}`);
  const pendingBox = h('div');
  const tripsBox = h('div');
  const memoryBox = h('div');
  const feedBox = h('div');
  app.replaceChildren(
    h('section', { class: 'hello' }, h('h1', {}, `${greet()}，今天过得怎么样？`), sub),
    h('div', { class: 'capture' }, ta, thumbs,
      h('div', { class: 'row' },
        h('button', { class: 'quiet', onclick: () => fileInput.click() }, '＋ 图片'), fileInput,
        h('label', { class: 'toggle', title: '私密：不发给助手，不进 GitHub 备份' }, priv, '私密'),
        h('span', { class: 'spacer' }), send),
      h('div', { class: 'hint-line' }, '不用选分类，助手会整理好，你确认就行。')),
    pendingBox, tripsBox, memoryBox, feedBox);
  drawThumbs();

  async function loadLists() {
    try {
      const [{ items }, { entries }, trips] = await Promise.all([
        api('/api/inbox'), api('/api/entries'), api('/api/trips').then((r) => r.trips).catch(() => []),
      ]);
      // 这周记了几条：最近 7 天收进来的所有东西
      const weekAgo = ymd(new Date(Date.now() - 6 * DAY));
      const thisWeek = entries.filter((e) => idDate(e.id) >= weekAgo).length + items.filter((i) => idDate(i.raw.id) >= weekAgo).length;
      sub.textContent = `${now.getMonth() + 1} 月 ${now.getDate()} 日 · 周${WEEK[now.getDay()]}${thisWeek ? ` · 这周记了 ${thisWeek} 条` : ''}`;
      drawTrail(entries);

      pendingBox.replaceChildren(...(items.length ? [section('待你确认', items.length), h('div', { class: 'pending' }, items.map(inboxItem))] : []));
      tripsBox.replaceChildren(...tripStrip(trips));
      memoryBox.replaceChildren(...memory(entries));
      feedBox.replaceChildren(section('最近', entries.length || null),
        entries.length ? h('div', { class: 'feed' }, entries.slice(0, 30).map(entryCard))
          : h('div', { class: 'empty' }, '还没有条目。丢点什么进来，这里就是第一条。'));
      clearInterval(timer);
      if (items.some((i) => i.raw.status === 'saved' || i.raw.status === 'organizing')) timer = setInterval(loadLists, 4000);
    } catch (e) { if (e instanceof AuthError) renderLogin(); }
  }
  loadLists();
}

/** 顶栏右侧：连续记录了几天（今天还没记就从昨天往回数） */
function drawTrail(entries) {
  const el = document.getElementById('trail');
  const days = new Set(entries.map((e) => idDate(e.id)));
  let d = new Date(), n = 0;
  if (!days.has(ymd(d))) d = new Date(Date.now() - DAY);
  while (days.has(ymd(d))) { n++; d = new Date(d.getTime() - DAY); }
  el.hidden = n < 2;
  el.replaceChildren(...Array.from({ length: Math.min(n, 4) }, (_, i) => h('i', { style: `opacity:${(i + 1) / Math.min(n, 4)}` })), `${n} 天`);
  el.title = `连续记录 ${n} 天`;
}

function tripStrip(trips) {
  const today = ymd(new Date());
  const active = trips.filter((t) => t.end >= today).sort((a, b) => a.start.localeCompare(b.start));
  if (!active.length) return [];
  return [section('旅程', null, h('a', { class: 'more', href: '/trips.html' }, `全部 ${trips.length} →`)),
    h('div', { class: 'trips-row' }, active.map((t) => {
      const live = t.start <= today;
      const n = Math.round((Date.parse(live ? today : t.start) - Date.parse(live ? t.start : today)) / DAY);
      return h('a', { class: 'tripc', href: `/trip.html?id=${t.id}` },
        h('div', { class: 'cover' }, t.cover ? h('img', { src: t.cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() }) : null),
        h('div', { style: 'flex:1;min-width:0' },
          h('div', { class: `k ${live ? 'live' : ''}` }, live ? `进行中 · 第 ${n + 1} 天` : `还有 ${n} 天出发`),
          h('div', { class: 't' }, t.name),
          h('div', { class: 'stripe' }, t.countries.map((c) => h('span', { style: `background:${COUNTRY_COLOR[c] ?? '#B9C4CC'}` }))),
          h('div', { class: 's' }, `${t.start.slice(5).replace('-', '.')} – ${t.end.slice(5).replace('-', '.')} · ${t.days} 天`)));
    }))];
}

/** 那年今日：往年同一周（前后 3 天）记下的东西，没有就不显示 */
function memory(entries) {
  const now = new Date();
  const md = (d) => (d.getMonth() + 1) * 100 + d.getDate();
  const lo = md(new Date(Date.now() - 3 * DAY)), hi = md(new Date(Date.now() + 3 * DAY));
  const hit = entries.find((e) => {
    const y = +e.id.slice(0, 4), v = +e.id.slice(4, 8);
    return y < now.getFullYear() && (lo <= hi ? v >= lo && v <= hi : v >= lo || v <= hi);
  });
  if (!hit) return [];
  const years = now.getFullYear() - +hit.id.slice(0, 4);
  return [section('那年今日', null, h('span', { class: 'count' }, `${years} 年前的这周`)),
    h('a', { class: 'memory', href: `#/entry/${hit.id}` },
      h('div', { class: 'pic' }, hit.images?.length ? h('img', { src: imgUrl(hit.rawId, hit.images[0]), alt: '', loading: 'lazy' }) : null),
      h('div', { class: 'txt' },
        h('div', { class: 'when' }, `${idDate(hit.id).replaceAll('-', '.')}${hit.tags.length ? ` · ${hit.tags.slice(0, 2).join(' · ')}` : ''}`),
        h('div', { class: 'q' }, hit.summary || hit.title),
        h('div', { class: 'from' }, hit.title)))];
}

function inboxItem({ raw, draft }) {
  const d = draft?.draft;
  const title = d?.title || raw.text.split('\n')[0].slice(0, 40) || raw.urls[0] || '（图片）';
  const state = raw.status === 'failed' ? ['bad', '整理失败'] : raw.status === 'drafted' ? ['wait', '待你确认'] : ['', STATUS[raw.status] || raw.status];
  return h('a', { class: 'pend', href: `#/draft/${raw.id}` },
    h('span', { class: `tag ${state[0]}` }, h('i'), raw.private ? `私密 · ${state[1]}` : state[1]),
    h('div', { class: 't' }, title),
    d?.summary ? h('div', { class: 'd' }, d.summary) : null,
    draft?.questions?.length ? h('div', { class: 'ask' }, draft.questions.slice(0, 2).map((q) => h('span', {}, q.length > 18 ? `${q.slice(0, 18)}…` : q))) : null);
}

const entryCard = (e) => h('a', { class: 'f', href: `#/entry/${e.id}` },
  e.images?.length ? h('div', { class: 'shot' }, h('img', { src: imgUrl(e.rawId, e.images[0]), alt: '', loading: 'lazy' })) : null,
  h('div', { class: 'body' },
    h('span', { class: `tag ${e.private ? 'priv' : ''}` }, h('i'), e.private ? '私密' : (e.tags[0] || '随手记')),
    h('div', { class: 't' }, e.title),
    e.summary ? h('div', { class: 'd' }, e.summary) : null,
    h('div', { class: 'm' }, h('span', {}, fmt(e.id)), e.tags.slice(1, 3).map((t) => h('span', { class: 'chip' }, t)))));

// ------------------------------------------------------------------ 表单（草稿 / 条目共用）
function draftForm(d) {
  const title = h('input', { class: 'field title-field', value: d.title, 'aria-label': '标题' });
  const summary = h('textarea', { class: 'field', rows: 4, 'aria-label': '摘要' }, d.summary);
  const points = h('textarea', { class: 'field', rows: 6, 'aria-label': '要点' }, d.keyPoints.join('\n'));
  const tags = h('input', { class: 'field', value: d.tags.join('，'), 'aria-label': '标签' });
  const value = () => ({
    title: title.value.trim(), summary: summary.value.trim(),
    keyPoints: points.value.split('\n').map((s) => s.trim()).filter(Boolean),
    tags: tags.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    sourceUrls: d.sourceUrls,
  });
  const el = h('div', {}, h('label', { class: 'lab' }, '标题'), title, h('label', { class: 'lab' }, '摘要'), summary,
    h('label', { class: 'lab' }, '要点（一行一条）'), points, h('label', { class: 'lab' }, '标签（逗号分隔）'), tags);
  return { el, value };
}

const links = (urls) => urls.map((u) => h('div', {}, h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, u)));
const images = (rawId, names) => h('div', { class: 'thumbs' }, names.map((n) =>
  h('a', { href: `/api/files/${rawId}/${n}`, target: '_blank' }, h('img', { src: `/api/files/${rawId}/${n}`, alt: '原图', loading: 'lazy' }))));

// ------------------------------------------------------------------ 草稿详情
async function renderDraft(id) {
  const { items } = await api('/api/inbox');
  const item = items.find((i) => i.raw.id === id);
  if (!item) { location.hash = '#/'; return; }
  const { raw, draft: rec } = item;
  const back = h('a', { class: 'back', href: '#/' }, '← 返回');
  const parts = [back, h('header', { class: 'article-head' }, h('div', { class: 'kicker' }, STATUS[raw.status] || '草稿', raw.private ? h('span', {}, '私密') : null), h('h1', {}, rec?.draft?.title || '整理中…'), h('div', { class: 'meta' }, fmt(raw.id)))];

  parts.push(section('原料'), h('div', { class: 'source' }, h('div', { class: 'raw' }, raw.text || '（无文字）'), raw.urls.length ? links(raw.urls) : null, raw.images.length ? images(raw.id, raw.images) : null));

  if (raw.status === 'saved' || raw.status === 'organizing') {
    parts.push(h('p', { class: 'empty' }, '助手正在整理，稍后会出现草稿…'));
    app.replaceChildren(...parts);
    timer = setInterval(() => route(), 4000);
    return;
  }
  if (raw.status === 'failed' || rec?.status === 'failed') {
    parts.push(h('p', { class: 'hint' }, `整理失败：${rec?.error || '未知原因'}`),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: async () => { await post(`/api/raw/${raw.id}/retry`); toast('已重新排队'); location.hash = '#/'; } }, '重试'),
        h('button', { class: 'danger', onclick: async () => { await post(`/api/drafts/${raw.id}/discard`); location.hash = '#/'; } }, '丢弃')));
    app.replaceChildren(...parts);
    return;
  }

  const form = draftForm(rec.draft);
  if (rec.error) parts.push(h('p', { class: 'hint' }, `上次重做没成功（${rec.error}），下面还是上一版草稿。`));
  if (rec.draft.possibleDuplicateOf) parts.push(h('p', { class: 'hint' }, '可能和已有条目重复：', h('a', { href: `#/entry/${rec.draft.possibleDuplicateOf}` }, '去看看')));
  if (raw.private) parts.push(h('p', { class: 'hint' }, '私密：助手不会看到，需要自己填写。'));
  if (rec.questions.length && !raw.private) {
    const answer = h('textarea', { class: 'field', rows: 3, placeholder: '一句话回答就行', 'aria-label': '回答助手的问题' });
    parts.push(section('助手想问', rec.questions.length), ...rec.questions.map((q) => h('div', { class: 'q' }, q)), answer,
      h('div', { class: 'row end', style: 'margin-top:8px' }, h('button', { onclick: async () => {
        if (!answer.value.trim()) return toast('先写点回答');
        await post(`/api/drafts/${raw.id}/answer`, { answers: answer.value }); toast('已发给助手重做'); location.hash = '#/';
      } }, '回答并重做')));
  }
  const note = h('input', { class: 'field', placeholder: '想让助手怎么改？一句话', 'aria-label': '重做的要求' });
  parts.push(section('草稿'), form.el,
    h('div', { class: 'row actions' },
      h('button', { class: 'primary', onclick: async () => {
        const v = form.value();
        if (!v.title) return toast('标题不能为空');
        const { entryId } = await post(`/api/drafts/${raw.id}/confirm`, { draft: v }); toast('已入库 ✓'); location.hash = `#/entry/${entryId}`;
      } }, '确认入库'),
      h('button', { class: 'danger', onclick: async () => { await post(`/api/drafts/${raw.id}/discard`); location.hash = '#/'; } }, '丢弃')),
    raw.private ? null : [h('label', { class: 'lab' }, '让助手重做'), note,
      h('div', { class: 'row end', style: 'margin-top:8px' }, h('button', { onclick: async () => {
        if (!note.value.trim()) return toast('先写要求');
        await post(`/api/drafts/${raw.id}/redo`, { note: note.value }); toast('已发给助手重做'); location.hash = '#/';
      } }, '重做'))]);
  app.replaceChildren(...parts.flat().filter(Boolean));
}

// ------------------------------------------------------------------ 条目详情
async function renderEntry(id) {
  const { entry, images: names } = await api(`/api/entries/${id}`);
  const view = () => app.replaceChildren(...[
    h('a', { class: 'back', href: '#/' }, '← 返回'),
    h('header', { class: 'article-head' },
      h('div', { class: 'kicker' }, entry.private ? h('span', {}, '私密') : null, entry.tags.map((t) => h('span', {}, t))),
      h('h1', {}, entry.title),
      entry.summary ? h('p', { class: 'deck' }, entry.summary) : null,
      h('div', { class: 'meta' }, fmt(entry.id), entry.private ? ' · 不在 GitHub 备份里' : '')),
    entry.keyPoints.length ? [section('要点', entry.keyPoints.length), h('ol', { class: 'points' }, entry.keyPoints.map((k) => h('li', {}, h('span', {}, k))))] : null,
    names.length ? [section('原图', names.length), h('div', { class: 'gallery' }, names.map((n) => h('a', { href: `/api/files/${entry.rawId}/${n}`, target: '_blank' }, h('img', { src: `/api/files/${entry.rawId}/${n}`, alt: '原图', loading: 'lazy' }))))] : null,
    entry.sourceUrls.length ? [section('来源'), h('div', { class: 'links' }, links(entry.sourceUrls))] : null,
    section('原始内容'), h('div', { class: 'source' }, h('div', { class: 'raw' }, entry.rawText || '（无文字）')),
    h('div', { class: 'row', style: 'margin-top:24px' }, h('button', { onclick: edit }, '编辑'))].flat().filter(Boolean));
  const edit = () => {
    const form = draftForm(entry);
    app.replaceChildren(h('a', { class: 'back', href: '#/' }, '← 返回'), form.el, h('div', { class: 'row actions' },
      h('button', { class: 'primary', onclick: async () => {
        const { entry: next } = await api(`/api/entries/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft: form.value() }) });
        Object.assign(entry, next); toast('已保存'); view();
      } }, '保存'), h('button', { class: 'quiet', onclick: view }, '取消')));
  };
  view();
}

// ------------------------------------------------------------------ 路由
async function route() {
  clearInterval(timer);
  const [, kind, id] = location.hash.split('/');
  app.classList.toggle('article', kind === 'draft' || kind === 'entry');
  document.querySelectorAll('[data-nav="home"]').forEach((a) => a.classList.toggle('on', !kind || kind === ''));
  window.scrollTo(0, 0);
  try {
    if (kind === 'draft' && id) await renderDraft(id);
    else if (kind === 'entry' && id) await renderEntry(id);
    else await renderHome();
  } catch (e) {
    if (e instanceof AuthError) renderLogin();
    else { toast(e.message); }
  }
}
window.addEventListener('hashchange', route);
document.getElementById('tab-plus').addEventListener('click', async () => {
  if (location.hash && location.hash !== '#/') { location.hash = '#/'; await new Promise((r) => setTimeout(r, 120)); }
  const ta = app.querySelector('.capture textarea');
  ta?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  ta?.focus();
});
route();
