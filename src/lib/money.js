// Bachs money is always a decimal string at currency precision (e.g. "3000.00").
export const toDecimal = naira => `${naira}.00`;
export function toKobo(str) {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(str ?? '').trim());
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0) : NaN;
}
