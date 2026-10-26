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
  app.replaceChildren(h('div', { class: 'login card' }, h('h1', {}, '进来'), input, err, h('div', { class: 'row end', style: 'margin-top:12px' }, h('button', { class: 'primary', onclick: go }, '登录'))));
  input.focus();
}

// ------------------------------------------------------------------ 首页
let compose = { clientId: crypto.randomUUID(), files: [] };

async function renderHome() {
  const ta = h('textarea', { placeholder: '丢点什么进来：链接、文字、截图…', 'aria-label': '投递内容', autofocus: true });
  const thumbs = h('div', { class: 'thumbs' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const send = h('button', { class: 'primary' }, '发送');

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
    compose.files.forEach((f) => fd.append('images', f));
    send.disabled = true;
    try {
      await api('/api/capture', { method: 'POST', body: fd });
      compose = { clientId: crypto.randomUUID(), files: [] };
      ta.value = ''; drawThumbs(); toast('已收好 ✓');
      loadLists();
    } catch (e) {
      if (e instanceof AuthError) return renderLogin();
      toast(e.message === 'Failed to fetch' ? '网络不通，内容还在，再点一次发送' : e.message);
    } finally { send.disabled = false; }
  });

  const pending = h('div', { class: 'list' });
  const recent = h('div', { class: 'list' });
  app.replaceChildren(
    h('div', { class: 'card capture' }, ta, thumbs,
      h('div', { class: 'row' }, h('button', { class: 'quiet', onclick: () => fileInput.click() }, '＋ 图片'), fileInput, h('span', { class: 'spacer' }), send)),
    h('h2', {}, '待你确认'), pending, h('h2', {}, '最近入库'), recent);
  drawThumbs();

  async function loadLists() {
    try {
      const [{ items }, { entries }] = await Promise.all([api('/api/inbox'), api('/api/entries')]);
      pending.replaceChildren(...(items.length ? items.map(inboxItem) : [h('div', { class: 'empty' }, '没有待处理的')]));
      recent.replaceChildren(...(entries.length ? entries.slice(0, 20).map(entryItem) : [h('div', { class: 'empty' }, '还没有条目')]));
      clearInterval(timer);
      if (items.some((i) => i.raw.status === 'saved' || i.raw.status === 'organizing')) timer = setInterval(loadLists, 4000);
    } catch (e) { if (e instanceof AuthError) renderLogin(); }
  }
  loadLists();
}

function inboxItem({ raw, draft }) {
  const title = draft?.draft?.title || raw.text.split('\n')[0].slice(0, 40) || raw.urls[0] || '（图片）';
  const asks = draft?.questions?.length;
  return h('a', { class: `card item`, href: `#/draft/${raw.id}` },
    h('div', { class: 'title' }, title),
    h('div', { class: 'meta' },
      h('span', { class: `chip ${raw.status === 'failed' ? 'bad' : raw.status === 'drafted' ? 'ask' : ''}` }, STATUS[raw.status] || raw.status),
      asks ? h('span', { class: 'chip ask' }, `助手有 ${asks} 个问题`) : null, fmt(raw.id)));
}
const entryItem = (e) => h('a', { class: 'card item', href: `#/entry/${e.id}` },
  h('div', { class: 'title' }, e.title), h('div', { class: 'meta' }, e.tags.map((t) => h('span', { class: 'chip' }, t)), fmt(e.id)));

// ------------------------------------------------------------------ 表单（草稿 / 条目共用）
function draftForm(d) {
  const title = h('input', { class: 'field', value: d.title, 'aria-label': '标题' });
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
  const back = h('a', { href: '#/' }, '← 返回');
  const parts = [back, h('h1', {}, rec?.draft?.title || '整理中…')];

  parts.push(h('div', { class: 'card' }, h('div', { class: 'raw' }, raw.text || '（无文字）'), raw.urls.length ? links(raw.urls) : null, raw.images.length ? images(raw.id, raw.images) : null));

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
  if (rec.draft.possibleDuplicateOf) parts.push(h('p', { class: 'hint' }, '可能和已有条目重复：', h('a', { href: `#/entry/${rec.draft.possibleDuplicateOf}` }, '去看看')));
  if (rec.questions.length) {
    const answer = h('textarea', { class: 'field', rows: 3, placeholder: '一句话回答就行', 'aria-label': '回答助手的问题' });
    parts.push(h('h2', {}, '助手想问'), ...rec.questions.map((q) => h('div', { class: 'q' }, q)), answer,
      h('div', { class: 'row end', style: 'margin-top:8px' }, h('button', { onclick: async () => {
        if (!answer.value.trim()) return toast('先写点回答');
        await post(`/api/drafts/${raw.id}/answer`, { answers: answer.value }); toast('已发给助手重做'); location.hash = '#/';
      } }, '回答并重做')));
  }
  const note = h('input', { class: 'field', placeholder: '想让助手怎么改？一句话', 'aria-label': '重做的要求' });
  parts.push(h('h2', {}, '草稿'), form.el,
    h('div', { class: 'row', style: 'margin-top:20px' },
      h('button', { class: 'primary', onclick: async () => {
        const v = form.value();
        if (!v.title) return toast('标题不能为空');
        const { entryId } = await post(`/api/drafts/${raw.id}/confirm`, { draft: v }); toast('已入库 ✓'); location.hash = `#/entry/${entryId}`;
      } }, '确认入库'),
      h('button', { class: 'danger', onclick: async () => { await post(`/api/drafts/${raw.id}/discard`); location.hash = '#/'; } }, '丢弃')),
    h('label', { class: 'lab' }, '让助手重做'), note,
    h('div', { class: 'row end', style: 'margin-top:8px' }, h('button', { onclick: async () => {
      if (!note.value.trim()) return toast('先写要求');
      await post(`/api/drafts/${raw.id}/redo`, { note: note.value }); toast('已发给助手重做'); location.hash = '#/';
    } }, '重做')));
  app.replaceChildren(...parts);
}

// ------------------------------------------------------------------ 条目详情
async function renderEntry(id) {
  const { entry, images: names } = await api(`/api/entries/${id}`);
  const view = () => app.replaceChildren(...[
    h('a', { href: '#/' }, '← 返回'), h('h1', {}, entry.title),
    h('div', {}, entry.tags.map((t) => h('span', { class: 'chip' }, t))),
    h('p', {}, entry.summary),
    entry.keyPoints.length ? h('ul', {}, entry.keyPoints.map((k) => h('li', {}, k))) : null,
    entry.sourceUrls.length ? [h('h2', {}, '来源'), links(entry.sourceUrls)] : null,
    names.length ? [h('h2', {}, '原图'), images(entry.rawId, names)] : null,
    h('h2', {}, '原始内容'), h('div', { class: 'raw' }, entry.rawText || '（无文字）'),
    h('div', { class: 'row', style: 'margin-top:24px' }, h('button', { onclick: edit }, '编辑'))].flat().filter(Boolean));
  const edit = () => {
    const form = draftForm(entry);
    app.replaceChildren(h('a', { href: '#/' }, '← 返回'), form.el, h('div', { class: 'row', style: 'margin-top:20px' },
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
