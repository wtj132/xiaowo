const list = document.getElementById('list');
const stats = document.getElementById('stats');
const fileInput = document.getElementById('file');
const toastEl = document.getElementById('toast');

// 与 nordic-trip 的国家色一致
const COUNTRY = {
  DK: ['丹麦', '#E9798A'], SE: ['瑞典', '#8DB0EE'], NO: ['挪威', '#7CCAA9'], FI: ['芬兰', '#A3D9E8'], IS: ['冰岛', '#C3CDE0'],
  DE: ['德国', '#E2B98A'], EE: ['爱沙尼亚', '#9AB7D6'], IE: ['爱尔兰', '#8FCB8F'],
};
const countryColor = (c) => COUNTRY[c]?.[1] ?? '#B9C4CC';

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
  setTimeout(() => toastEl.classList.remove('show'), 2000);
}
async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...opts });
  if (res.status === 401) { location.href = '/'; throw new Error('需要登录'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

const DAY = 864e5;
const today = () => { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
const parse = (s) => (s ? Date.parse(`${s}T00:00:00Z`) : NaN);
const md = (s) => (s ? `${+s.slice(5, 7)}.${+s.slice(8, 10)}` : '');
const money = (n) => `¥${Math.round(n).toLocaleString('zh-CN')}`;

function phase(t) {
  const now = today(), a = parse(t.start), b = parse(t.end);
  if (now < a) return { kind: 'plan', label: '计划中', n: Math.round((a - now) / DAY) };
  if (now <= b) return { kind: 'live', label: '进行中', n: Math.round((now - a) / DAY) + 1 };
  return { kind: 'past', label: '回忆', n: Math.round((now - b) / DAY) };
}

function card(t) {
  const p = phase(t);
  const year = t.start.slice(0, 4);
  const headline = p.kind === 'plan' ? h('div', { class: 'big' }, '还有', h('em', {}, p.n), '天出发')
    : p.kind === 'live' ? h('div', { class: 'big' }, '第', h('em', {}, p.n), `天 · 共 ${t.days} 天`)
    : h('div', { class: 'big' }, `${year} 年 · 共 ${t.days} 天`);
  const ratio = t.budget ? t.spent / t.budget : 0;
  return h('a', { class: 'trip', href: `/trip.html?id=${t.id}` },
    h('div', { class: 'cover' },
      t.cover ? h('img', { src: t.cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() }) : null,
      h('span', { class: `badge ${p.kind}` }, h('i'), p.label),
      h('div', { class: 'over' }, h('h2', {}, t.name), h('div', { class: 'route' }, t.cities.join(' — ')))),
    h('div', { class: 'body' },
      h('div', { class: 'stripe', title: t.countries.map((c) => COUNTRY[c]?.[0] ?? c).join(' · ') },
        t.countries.map((c) => h('span', { style: `background:${countryColor(c)}` }))),
      headline,
      h('div', { class: 'facts' },
        h('span', {}, h('b', {}, `${md(t.start)} – ${md(t.end)}`)),
        h('span', {}, `${t.countries.length} 国 · ${t.cities.length} 城`),
        t.people.length ? h('span', {}, t.people.join('、')) : null),
      t.budget ? [
        h('div', { class: 'facts' }, h('span', {}, `已计 ${money(t.spent)} / 预算 ${money(t.budget)}`)),
        h('div', { class: `meter ${ratio > 1 ? 'over' : ''}` }, h('span', { style: `width:${Math.min(100, ratio * 100).toFixed(1)}%` })),
      ] : null));
}

async function load() {
  const { trips } = await api('/api/trips');
  if (!trips.length) {
    stats.textContent = '每一趟长途，都有自己的一页。';
    list.replaceChildren(h('div', { class: 'empty' }, h('b', {}, '还没有旅程'), '把 nordic-trip 导出的 JSON 导进来，就从这里开始。',
      h('div', {}, h('button', { class: 'ghost', onclick: () => fileInput.click() }, '＋ 导入旅程'))));
    return;
  }
  const groups = { live: [], plan: [], past: [] };
  for (const t of trips) groups[phase(t).kind].push(t);
  groups.plan.sort((a, b) => a.start.localeCompare(b.start));
  // 只把已经出发过的旅程算进"去过"
  const been = [...groups.live, ...groups.past];
  const countries = new Set(been.flatMap((t) => t.countries));
  const next = groups.plan[0];
  stats.textContent = [
    `${trips.length} 趟旅程`,
    been.length ? `去过 ${countries.size} 个国家 · ${been.reduce((s, t) => s + t.days, 0)} 天在路上` : null,
    next ? `下一趟还有 ${phase(next).n} 天` : null,
  ].filter(Boolean).join(' · ');
  const NAMES = { live: '正在路上', plan: '即将出发', past: '去过的地方' };
  list.replaceChildren(...['live', 'plan', 'past'].filter((k) => groups[k].length).flatMap((k) => [
    h('div', { class: 'group' }, NAMES[k]), h('div', { class: 'grid' }, groups[k].map(card))]));
}

document.getElementById('import').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const f = fileInput.files[0];
  fileInput.value = '';
  if (!f) return;
  try {
    const body = JSON.parse(await f.text());
    const { summary } = await api('/api/trips', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    toast(`已导入「${summary.name}」`);
    load();
  } catch (e) {
    toast(e instanceof SyntaxError ? '这个文件不是 JSON' : e.message);
  }
});

load().catch((e) => toast(e.message));
