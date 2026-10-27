/** 旅程：每趟旅程是一份完整的 nordic-trip 格式数据，整份读写。 */

export interface TripRecord {
  id: string;
  /** 每次保存 +1；保存时带上读到的 rev，不一致说明别处改过，拒绝覆盖。 */
  rev: number;
  updatedAt: string;
  data: TripData;
}

/** nordic-trip 的数据结构，只列出服务器需要读的字段，其余原样保留。 */
export interface TripData {
  name?: string; start?: string; end?: string; budget?: number;
  people?: string[]; rates?: Record<string, number>;
  tickets?: { amount?: number; cur?: string }[];
  expenses?: { amount?: number; cur?: string }[];
  days?: Record<string, { city?: string; country?: string; cover?: string; stops?: { amount?: number; cur?: string }[] }>;
  [k: string]: unknown;
}

export interface TripSummary {
  id: string; name: string; start: string; end: string; days: number;
  countries: string[]; cities: string[]; cover?: string; budget?: number; spent: number; people: string[];
  updatedAt: string;
}

/** 接受 nordic-trip 导出文件（{version, data, at}）或裸 data。 */
export function parseTripImport(v: unknown): TripData | null {
  const o = v as any;
  const data = o && typeof o === 'object' && o.data && typeof o.data === 'object' && !Array.isArray(o.data) ? o.data : o;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.days !== undefined && (typeof data.days !== 'object' || Array.isArray(data.days))) return null;
  return data as TripData;
}

export function summarize(t: TripRecord): TripSummary {
  const d = t.data;
  const dates = Object.keys(d.days ?? {}).sort();
  const days = dates.map((k) => d.days![k]);
  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const rates = d.rates ?? {};
  const cny = (x: { amount?: number; cur?: string }) => (Number(x.amount) || 0) * (rates[x.cur ?? 'CNY'] ?? (x.cur && x.cur !== 'CNY' ? 0 : 1));
  const spent = [...(d.tickets ?? []), ...(d.expenses ?? []), ...days.flatMap((x) => x.stops ?? [])].reduce((s, x) => s + cny(x), 0);
  return {
    id: t.id, name: d.name || '未命名旅程',
    start: d.start || dates[0] || '', end: d.end || dates[dates.length - 1] || '', days: dates.length,
    countries: uniq(days.map((x) => x.country)), cities: uniq(days.map((x) => x.city)),
    cover: days.find((x) => x.cover)?.cover, budget: typeof d.budget === 'number' ? d.budget : undefined,
    spent: Math.round(spent), people: Array.isArray(d.people) ? d.people : [], updatedAt: t.updatedAt,
  };
}
