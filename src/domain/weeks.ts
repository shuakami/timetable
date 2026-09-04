/* 周次表达式 → 位掩码。bit(n-1) 表示第 n 周。
   支持："1-16" "1-8,10,12-16" "2-16双" "1-15(单)" "3" "1-16周" 等常见写法。 */

export function weeksToMask(weeks: number[]): bigint {
  let m = 0n
  for (const w of weeks) if (w >= 1) m |= 1n << BigInt(w - 1)
  return m
}

export function maskToWeeks(mask: bigint): number[] {
  const out: number[] = []
  for (let w = 1; mask >= 1n << BigInt(w - 1); w++) {
    if ((mask >> BigInt(w - 1)) & 1n) out.push(w)
  }
  return out
}

export function maskHasWeek(mask: bigint, week: number): boolean {
  return week >= 1 && ((mask >> BigInt(week - 1)) & 1n) === 1n
}

const FULLWIDTH: Record<string, string> = {
  '，': ',', '、': ',', '－': '-', '—': '-', '～': '-', '~': '-',
  '（': '(', '）': ')', '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
}

export function parseWeekExpr(raw: string): { mask: bigint; error?: string } {
  let s = raw.trim()
  for (const [k, v] of Object.entries(FULLWIDTH)) s = s.split(k).join(v)
  let parity: 'odd' | 'even' | null = null
  if (/单/.test(s)) parity = 'odd'
  if (/双/.test(s)) parity = 'even'
  s = s.replace(/[()（）]/g, '').replace(/[单双周节]/g, '').trim()
  if (!s) return { mask: 0n, error: 'EMPTY_WEEK_EXPR' }
  let mask = 0n
  for (const part of s.split(',')) {
    const p = part.trim()
    if (!p) continue
    const m = p.match(/^(\d+)(?:-(\d+))?$/)
    if (!m) return { mask: 0n, error: `UNPARSED_WEEK_PART:${part}` }
    const a = parseInt(m[1], 10)
    const b = m[2] ? parseInt(m[2], 10) : a
    if (a < 1 || b < a || b > 64) return { mask: 0n, error: `WEEK_RANGE_INVALID:${part}` }
    for (let w = a; w <= b; w++) {
      if (parity === 'odd' && w % 2 === 0) continue
      if (parity === 'even' && w % 2 === 1) continue
      mask |= 1n << BigInt(w - 1)
    }
  }
  return { mask }
}

/* 节次范围："1-2" "3-4节" "第1,2节" → [start,end] */
export function parsePeriodRange(raw: string): { start: number; end: number } | null {
  let s = raw.trim()
  for (const [k, v] of Object.entries(FULLWIDTH)) s = s.split(k).join(v)
  s = s.replace(/[第节()]/g, '')
  let m = s.match(/^(\d+)\s*-\s*(\d+)$/)
  if (m) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10)
    return a >= 1 && b >= a ? { start: a, end: b } : null
  }
  const nums = s.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n))
  if (!nums.length) return null
  const a = Math.min(...nums), b = Math.max(...nums)
  return a >= 1 && b >= a ? { start: a, end: b } : null
}
