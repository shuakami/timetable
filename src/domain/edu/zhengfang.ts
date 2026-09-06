import type { Diagnostic } from '../types'
import type { RuleCourse, RuleOutput } from '../importer'
import { parseWeekExpr, maskToWeeks } from '../weeks'

/**
 * 正方新版（jwglxt）个人课表接口 `kbcx/xskbcx_cxXsgrkb.html` 返回的一条课。
 * 只取排课字段；`xsxx`（学生信息）等不在这里，脚本侧也不回传。
 */
export interface ZfKb {
  kcmc?: string // 课程名
  xm?: string // 教师
  cdmc?: string // 教室
  xqj?: string | number // 星期 1-7
  jcs?: string // 节次 "3-4" / "0304"
  zcd?: string // 周次 "1-8周(单),10-16周"
  kcxszc?: string // 课程学时组成（不用）
  xqmc?: string // 校区（不用）
}

export interface ZfTerm {
  xnm: string // 学年，"2025" 表示 2025-2026 学年
  xqm: string // 学期代码：3 / 12 / 16
}

const XQM_NAME: Record<string, string> = { '3': '第 1 学期', '12': '第 2 学期', '16': '第 3 学期' }

export function termLabel(t: ZfTerm): string {
  const y = Number(t.xnm)
  const name = XQM_NAME[t.xqm] ?? `学期 ${t.xqm}`
  return Number.isFinite(y) ? `${y}–${y + 1} 学年 ${name}` : `${t.xnm} ${name}`
}

/** 没有下拉框可读时按当前月份猜学期：9 月起上学期，2 月起下学期 */
export function guessTerm(now = new Date()): ZfTerm {
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  if (m >= 9) return { xnm: String(y), xqm: '3' }
  if (m >= 2) return { xnm: String(y - 1), xqm: '12' }
  return { xnm: String(y - 1), xqm: '3' }
}

/**
 * 正方周次串 → 引擎周次表达式。每段的单双周只作用于本段，所以逐段解析后合成显式周列表；
 * 无法解析的段原样丢弃并计入 error 便于诊断。
 */
export function zcdToWeeks(zcd: string): { weeks: string; error?: string } {
  const segs = zcd.split(/[,，;；]/).map((s) => s.trim()).filter(Boolean)
  let mask = 0n
  let error: string | undefined
  for (const seg of segs) {
    const r = parseWeekExpr(seg)
    if (r.error) error = r.error
    mask |= r.mask
  }
  return { weeks: maskToWeeks(mask).join(','), error }
}

/** 节次串："3-4" → [3,4]；"0304" → [3,4]；"5" → [5,5] */
export function parseJcs(jcs: string): [number, number] | null {
  const s = jcs.trim()
  const m = s.match(/^(\d{1,2})\s*[-–—~]\s*(\d{1,2})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    return a >= 1 && b >= a ? [a, b] : null
  }
  if (/^\d{4,}$/.test(s) && s.length % 2 === 0) {
    const ns: number[] = []
    for (let i = 0; i < s.length; i += 2) ns.push(Number(s.slice(i, i + 2)))
    const a = Math.min(...ns)
    const b = Math.max(...ns)
    return a >= 1 ? [a, b] : null
  }
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s)
    return n >= 1 ? [n, n] : null
  }
  return null
}

const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v == null ? '' : String(v))

/** 接口 JSON（或其 kbList）→ 规则输出；不带作息：正方个人课表接口不给节次时间 */
export function parseZfKbList(input: unknown): RuleOutput {
  const list: unknown[] = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as { kbList?: unknown }).kbList)
      ? (input as { kbList: unknown[] }).kbList
      : []
  const courses: RuleCourse[] = []
  const diagnostics: Diagnostic[] = []
  list.forEach((item, i) => {
    const k = (item ?? {}) as ZfKb
    const name = clean(k.kcmc)
    const row = i + 1
    if (!name) {
      diagnostics.push({ level: 'warn', code: 'EMPTY_NAME', message: `第 ${row} 条没有课程名，已跳过`, at: { row } })
      return
    }
    const weekday = Number(k.xqj)
    if (!(weekday >= 1 && weekday <= 7)) {
      diagnostics.push({ level: 'warn', code: 'BAD_WEEKDAY', message: `「${name}」星期无法识别：${clean(k.xqj)}`, at: { row } })
      return
    }
    const jc = parseJcs(clean(k.jcs))
    if (!jc) {
      diagnostics.push({ level: 'warn', code: 'BAD_PERIOD', message: `「${name}」节次无法识别：${clean(k.jcs)}`, at: { row } })
      return
    }
    const { weeks, error } = zcdToWeeks(clean(k.zcd))
    if (!weeks) {
      diagnostics.push({ level: 'warn', code: 'BAD_WEEKS', message: `「${name}」周次无法识别：${clean(k.zcd)}`, at: { row } })
      return
    }
    if (error) diagnostics.push({ level: 'info', code: 'WEEKS_PARTIAL', message: `「${name}」周次部分无法识别：${clean(k.zcd)}`, at: { row } })
    const course: RuleCourse = {
      name,
      weekday,
      startPeriod: jc[0],
      endPeriod: jc[1],
      weeks,
      raw: { kcmc: name, xqj: String(weekday), jcs: clean(k.jcs), zcd: clean(k.zcd) },
    }
    const teacher = clean(k.xm)
    const location = clean(k.cdmc)
    if (teacher) course.teacher = teacher
    if (location) course.location = location
    courses.push(course)
  })
  if (list.length === 0) diagnostics.push({ level: 'error', code: 'EMPTY', message: '接口没有返回课程' })
  return { courses, diagnostics }
}
