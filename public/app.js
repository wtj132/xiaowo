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
const CN_MONTH = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
{
  const d = new Date();
  document.getElementById('issue').textContent = `${CN_MONTH[d.getMonth()]}月 · 第 ${d.getDate()} 期 · 周${WEEK[d.getDay()]}`;
}
const section = (name, count) => h('h2', { class: 'section' }, name, count != null ? h('span', { class: 'count' }, String(count).padStart(2, '0')) : null);
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

async function renderHome() {
  const ta = h('textarea', { placeholder: '丢点什么进来：链接、文字、截图…', 'aria-label': '投递内容', autofocus: true });
  const thumbs = h('div', { class: 'thumbs' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const send = h('button', { class: 'primary' }, '发送');
  const priv = h('input', { type: 'checkbox', 'aria-label': '私密' });

  const drawThumbs = () => thumbs.replaceChildren(...compose.files.map((f, i) =>
    h('img', { src: URL.createObjectURL(f), alt: f.name, title: '点一下移除', onclick: () => { compose.files.splice(i, 1); drawThumbs(); } })));
  const addFiles = (list) => { compose.files.push(...[...list].filter((f) => f.type.startsWith('image/'))); drawThumbs(); };
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  ta.addEventListener('paste', (e) => { const imgs = [...e.clipboardData.files]; if (imgs.length) { e.preventDefault(); addFiles(imgs); } });

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
      ta.value = ''; priv.checked = false; drawThumbs(); toast('已收好 ✓');
      loadLists();
    } catch (e) {
      if (e instanceof AuthError) return renderLogin();
      toast(e.message === 'Failed to fetch' ? '网络不通，内容还在，再点一次发送' : e.message);
    } finally { send.disabled = false; }
  });

  const pendingHead = h('div');
  const pending = h('div', { class: 'pending' });
  const recentHead = h('div');
  const recent = h('div');
  app.replaceChildren(
    h('div', { class: 'capture' }, ta, thumbs,
      h('div', { class: 'row' }, h('button', { class: 'quiet', onclick: () => fileInput.click() }, '＋ 图片'), fileInput, h('label', { class: 'toggle', title: '私密：不发给助手，不进 GitHub 备份' }, priv, ' 私密'), h('span', { class: 'spacer' }), send)),
    pendingHead, pending, recentHead, recent);
  drawThumbs();

  async function loadLists() {
    try {
      const [{ items }, { entries }] = await Promise.all([api('/api/inbox'), api('/api/entries')]);
      pendingHead.replaceChildren(items.length ? section('待你确认', items.length) : '');
      pending.replaceChildren(...items.map(inboxItem));
      recentHead.replaceChildren(section('最近入库', entries.length || null));
      const [lead, ...rest] = entries.slice(0, 21);
      recent.replaceChildren(...(lead ? [leadItem(lead), h('div', { class: 'toc' }, rest.map(entryItem))] : [h('div', { class: 'empty' }, '还没有条目。丢点什么进来，这里就是第一篇。')]));
      clearInterval(timer);
      if (items.some((i) => i.raw.status === 'saved' || i.raw.status === 'organizing')) timer = setInterval(loadLists, 4000);
    } catch (e) { if (e instanceof AuthError) renderLogin(); }
  }
  loadLists();
}

function inboxItem({ raw, draft }) {
  const title = draft?.draft?.title || raw.text.split('\n')[0].slice(0, 40) || raw.urls[0] || '（图片）';
  const asks = draft?.questions?.length;
  return h('a', { class: 'item', href: `#/draft/${raw.id}` },
    h('div', { class: 'title' }, title),
    h('span', { class: `chip state ${raw.status === 'failed' ? 'bad' : raw.status === 'drafted' ? 'ask' : ''}` }, STATUS[raw.status] || raw.status),
    h('div', { class: 'meta' }, raw.private ? '私密 · ' : '', fmt(raw.id), asks ? ` · 助手有 ${asks} 个问题` : ''));
}
const entryItem = (e) => h('a', { class: 'item', href: `#/entry/${e.id}` },
  h('div', {},
    h('div', { class: 'title' }, e.title),
    h('div', { class: 'meta' }, e.private ? h('span', { class: 'chip state' }, '私密') : null, e.tags.slice(0, 3).map((t) => h('span', { class: 'chip' }, t)), fmt(e.id))));
const leadItem = (e) => h('a', { class: 'lead item', href: `#/entry/${e.id}` },
  h('div', { class: 'kicker' }, '头条', e.private ? h('span', {}, '私密') : null, e.tags.slice(0, 2).map((t) => h('span', {}, t))),
  h('div', { class: 'title' }, e.title),
  e.summary ? h('p', { class: 'deck' }, e.summary) : null,
  h('div', { class: 'meta', style: 'margin-top:12px' }, fmt(e.id)));

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
  const back = h('a', { class: 'back', href: '#/' }, '← 回到首页');
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
    h('a', { class: 'back', href: '#/' }, '← 回到首页'),
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
    app.replaceChildren(h('a', { class: 'back', href: '#/' }, '← 回到首页'), form.el, h('div', { class: 'row actions' },
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
route();
