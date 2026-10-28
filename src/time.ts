/** 主人所在时区；服务器在泰国，入库时间要按主人的钟显示 */
const TZ = process.env.OWNER_TZ ?? 'Asia/Shanghai';

/** 「发生时间」的格式：YYYY-MM-DD 或 YYYY-MM-DDTHH:mm */
export const OCCURRED_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

/** ISO 时间 → 主人时区下的 YYYY-MM-DDTHH:mm（默认的发生时间 = 记录时间） */
export function localStamp(iso: string, tz = TZ): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
