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
  teacherPhone?: string
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
  newTeacher?: string
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

export interface TaskPhoto {
  id: string
  path: string // 应用私有目录下的相对路径
  w: number
  h: number
  takenAt: number
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
  photos?: TaskPhoto[]
  /** 只有照片、还没有名称 */
  inbox?: boolean
  /** 记录时正在上或刚结束的课 */
  capturedCourseId?: string
  capturedAt?: number
}

export const WIDGET_STYLES = ['today', 'next', 'twoDays', 'week'] as const
export type WidgetStyle = (typeof WIDGET_STYLES)[number]

/** 提醒与小组件偏好。提醒全部由系统日历发出，这里只是写进日历的提醒模板 */
export interface Prefs {
  classLead: Minutes // 课前多久提醒
  earlyLead: Minutes // 早课（08:30 前开始）再加一条更早的提醒，0 = 不加
  taskLeads: Minutes[] // 作业截止前多久（可多个）；没写时刻的作业按当天 23:00 截止
  examDays: number[] // 考试提前几天（0 = 当天早上 8 点）
  widgetStyle: WidgetStyle
  /** 「我」页显示的名字；空则用学期名 */
  name: string
  /** 头像、背景文件路径（同作业照片）；空则用内置图 */
  avatar: string
  wall: string
}

/** 课前提醒可选的提前量 */
export const CLASS_LEADS: Minutes[] = [5, 10, 15, 20, 30, 45]
/** 早课加提醒可选的提前量（0 = 关） */
export const EARLY_LEADS: Minutes[] = [0, 30, 45, 60]
/** 作业提醒可选的提前量 */
export const TASK_LEADS: Minutes[] = [3 * 24 * 60, 24 * 60, 8 * 60, 2 * 60, 60, 15]
/** 考试提醒可选的提前天数 */
export const EXAM_DAYS: number[] = [7, 3, 1, 0]

export function defaultPrefs(): Prefs {
  return {
    classLead: 15,
    earlyLead: 30,
    taskLeads: [24 * 60, 2 * 60],
    examDays: [7, 3, 1, 0],
    widgetStyle: 'today',
    name: '',
    avatar: '',
    wall: '',
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
