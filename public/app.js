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
/** 发生时间：条目写了就用，没写（旧条目）就用入库时间，按浏览器所在时区 */
const pad2 = (n) => String(n).padStart(2, '0');
const localStampOf = (iso) => { const d = new Date(iso); return `${ymd(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const occurred = (e) => e.date || localStampOf(e.createdAt);
const dayLabel = (day) => {
  const today = ymd(new Date()), yest = ymd(new Date(Date.now() - DAY));
  const d = new Date(`${day}T12:00`);
  const md = `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${WEEK[d.getDay()]}`;
  return day === today ? `今天 · ${md}` : day === yest ? `昨天 · ${md}` : d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()} 年 ${md}`;
};
const isKnowledge = (e) => sceneOf(e.scene)?.group === 'knowledge';

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
  const cardBox = h('div');
  const feedBox = h('div');
  app.replaceChildren(
    h('section', { class: 'hello' }, h('h1', {}, `${greet()}，今天过得怎么样？`), sub),
    h('div', { class: 'capture' }, ta, thumbs,
      h('div', { class: 'row' },
        h('button', { class: 'quiet', onclick: () => fileInput.click() }, '＋ 图片'), fileInput,
        h('label', { class: 'toggle', title: '私密：不发给助手，不进 GitHub 备份' }, priv, '私密'),
        h('span', { class: 'spacer' }), send),
      h('div', { class: 'hint-line' }, '不用选分类，助手会整理好，你确认就行。')),
    pendingBox, tripsBox, memoryBox, cardBox, feedBox);
  drawThumbs();

  async function loadLists() {
    try {
      const [{ items }, { entries }, trips] = await Promise.all([
        api('/api/inbox'), api('/api/entries'), api('/api/trips').then((r) => r.trips).catch(() => []), loadScenes(),
      ]);
      // 这周记了几条：最近 7 天收进来的所有东西
      const weekAgo = ymd(new Date(Date.now() - 6 * DAY));
      const thisWeek = entries.filter((e) => idDate(e.id) >= weekAgo).length + items.filter((i) => idDate(i.raw.id) >= weekAgo).length;
      sub.textContent = `${now.getMonth() + 1} 月 ${now.getDate()} 日 · 周${WEEK[now.getDay()]}${thisWeek ? ` · 这周记了 ${thisWeek} 条` : ''}`;
      drawTrail(entries);

      pendingBox.replaceChildren(...(items.length ? [section('待你确认', items.length), h('div', { class: 'pending' }, items.map(inboxItem))] : []));
      tripsBox.replaceChildren(...tripStrip(trips));
      memoryBox.replaceChildren(...memory(entries));
      cardBox.replaceChildren(...cardShelf(entries).filter(Boolean));
      // 生活和品味按发生时间串成时间线，按天分组
      const life = entries.filter((e) => !isKnowledge(e)).sort((a, b) => occurred(b).localeCompare(occurred(a))).slice(0, 40);
      const days = [];
      for (const e of life) { const day = occurred(e).slice(0, 10); (days.at(-1)?.day === day ? days.at(-1).items : (days.push({ day, items: [] }), days.at(-1).items)).push(e); }
      feedBox.replaceChildren(section('时间线', null, h('span', { class: 'count' }, '生活和品味，按发生时间')),
        days.length ? h('div', { class: 'timeline' }, days.map(({ day, items: es }) => h('div', { class: 'tday' },
          h('div', { class: 'tdate' }, dayLabel(day)), h('div', { class: 'feed' }, es.map(entryCard)))))
          : h('div', { class: 'empty' }, '还没有生活记录。看了部电影、去了个地方、想记一句话，都丢进来。'));
      clearInterval(timer);
      if (items.some((i) => i.raw.status === 'saved' || i.raw.status === 'organizing')) timer = setInterval(loadLists, 4000);
    } catch (e) { if (e instanceof AuthError) renderLogin(); }
  }
  loadLists();
}

/**
 * 卡片盒（Zettelkasten）：永久卡片单独成区，不混在时间流里。
 * 显示最近的卡片和它的链接数；文献笔记（论文等）14 天没拆出卡片的，轻轻提一下「待消化」。
 */
function cardShelf(entries) {
  const cards = entries.filter((e) => e.scene === 'card');
  const linksOf = (id) => entries.filter((x) => x.relations?.some((l) => l.to === id)).length;
  const cited = new Set(cards.flatMap((c) => (c.relations ?? []).filter((l) => l.type === '出处').map((l) => l.to)));
  const sources = new Set([...SCENES.values()].filter((s) => s.group === 'knowledge' && s.id !== 'card').map((s) => s.id));
  const notes = entries.filter((e) => sources.has(e.scene)).slice(0, 6);
  const old = ymd(new Date(Date.now() - 14 * DAY));
  const undigested = entries.filter((e) => sources.has(e.scene) && !cited.has(e.id) && idDate(e.id) <= old).slice(0, 3);
  const more = h('span', { class: 'count' }, cards.length ? `${cards.length} 张卡片 · ${notes.length ? `${entries.filter((e) => sources.has(e.scene)).length} 条笔记` : '一张只讲一个观点'}` : '原子卡片 + 带理由的链接');
  const noteList = notes.length ? [h('div', { class: 'zsub' }, '笔记'), h('div', { class: 'feed' }, notes.map(entryCard))] : [];
  if (!cards.length && !undigested.length) {
    return [section('知识', null, more), h('div', { class: 'zk-empty' },
      h('b', {}, '卡片盒还空着'),
      h('p', {}, '整理论文、踩坑这类知识时，小小蜗会提议拆出 0–3 张卡片：每张一句完整的观点，带着「为什么连到另一张」的理由，你勾选后才入库。也可以直接丢一句你自己的想法进来，它会被当成一张卡片。')), ...noteList];
  }
  return [section('知识', null, more),
    cards.length ? h('div', { class: 'zk' }, cards.slice(0, 6).map((c) => {
      const out = c.relations?.length ?? 0, inn = linksOf(c.id);
      return h('a', { class: 'zkc', href: `#/entry/${c.id}` },
        h('div', { class: 'zt' }, c.title),
        h('div', { class: 'zm' }, h('span', {}, `→ ${out}`), h('span', {}, `← ${inn}`), c.fields?.source ? h('span', { class: 'src' }, `出自 ${c.fields.source}`) : null));
    })) : null,
    undigested.length ? h('div', { class: 'digest' }, h('span', { class: 'dh' }, '待消化'),
      undigested.map((e) => h('a', { href: `#/entry/${e.id}` }, e.title)), h('small', {}, '存了两周还没拆出卡片，有空用自己的话写一句。')) : null,
    ...noteList];
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
    d ? sceneTag(d.scene, raw.private ? `私密 · ${state[1]}` : state[1]) : h('span', { class: `tag ${state[0]}` }, h('i'), raw.private ? `私密 · ${state[1]}` : state[1]),
    h('div', { class: 't' }, title),
    d?.oneLine || d?.summary ? h('div', { class: 'd' }, d.oneLine || d.summary) : null,
    d?.cards?.length ? h('div', { class: 'ask' }, h('span', {}, `可拆 ${d.cards.length} 张卡片`)) : null,
    draft?.questions?.length ? h('div', { class: 'ask' }, draft.questions.slice(0, 2).map((q) => h('span', {}, q.length > 18 ? `${q.slice(0, 18)}…` : q))) : null);
}

const entryCard = (e) => h('a', { class: `f ${e.images?.length && e.scene !== 'card' ? 'has-thumb' : ''}`, href: `#/entry/${e.id}`, style: `--c:${sceneOf(e.scene)?.color ?? 'var(--line)'}` },
  e.images?.length && e.scene !== 'card' ? h('div', { class: 'thumb' }, h('img', { src: imgUrl(e.rawId, e.images[0]), alt: '', loading: 'lazy' })) : null,
  h('div', { class: 'body' },
    sceneTag(e.scene, e.private ? '私密' : ''),
    h('div', { class: `t ${e.scene === 'card' ? 'idea' : ''}` }, e.title),
    e.oneLine && e.oneLine !== e.title ? h('div', { class: 'd' }, e.oneLine) : e.summary ? h('div', { class: 'd' }, e.summary) : null,
    h('div', { class: 'm' }, h('span', {}, isKnowledge(e) ? occurred(e).slice(5, 10).replace('-', '.') : occurred(e).slice(11) || '全天'),
      e.fields?.rating ? h('span', { class: 'starv' }, stars(e.fields.rating)) : null,
      e.fields?.status ? h('span', {}, e.fields.status) : e.fields?.solved ? h('span', {}, e.fields.solved) : null,
      e.tags.slice(0, 2).map((t) => h('span', { class: 'chip' }, t)))));

// ------------------------------------------------------------------ 场景（scenes/*.md，服务器给出字段定义）
let SCENES = null;
async function loadScenes() {
  if (!SCENES) {
    const { scenes } = await api('/api/scenes');
    SCENES = new Map(scenes.map((s) => [s.id, s]));
  }
  return SCENES;
}
const sceneOf = (id) => SCENES?.get(id || 'note') ?? SCENES?.get('note');
const sceneTag = (id, extra) => { const s = sceneOf(id); return h('span', { class: 'tag', style: `color:${s?.color ?? 'var(--sky)'}` }, h('i'), s?.name ?? '随手记', extra ? ` · ${extra}` : ''); };
const stars = (n) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);

/** 一个字段的输入控件；返回 { el, get } */
function fieldInput(f, value) {
  if (f.type === 'stars') {
    let v = Number(value) || 0;
    const wrap = h('div', { class: 'stars', role: 'radiogroup', 'aria-label': f.label });
    const draw = () => wrap.replaceChildren(...[1, 2, 3, 4, 5].map((n) => h('button', {
      type: 'button', class: n <= v ? 'on' : '', 'aria-label': `${n} 星`, onclick: () => { v = v === n ? 0 : n; draw(); },
    }, '★')));
    draw();
    return { el: wrap, get: () => v || undefined };
  }
  if (f.type === 'enum') {
    let v = value ?? f.default ?? '';
    const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': f.label });
    const draw = () => wrap.replaceChildren(...f.options.map((o) => h('button', { type: 'button', class: o === v ? 'on' : '', onclick: () => { v = o; draw(); } }, o)));
    draw();
    return { el: wrap, get: () => v || undefined };
  }
  if (f.type === 'longtext' || f.type === 'list') {
    const ta = h('textarea', { class: 'field', rows: f.type === 'list' ? 4 : 3, placeholder: f.hint ?? (f.type === 'list' ? '一行一条' : ''), 'aria-label': f.label },
      Array.isArray(value) ? value.join('\n') : value ?? '');
    return { el: ta, get: () => (f.type === 'list' ? ta.value.split('\n').map((s) => s.trim()).filter(Boolean) : ta.value.trim()) };
  }
  const input = h('input', { class: 'field', type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text', value: value ?? '', placeholder: f.hint ?? '', 'aria-label': f.label });
  return { el: input, get: () => input.value.trim() };
}

// ------------------------------------------------------------------ 表单（草稿 / 条目共用，按场景出字段）
function draftForm(d, opts = {}) {
  const box = h('div');
  let sceneId = d.scene || 'note';
  let carried = { ...(d.fields ?? {}) };
  const title = h('input', { class: 'field title-field', value: d.title, 'aria-label': '标题' });
  const oneLine = h('input', { class: 'field', value: d.oneLine ?? '', placeholder: '卡片上显示的一句话', 'aria-label': '一句话' });
  const when = d.date || (d.createdAt ? localStampOf(d.createdAt) : '');
  const date = h('input', { class: 'field', type: 'datetime-local', value: when.length === 10 ? `${when}T00:00` : when, 'aria-label': '发生时间' });
  const summary = h('textarea', { class: 'field', rows: 3, 'aria-label': '说明' }, d.summary);
  const points = h('textarea', { class: 'field', rows: 4, 'aria-label': '要点' }, d.keyPoints.join('\n'));
  const tags = h('input', { class: 'field', value: d.tags.join('，'), 'aria-label': '标签' });
  let inputs = [];

  const draw = () => {
    const scene = sceneOf(sceneId);
    // 换场景时，同名字段的值带过去
    for (const { f, get } of inputs) { const v = get(); if (v !== undefined && v !== '') carried[f.key] = v; }
    inputs = scene.fields.map((f) => ({ f, ...fieldInput(f, carried[f.key]) }));
    const asked = inputs.filter(({ f }) => scene.ask.includes(f.key) && (carried[f.key] === undefined || carried[f.key] === '') && opts.ask !== false);
    const rest = inputs.filter((x) => !asked.includes(x));
    const choices = [sceneId, ...(d.sceneAlt ?? []).filter((x) => x !== sceneId)];
    box.replaceChildren(...[
      h('div', { class: 'scene-pick' },
        h('span', { class: 'lab-inline' }, '场景'),
        choices.map((id) => h('button', { type: 'button', class: `chipbtn ${id === sceneId ? 'on' : ''}`, style: `--c:${sceneOf(id).color}`, onclick: () => { sceneId = id; draw(); } }, sceneOf(id).name)),
        h('select', { class: 'chipsel', 'aria-label': '换一个场景', onchange: (e) => { if (e.target.value) { sceneId = e.target.value; draw(); } } },
          h('option', { value: '' }, '换…'), [...SCENES.values()].filter((s) => !choices.includes(s.id)).map((s) => h('option', { value: s.id }, s.name)))),
      asked.length ? h('div', { class: 'askbox' }, h('div', { class: 'askhead' }, '小小蜗想知道'),
        asked.map(({ f, el }) => h('div', { class: 'askrow' }, h('label', { class: 'lab' }, f.label), el))) : null,
      h('label', { class: 'lab' }, '标题'), title,
      h('label', { class: 'lab' }, '一句话'), oneLine,
      ...rest.flatMap(({ f, el }) => [h('label', { class: 'lab' }, f.label), el]),
      h('label', { class: 'lab' }, '发生时间', h('small', { class: 'labhint' }, '默认是记录的时间，可以改')), date,
      h('details', { class: 'more-fields', open: !scene.fields.length || undefined },
        h('summary', {}, '说明、要点、标签'),
        h('label', { class: 'lab' }, '说明'), summary,
        h('label', { class: 'lab' }, '要点（一行一条）'), points,
        h('label', { class: 'lab' }, '标签（逗号分隔）'), tags)].filter(Boolean));
  };
  draw();

  const value = () => {
    const fields = {};
    for (const { f, get } of inputs) { const v = get(); if (v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) fields[f.key] = v; }
    return {
      title: title.value.trim(), summary: summary.value.trim(), oneLine: oneLine.value.trim(), date: date.value,
      keyPoints: points.value.split('\n').map((s) => s.trim()).filter(Boolean),
      tags: tags.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      sourceUrls: d.sourceUrls, scene: sceneId, fields, relations: d.relations ?? [],
    };
  };
  return { el: box, value };
}

/** 草稿里提议拆出的卡片：勾选、改写，入库时一起建 */
function cardPicker(cards, titles) {
  const rows = cards.map((c) => {
    const pick = h('input', { type: 'checkbox', checked: true, 'aria-label': '留下这张卡片' });
    const title = h('input', { class: 'field', value: c.title, 'aria-label': '卡片标题（一句完整的观点）' });
    const idea = h('textarea', { class: 'field', rows: 2, placeholder: '用自己的话写一两句（下面是小小蜗的草稿）', 'aria-label': '卡片正文' }, c.draft);
    const el = h('div', { class: 'cardprop' },
      h('label', { class: 'pickrow' }, pick, h('span', {}, '留下')),
      title, idea,
      c.links.length ? h('ul', { class: 'linklist' }, c.links.map((l) => h('li', {}, h('b', {}, l.type), ' ', h('a', { href: `#/entry/${l.to}`, target: '_blank' }, titles[l.to] ?? '已有卡片'), h('small', {}, l.reason)))) : null);
    return { el, get: () => (pick.checked && title.value.trim() ? { title: title.value.trim(), idea: idea.value.trim(), links: c.links } : null) };
  });
  return { el: h('div', { class: 'cardprops' }, rows.map((r) => r.el)), value: () => rows.map((r) => r.get()).filter(Boolean) };
}

const links = (urls) => urls.map((u) => h('div', {}, h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, u)));
const images = (rawId, names) => h('div', { class: 'thumbs' }, names.map((n) =>
  h('a', { href: `/api/files/${rawId}/${n}`, target: '_blank' }, h('img', { src: `/api/files/${rawId}/${n}`, alt: '原图', loading: 'lazy' }))));

// ------------------------------------------------------------------ 草稿详情
async function renderDraft(id) {
  const [{ items }] = await Promise.all([api('/api/inbox'), loadScenes()]);
  const item = items.find((i) => i.raw.id === id);
  if (!item) { location.hash = '#/'; return; }
  const { raw, draft: rec } = item;
  const back = h('a', { class: 'back', href: '#/' }, '← 返回');
  const parts = [back, h('header', { class: 'article-head' },
    h('div', { class: 'kicker' }, rec?.draft ? sceneTag(rec.draft.scene, STATUS[raw.status]) : STATUS[raw.status] || '草稿', raw.private ? h('span', {}, '私密') : null),
    h('h1', {}, rec?.draft?.title || '整理中…'), h('div', { class: 'meta' }, fmt(raw.id)))];

  const source = h('details', { class: 'source', open: !rec?.draft || undefined }, h('summary', {}, '原料'),
    h('div', { class: 'raw' }, raw.text || '（无文字）'), raw.urls.length ? links(raw.urls) : null, raw.images.length ? images(raw.id, raw.images) : null);
  parts.push(source);

  if (raw.status === 'saved' || raw.status === 'organizing') {
    parts.push(h('p', { class: 'empty' }, '小小蜗正在整理，稍后会出现草稿…'));
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
  if (rec.draft.possibleDuplicateOf) parts.push(h('p', { class: 'hint' }, '可能和已有条目是同一件事：', h('a', { href: `#/entry/${rec.draft.possibleDuplicateOf}` }, '去看看')));
  if (raw.private) parts.push(h('p', { class: 'hint' }, '私密：小小蜗不会看到，需要自己填写。'));
  if (rec.questions.length && !raw.private) {
    const answer = h('textarea', { class: 'field', rows: 2, placeholder: '一句话回答就行', 'aria-label': '回答小小蜗的问题' });
    parts.push(section('小小蜗还想问', rec.questions.length), ...rec.questions.map((q) => h('div', { class: 'q' }, q)), answer,
      h('div', { class: 'row end', style: 'margin-top:8px' }, h('button', { onclick: async () => {
        if (!answer.value.trim()) return toast('先写点回答');
        await post(`/api/drafts/${raw.id}/answer`, { answers: answer.value }); toast('已发给小小蜗'); location.hash = '#/';
      } }, '回答并重新整理')));
  }
  const picker = rec.draft.cards?.length ? cardPicker(rec.draft.cards, rec.titles ?? {}) : null;
  const note = h('input', { class: 'field', placeholder: '想让小小蜗怎么改？一句话', 'aria-label': '重做的要求' });
  parts.push(section('草稿'), form.el,
    picker ? [section('可以拆出的卡片', rec.draft.cards.length), h('p', { class: 'sub' }, '一张卡片只讲一个观点。勾选要留下的，最好用自己的话改一改。'), picker.el] : null,
    h('div', { class: 'row actions' },
      h('button', { class: 'primary', onclick: async () => {
        const v = form.value();
        if (!v.title) return toast('标题不能为空');
        const cards = picker ? picker.value() : [];
        const { entryId, cardIds } = await post(`/api/drafts/${raw.id}/confirm`, { draft: v, cards });
        toast(cardIds?.length ? `已入库，另存了 ${cardIds.length} 张卡片 ✓` : '已入库 ✓'); location.hash = `#/entry/${entryId}`;
      } }, '确认入库'),
      h('button', { class: 'danger', onclick: async () => { await post(`/api/drafts/${raw.id}/discard`); location.hash = '#/'; } }, '丢弃')),
    raw.private ? null : [h('label', { class: 'lab' }, '让小小蜗重新整理'), note,
      h('div', { class: 'row end', style: 'margin-top:8px' }, h('button', { onclick: async () => {
        if (!note.value.trim()) return toast('先写要求');
        await post(`/api/drafts/${raw.id}/redo`, { note: note.value }); toast('已发给小小蜗'); location.hash = '#/';
      } }, '重新整理'))]);
  app.replaceChildren(...parts.flat().filter(Boolean));
}

/** 条目页上一个字段的展示 */
function fieldView(f, v) {
  if (f.type === 'stars') return h('span', { class: 'starv' }, stars(v));
  if (f.type === 'list') return h('ul', { class: 'flist' }, v.map((x) => h('li', {}, x)));
  if (f.type === 'longtext') return h('div', { class: 'fl' }, v);
  return h('span', {}, String(v));
}

// ------------------------------------------------------------------ 条目详情
async function renderEntry(id) {
  const [{ entry, images: names, backlinks = [], titles = {} }] = await Promise.all([api(`/api/entries/${id}`), loadScenes()]);
  const view = () => {
    const scene = sceneOf(entry.scene);
    const shown = scene.fields.filter((f) => entry.fields?.[f.key] !== undefined && f.key !== 'date');
    const short = shown.filter((f) => !['longtext', 'list'].includes(f.type));
    const long = shown.filter((f) => ['longtext', 'list'].includes(f.type));
    app.replaceChildren(...[
      h('a', { class: 'back', href: '#/' }, '← 返回'),
      h('header', { class: 'article-head' },
        h('div', { class: 'kicker' }, sceneTag(entry.scene), entry.private ? h('span', {}, '私密') : null, entry.tags.map((t) => h('span', { class: 'chip' }, t))),
        h('h1', {}, entry.title),
        entry.oneLine || entry.summary ? h('p', { class: 'deck' }, entry.oneLine || entry.summary) : null,
        h('div', { class: 'meta' }, `发生于 ${occurred(entry).replace('T', ' ')}`, entry.private ? ' · 不在 GitHub 备份里' : '')),
      short.length ? h('dl', { class: 'facts' }, short.flatMap((f) => [h('dt', {}, f.label), h('dd', {}, fieldView(f, entry.fields[f.key]))])) : null,
      long.flatMap((f) => [section(f.label), fieldView(f, entry.fields[f.key])]),
      entry.oneLine && entry.summary ? [section('说明'), h('p', {}, entry.summary)] : null,
      entry.keyPoints.length ? [section('要点', entry.keyPoints.length), h('ol', { class: 'points' }, entry.keyPoints.map((k) => h('li', {}, h('span', {}, k))))] : null,
      entry.relations?.length ? [section('链接到', entry.relations.length), h('ul', { class: 'linklist' }, entry.relations.map((l) =>
        h('li', {}, h('b', {}, l.type), ' ', h('a', { href: `#/entry/${l.to}` }, titles[l.to] ?? l.to), h('small', {}, l.reason))))] : null,
      backlinks.length ? [section('链到这里的', backlinks.length), h('ul', { class: 'linklist' }, backlinks.map((b) =>
        h('li', {}, h('b', {}, b.type), ' ', h('a', { href: `#/entry/${b.id}` }, b.title), h('small', {}, b.reason))))] : null,
      names.length ? [section('原图', names.length), h('div', { class: 'gallery' }, names.map((n) => h('a', { href: `/api/files/${entry.rawId}/${n}`, target: '_blank' }, h('img', { src: `/api/files/${entry.rawId}/${n}`, alt: '原图', loading: 'lazy' }))))] : null,
      entry.sourceUrls.length ? [section('来源'), h('div', { class: 'links' }, links(entry.sourceUrls))] : null,
      entry.rawText ? h('details', { class: 'source' }, h('summary', {}, '原始内容'), h('div', { class: 'raw' }, entry.rawText)) : null,
      h('div', { class: 'row', style: 'margin-top:24px' }, h('button', { onclick: edit }, '编辑'),
        entry.scene === 'card' || entry.private ? null : h('button', { class: 'quiet', onclick: async () => {
          await post(`/api/entries/${id}/rescene`); toast('小小蜗正在重新整理，确认前原条目不变'); location.hash = '#/';
        } }, entry.scene ? '让小小蜗重新整理' : '让小小蜗识别场景'))].flat().filter(Boolean));
  };
  const edit = () => {
    const form = draftForm(entry, { ask: false });
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
