import type { Course, Diagnostic, SessionRule, Semester, TimeSlot } from './types'
import { identityKey } from './engine'
import { parsePeriodRange, parseWeekExpr } from './weeks'

/* ---------- 规则输出契约 ---------- */

export interface RuleCourse {
  name: string
  teacher?: string
  teacherPhone?: string
  location?: string
  weekday: number
  startPeriod: number
  endPeriod: number
  weeks: string // 周次表达式，引擎负责解析
  raw?: Record<string, string>
}

export interface RuleOutput {
  courses: RuleCourse[]
  diagnostics: Diagnostic[]
  timeGrid?: TimeSlot[] // 课表自带节次表时覆盖学期设置
}

const PHONE_RE = /(?:\+?86[- ]?)?1[3-9]\d(?:[ \-]?\d){8}/

/** 从任意文本里取出第一个大陆手机号，去 86 前缀与分隔符 */
export function extractPhone(s: unknown): string | undefined {
  if (typeof s === 'number') s = String(s)
  if (typeof s !== 'string') return undefined
  const m = s.match(PHONE_RE)
  return m ? m[0].replace(/[\s\-]/g, '').replace(/^\+?86/, '') : undefined
}

function parseHm(s: unknown): number | null {
  const m = typeof s === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(s.trim()) : null
  return m ? +m[1] * 60 + +m[2] : null
}

function parseTimeSlots(raw: unknown): TimeSlot[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const slots: TimeSlot[] = []
  for (const x of raw) {
    const o = x as Record<string, unknown>
    const index = typeof o.node === 'number' ? o.node : typeof o.index === 'number' ? o.index : NaN
    const start = parseHm(o.startTime)
    const end = parseHm(o.endTime)
    if (!(index >= 1) || start == null || end == null || end <= start) return undefined
    slots.push({ index, start, end })
  }
  slots.sort((a, b) => a.index - b.index)
  return slots.length > 0 && slots.every((s, i) => s.index === i + 1) ? slots : undefined
}

/* ---------- 声明式 DSL（JSON 课表 / CSV / WakeUp 风格） ---------- */

export interface CsvMapping {
  name: number
  teacher?: number
  teacherPhone?: number
  location?: number
  weekday: number
  periods: number
  weeks: number
  skipRows?: number
  delimiter?: string
}

export function parseCsv(text: string, map: CsvMapping): RuleOutput {
  const diags: Diagnostic[] = []
  const courses: RuleCourse[] = []
  const delim = map.delimiter ?? ','
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const rows = lines.slice(map.skipRows ?? 0)
  rows.forEach((line, i) => {
    const cells = line.split(delim).map((c) => c.trim())
    const row = i + (map.skipRows ?? 0) + 1
    const name = cells[map.name]
    if (!name) {
      diags.push({ level: 'error', code: 'MISSING_NAME', message: `第 ${row} 行缺少课程名`, at: { row } })
      return
    }
    const weekday = parseWeekday(cells[map.weekday])
    if (!weekday) {
      diags.push({ level: 'error', code: 'UNPARSED_WEEKDAY', message: `第 ${row} 行星期无法解析：${cells[map.weekday] ?? ''}`, at: { row, snippet: cells[map.weekday] } })
      return
    }
    const pr = parsePeriodRange(cells[map.periods] ?? '')
    if (!pr) {
      diags.push({ level: 'error', code: 'UNPARSED_PERIOD', message: `第 ${row} 行节次无法解析：${cells[map.periods] ?? ''}`, at: { row, snippet: cells[map.periods] } })
      return
    }
    courses.push({
      name,
      teacher: map.teacher != null ? cells[map.teacher]?.trim() || undefined : undefined,
      teacherPhone: map.teacherPhone != null ? cells[map.teacherPhone]?.trim() || undefined : undefined,
      location: map.location != null ? cells[map.location]?.trim() || undefined : undefined,
      weekday,
      startPeriod: pr.start,
      endPeriod: pr.end,
      weeks: cells[map.weeks] ?? '',
    })
  })
  return { courses, diagnostics: diags }
}

export function parseWeekday(raw: string | undefined): number | null {
  if (!raw) return null
  const s = raw.trim()
  const n = parseInt(s, 10)
  if (n >= 1 && n <= 7) return n
  const m: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }
  for (const [k, v] of Object.entries(m)) if (s.includes(k)) return v
  return null
}

/* 通用 JSON 课表（tableName/courses/timeSlots 形态） */
export function parseJsonTable(text: string): RuleOutput {
  const diags: Diagnostic[] = []
  let obj: unknown
  try {
    obj = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
  } catch {
    return { courses: [], diagnostics: [{ level: 'error', code: 'INVALID_JSON', message: 'JSON 无法解析' }] }
  }
  const root = obj as { courses?: unknown[] }
  if (!Array.isArray(root.courses)) {
    return { courses: [], diagnostics: [{ level: 'error', code: 'MISSING_COURSES', message: '缺少 courses 数组' }] }
  }
  const courses: RuleCourse[] = []
  root.courses.forEach((c, i) => {
    const o = c as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name : ''
    const day = typeof o.day === 'number' ? o.day : parseWeekday(String(o.day ?? ''))
    const startNode = typeof o.startNode === 'number' ? o.startNode : NaN
    const step = typeof o.step === 'number' ? o.step : 1
    const weeks = Array.isArray(o.weeks) ? (o.weeks as number[]).join(',') : String(o.weeks ?? '')
    if (!name || !day || isNaN(startNode)) {
      diags.push({ level: 'error', code: 'MISSING_FIELDS', message: `第 ${i + 1} 条课程缺少必需字段`, at: { row: i + 1 } })
      return
    }
    const teacherRaw = typeof o.teacher === 'string' ? o.teacher : undefined
    const teacherPhone = extractPhone(o.teacherPhone ?? o.phone ?? o.tel ?? o.mobile) ?? extractPhone(teacherRaw)
    const teacher = teacherRaw && teacherPhone ? teacherRaw.replace(PHONE_RE, '').replace(/[\s,，;；:：()（）]+$/, '').trim() || undefined : teacherRaw
    courses.push({
      name,
      teacher,
      teacherPhone,
      location: typeof o.location === 'string' ? o.location : undefined,
      weekday: day,
      startPeriod: startNode,
      endPeriod: startNode + step - 1,
      weeks,
    })
  })
  return { courses, diagnostics: diags, timeGrid: parseTimeSlots((obj as { timeSlots?: unknown }).timeSlots) }
}

/* ---------- 规范化：RuleOutput → Course/SessionRule ---------- */

export interface NormalizedCourse {
  course: Omit<Course, 'id' | 'semesterId'>
  rules: Omit<SessionRule, 'id' | 'courseId'>[]
}

const PALETTE = ['#4F5BD5', '#C2703D', '#3D8A63', '#7A4FB0', '#B04F6E', '#3D7A9E', '#8A7A3D']

export function normalize(out: RuleOutput, sem: Semester): { courses: NormalizedCourse[]; diagnostics: Diagnostic[] } {
  const diags = [...out.diagnostics]
  const byKey = new Map<string, NormalizedCourse>()
  let colorIdx = 0
  const colorByName = new Map<string, string>()
  for (const rc of out.courses) {
    const wk = parseWeekExpr(rc.weeks)
    if (wk.error) {
      diags.push({ level: 'error', code: 'UNPARSED_WEEKS', message: `「${rc.name}」周次无法解析：${rc.weeks}`, at: { snippet: rc.weeks } })
      continue
    }
    if (rc.endPeriod > sem.timeGrid.length) {
      diags.push({ level: 'error', code: 'PERIOD_OUT_OF_GRID', message: `「${rc.name}」节次 ${rc.startPeriod}-${rc.endPeriod} 超出节次表（共 ${sem.timeGrid.length} 节）` })
      continue
    }
    if (!colorByName.has(rc.name)) colorByName.set(rc.name, PALETTE[colorIdx++ % PALETTE.length])
    const key = identityKey(rc.name, rc.teacher, rc.weekday, rc.startPeriod)
    const nameKey = rc.name + '|' + (rc.teacher ?? '')
    let nc = [...byKey.values()].find((x) => x.course.name + '|' + (x.course.teacher ?? '') === nameKey)
    if (!nc) {
      nc = {
        course: {
          name: rc.name,
          teacher: rc.teacher,
          teacherPhone: rc.teacherPhone,
          color: colorByName.get(rc.name)!,
          identityKey: key,
          hidden: false,
          source: 'import',
        },
        rules: [],
      }
      byKey.set(key, nc)
    } else if (nc.course.teacherPhone == null && rc.teacherPhone) {
      nc.course.teacherPhone = rc.teacherPhone
    }
    nc.rules.push({
      weekday: rc.weekday as SessionRule['weekday'],
      startPeriod: rc.startPeriod,
      endPeriod: rc.endPeriod,
      weeksMask: wk.mask,
      location: rc.location,
      teacher: rc.teacher,
      teacherPhone: rc.teacherPhone,
    })
  }
  return { courses: [...byKey.values()], diagnostics: diags }
}

/* ---------- 简化 diff：只列会变的 ---------- */

export interface ImportDiff {
  added: NormalizedCourse[]
  removed: Course[] // 本次导入里消失的（标 removedByImport，不物理删）
  protectedKept: Course[] // 用户改过、本次保留用户值的
  unchanged: number
}

export function diffImport(existing: Course[], incoming: NormalizedCourse[], userEditedIds: Set<string>): ImportDiff {
  const exByKey = new Map(existing.filter((c) => c.source === 'import').map((c) => [c.identityKey, c]))
  const inKeys = new Set(incoming.map((c) => c.course.identityKey))
  const added = incoming.filter((c) => !exByKey.has(c.course.identityKey))
  const removed = [...exByKey.values()].filter((c) => !inKeys.has(c.identityKey))
  const protectedKept = existing.filter((c) => userEditedIds.has(c.id) && inKeys.has(c.identityKey))
  const unchanged = incoming.length - added.length - protectedKept.length
  return { added, removed, protectedKept, unchanged: Math.max(0, unchanged) }
}
