/* 领域模型：真相 = Semester + Course + SessionRule + Override + UserEntry
   Occurrence 是派生数据，可随时重算。 */

export type LocalDate = string // 'YYYY-MM-DD'
export type Minutes = number // 从 00:00 起的分钟数

export interface TimeSlot {
  index: number // 第几节，从 1 开始
  start: Minutes
  end: Minutes
}

export interface DateRange {
  start: LocalDate
  end: LocalDate // 含
}

export interface Semester {
  id: string
  name: string
  startDate: LocalDate // 第 1 周周一
  totalWeeks: number
  timeGrid: TimeSlot[]
  vacations: (DateRange & { name: string })[]
  examWeeks: number[] // 周次
}

export interface Course {
  id: string
  semesterId: string
  name: string
  teacher?: string
  teacherPhone?: string
  credit?: number
  category?: string
  color: string
  identityKey: string
  hidden: boolean
  source: 'import' | 'manual'
  removedByImport?: boolean
}

export interface SessionRule {
  id: string
  courseId: string
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7 // 周一=1
  startPeriod: number
  endPeriod: number
  weeksMask: bigint // bit(n-1) = 第 n 周
  location?: string
  teacher?: string
}

export type OverrideKind =
  | 'moved' // 调整时间/地点
  | 'cancelled' // 本次停课
  | 'leave' // 请假
  | 'done' // 标记已上
  | 'muted' // 静音本节

export interface Override {
  id: string
  ruleId: string
  date: LocalDate // 命中的那一次
  kind: OverrideKind
  newDate?: LocalDate
  newStartPeriod?: number
  newEndPeriod?: number
  newLocation?: string
  note?: string
  createdAt: number
}

export interface UserEntry {
  id: string
  semesterId: string
  name: string
  kind: 'study' | 'temp' // 自习占位 / 临时安排
  date?: LocalDate // 仅一次
  weekday?: number // 每周
  startPeriod: number
  endPeriod: number
  location?: string
  createdAt: number
}

export interface Task {
  id: string
  courseId?: string
  title: string
  note?: string
  kind: 'homework' | 'exam' | 'memo'
  due?: LocalDate
  dueMinutes?: Minutes
  endMinutes?: Minutes
  location?: string
  seat?: string
  done: boolean
  createdAt: number
}

export const WIDGET_STYLES = ['today', 'next', 'twoDays', 'week'] as const
export type WidgetStyle = (typeof WIDGET_STYLES)[number]

/** 通知与小组件偏好（对应原型 09/10 屏） */
export interface Prefs {
  classLead: Minutes // 开课前提醒
  firstClassLead: Minutes // 第一节课加早提醒
  onlyChanged: boolean // 只提醒有变化的课
  taskEveningAt: Minutes // 作业截止：前一晚几点
  examDays: number[] // 考试倒数：提前几天
  changePush: boolean // 调课与停课立刻推送
  importSummary: boolean // 导入差异汇总一条
  muteInClass: boolean // 上课中静音
  quietStart: Minutes
  quietEnd: Minutes
  silentFreeDay: boolean // 没有课的一天不发通知
  dailySummaryAt: Minutes | null // 每日摘要时间，null = 关
  widgetStyle: WidgetStyle
}

export function defaultPrefs(): Prefs {
  return {
    classLead: 15,
    firstClassLead: 40,
    onlyChanged: false,
    taskEveningAt: 21 * 60,
    examDays: [3, 0],
    changePush: true,
    importSummary: true,
    muteInClass: true,
    quietStart: 23 * 60,
    quietEnd: 7 * 60,
    silentFreeDay: true,
    dailySummaryAt: 7 * 60 + 20,
    widgetStyle: 'today',
  }
}

export interface Occurrence {
  key: string
  courseId?: string
  ruleId?: string
  entryId?: string
  name: string
  date: LocalDate
  week: number
  weekday: number
  startPeriod: number
  endPeriod: number
  start: Minutes
  end: Minutes
  location?: string
  teacher?: string
  color: string
  status: 'normal' | 'moved' | 'cancelled' | 'leave' | 'done'
  muted: boolean
  conflict: boolean
  source: 'import' | 'manual'
}

export interface ImportBatch {
  id: string
  semesterId: string
  ruleId: string
  ruleName: string
  ruleVersion: string
  at: number
  durationMs: number
  added: number
  updated: number
  removed: number
  failed: number
  diagnostics: Diagnostic[]
}

export interface Diagnostic {
  level: 'error' | 'warn' | 'info'
  code: string
  message: string
  at?: { row?: number; col?: number; snippet?: string }
}

export interface ChangeEntry {
  id: string
  at: number
  actor: 'import' | 'user'
  batchId?: string
  target: string // courseId 或 ruleId
  field: string
  from?: string
  to?: string
}
