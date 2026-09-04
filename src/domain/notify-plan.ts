import type { LocalDate, Minutes, Prefs, Task } from './types'
import { addDays, fmtMinutes, fromDate, toDate } from './dates'
import { occurrencesOn, type Snapshot } from './engine'

/* 通知计划：纯函数，把课表 + 待办 + 偏好算成一串「什么时候发什么」。
   调度与权限在 src/app/notify.ts，这里不碰平台。 */

export type NotifGroup = 'class' | 'task' | 'exam' | 'summary'

export interface PlannedNotification {
  id: number
  at: number // epoch ms
  group: NotifGroup
  title: string
  body: string
  /** 通知上的操作按钮组 */
  actionTypeId?: string
  /** 操作按钮要用到的目标 */
  ruleId?: string
  date?: LocalDate
  taskId?: string
}

const DAY_MS = 86400000

export function atMinutes(date: LocalDate, min: Minutes): number {
  const d = toDate(date)
  d.setMinutes(min)
  return d.getTime()
}

/** 稳定 id：同一件事在两次重排里拿到同一个通知 id */
export function stableId(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 2000000000 + 1
}

/** 落在夜间不打扰区间里（跨零点也算） */
export function inQuiet(prefs: Prefs, at: number): boolean {
  const d = new Date(at)
  const m = d.getHours() * 60 + d.getMinutes()
  const { quietStart: s, quietEnd: e } = prefs
  if (s === e) return false
  return s < e ? m >= s && m < e : m >= s || m < e
}

function joinBody(parts: (string | undefined)[]): string {
  return parts.filter((x) => x && x.length > 0).join('\n')
}

function relDayLabel(due: LocalDate, from: LocalDate): string {
  const n = Math.round((toDate(due).getTime() - toDate(from).getTime()) / DAY_MS)
  if (n === 0) return '今天'
  if (n === 1) return '明天'
  if (n === 2) return '后天'
  return `${n} 天后`
}

export function planNotifications(
  snap: Snapshot | null,
  tasks: Task[],
  prefs: Prefs,
  now: Date,
  days = 7,
): PlannedNotification[] {
  const out: PlannedNotification[] = []
  const nowMs = now.getTime()
  const today = fromDate(now)
  const courseName = new Map(snap?.courses.map((c) => [c.id, c.name]) ?? [])
  const busy: [number, number][] = []

  for (let i = 0; i < days; i++) {
    const date = addDays(today, i)
    const occ = snap ? occurrencesOn(snap, date).filter((o) => o.status !== 'cancelled' && !o.muted) : []
    const dayTasks = tasks.filter((t) => !t.done && t.due === date)

    if (snap && prefs.muteInClass) {
      for (const o of occ) busy.push([atMinutes(date, o.start), atMinutes(date, o.end)])
    }

    if (snap) {
      const first = occ[0]
      for (const o of occ) {
        if (prefs.onlyChanged && o.status !== 'moved') continue
        const lead = o === first ? Math.max(prefs.classLead, prefs.firstClassLead) : prefs.classLead
        const at = atMinutes(date, o.start) - lead * 60000
        if (at <= nowMs || inQuiet(prefs, at)) continue
        out.push({
          id: stableId(`class:${o.key}`),
          at,
          group: 'class',
          title: `${o.name} ${fmtMinutes(o.start)} 开始`,
          body: joinBody([[o.location, o.teacher].filter(Boolean).join('，'), `还有 ${lead} 分钟`]),
          actionTypeId: 'class',
          ruleId: o.ruleId,
          date,
        })
      }
    }

    // 每日摘要
    if (prefs.dailySummaryAt != null) {
      const at = atMinutes(date, prefs.dailySummaryAt)
      const quiet = occ.length === 0 && dayTasks.length === 0
      if (at > nowMs && !(prefs.silentFreeDay && quiet) && !inQuiet(prefs, at)) {
        const head = occ.length > 0 ? `今天 ${occ.length} 节课，${fmtMinutes(occ[0].start)} 开始` : '今天没有课'
        const line = occ.length > 0
          ? `第一节 ${occ[0].name}${occ[0].location ? `（${occ[0].location}）` : ''}`
          : undefined
        const taskLine = dayTasks.length > 0 ? `${dayTasks.length} 项待办今天到期` : undefined
        if (occ.length > 0 || taskLine) {
          out.push({
            id: stableId(`summary:${date}`),
            at,
            group: 'summary',
            title: head,
            body: joinBody([line, taskLine]),
          })
        }
      }
    }
  }

  // 待办与考试
  for (const t of tasks) {
    if (t.done || !t.due) continue
    const cname = t.courseId ? courseName.get(t.courseId) : undefined
    if (t.kind === 'exam') {
      for (const d of prefs.examDays) {
        const date = addDays(t.due, -d)
        const at = atMinutes(date, d === 0 ? 8 * 60 : 9 * 60)
        if (at <= nowMs || inQuiet(prefs, at)) continue
        const when = t.dueMinutes != null ? fmtMinutes(t.dueMinutes) : ''
        out.push({
          id: stableId(`exam:${t.id}:${d}`),
          at,
          group: 'exam',
          title: d === 0 ? `今天 ${when} 考试：${t.title}` : `${t.title} ${relDayLabel(t.due, date)}开考`,
          body: joinBody([cname, [t.location, t.seat].filter(Boolean).join('，') || undefined]),
          taskId: t.id,
        })
      }
      continue
    }
    const date = addDays(t.due, -1)
    const at = atMinutes(date, prefs.taskEveningAt)
    if (at <= nowMs || inQuiet(prefs, at)) continue
    const dueAt = t.dueMinutes != null ? atMinutes(t.due, t.dueMinutes) : atMinutes(t.due, 23 * 60 + 59)
    const hours = Math.max(1, Math.round((dueAt - at) / 3600000))
    out.push({
      id: stableId(`task:${t.id}`),
      at,
      group: 'task',
      title: `${t.title} ${relDayLabel(t.due, date)}${t.dueMinutes != null ? ` ${fmtMinutes(t.dueMinutes)}` : ''} 截止`,
      body: joinBody([cname, `还剩 ${hours} 小时`]),
      actionTypeId: 'task',
      taskId: t.id,
    })
  }

  // 上课中静音：课以外的通知不在上课时间落地
  const muted = prefs.muteInClass
    ? out.filter((n) => n.group === 'class' || !busy.some(([s, e]) => n.at >= s && n.at < e))
    : out

  muted.sort((a, b) => a.at - b.at)
  return muted
}
