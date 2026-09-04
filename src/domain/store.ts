import type {
  Course, ImportBatch, Override, Semester, SessionRule, UserEntry, ChangeEntry, Task, Prefs,
} from './types'
import { WIDGET_STYLES, defaultPrefs } from './types'
import type { Snapshot } from './engine'
import type { NormalizedCourse, ImportDiff } from './importer'
import { diffImport } from './importer'
import { BUILTIN_RULES, type RuleManifest } from './rules'

/* 本地权威存储。真相全部在内存 State，持久化通过 Persistence 适配器：
   Web 用 localStorage，Capacitor 换 SQLite 适配器，接口不变。 */

export interface State {
  semester: Semester | null
  courses: Course[]
  rules: SessionRule[]
  overrides: Override[]
  entries: UserEntry[]
  batches: ImportBatch[]
  changes: ChangeEntry[]
  userEditedCourseIds: string[]
  savedRules: RuleManifest[]
  tasks: Task[]
  prefs: Prefs
}

export function emptyState(): State {
  return {
    semester: null, courses: [], rules: [], overrides: [], entries: [],
    batches: [], changes: [], userEditedCourseIds: [], savedRules: [...BUILTIN_RULES], tasks: [],
    prefs: defaultPrefs(),
  }
}

/** 从持久化读回的原始对象补齐类型：周次位掩码转 bigint，新字段补默认值 */
export function hydrate(s: State): State {
  for (const r of s.rules) r.weeksMask = BigInt(r.weeksMask as unknown as string)
  if (!s.savedRules || s.savedRules.length === 0) s.savedRules = [...BUILTIN_RULES]
  if (!s.tasks) s.tasks = []
  s.prefs = { ...defaultPrefs(), ...(s.prefs ?? {}) }
  if (!(WIDGET_STYLES as readonly string[]).includes(s.prefs.widgetStyle)) s.prefs.widgetStyle = defaultPrefs().widgetStyle
  return s
}

export interface Persistence {
  load(): State | null
  save(s: State): void
}

const KEY = 'timetable.v1'

export const localStoragePersistence: Persistence = {
  load() {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? hydrate(JSON.parse(raw) as State) : null
    } catch {
      return null
    }
  },
  save(s) {
    localStorage.setItem(KEY, JSON.stringify(s, (_, v) => (typeof v === 'bigint' ? v.toString() : v)))
  },
}

export const memoryPersistence = (): Persistence => {
  let mem: string | null = null
  return {
    load: () => (mem ? hydrate(JSON.parse(mem) as State) : null),
    save: (s) => {
      mem = JSON.stringify(s, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
    },
  }
}

let seq = 0
export const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}`

export class Store {
  state: State
  private listeners = new Set<() => void>()
  private saveQueued = false

  constructor(private persistence: Persistence) {
    this.state = persistence.load() ?? emptyState()
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** 内存优先更新 + 微任务合批持久化（借鉴 lexicon SyncEngine） */
  private commit() {
    for (const fn of this.listeners) fn()
    if (this.saveQueued) return
    this.saveQueued = true
    queueMicrotask(() => {
      this.saveQueued = false
      this.persistence.save(this.state)
    })
  }

  snapshot(): Snapshot | null {
    const s = this.state
    if (!s.semester) return null
    return { semester: s.semester, courses: s.courses, rules: s.rules, overrides: s.overrides, entries: s.entries }
  }

  setSemester(sem: Semester) {
    this.state = { ...this.state, semester: sem }
    this.commit()
  }

  addOverride(ov: Override) {
    this.state = { ...this.state, overrides: [...this.state.overrides.filter((o) => !(o.ruleId === ov.ruleId && o.date === ov.date)), ov] }
    this.commit()
  }

  removeOverride(ruleId: string, date: string) {
    this.state = { ...this.state, overrides: this.state.overrides.filter((o) => !(o.ruleId === ruleId && o.date === date)) }
    this.commit()
  }

  addEntry(en: UserEntry) {
    this.state = { ...this.state, entries: [...this.state.entries, en] }
    this.commit()
  }

  removeEntry(id: string) {
    this.state = { ...this.state, entries: this.state.entries.filter((e) => e.id !== id) }
    this.commit()
  }

  /** 改常规安排（每周生效），记一条变更 */
  editSessionRule(ruleId: string, patch: Partial<Pick<SessionRule, 'weekday' | 'startPeriod' | 'endPeriod' | 'location' | 'teacher'>>) {
    const before = this.state.rules.find((r) => r.id === ruleId)
    if (!before) return
    const changes: ChangeEntry[] = Object.entries(patch)
      .filter(([k, v]) => before[k as keyof SessionRule] !== v)
      .map(([k, v]) => ({
        id: uid(), at: Date.now(), actor: 'user', target: ruleId, field: k,
        from: String(before[k as keyof SessionRule] ?? ''), to: String(v ?? ''),
      }))
    this.state = {
      ...this.state,
      rules: this.state.rules.map((r) => (r.id === ruleId ? { ...r, ...patch } : r)),
      changes: [...this.state.changes, ...changes],
      userEditedCourseIds: [...new Set([...this.state.userEditedCourseIds, before.courseId])],
    }
    this.commit()
  }

  setPrefs(patch: Partial<Prefs>) {
    this.state = { ...this.state, prefs: { ...this.state.prefs, ...patch } }
    this.commit()
  }

  addTask(t: Task) {
    this.state = { ...this.state, tasks: [...this.state.tasks, t] }
    this.commit()
  }

  editTask(id: string, patch: Partial<Task>) {
    this.state = { ...this.state, tasks: this.state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }
    this.commit()
  }

  removeTask(id: string) {
    this.state = { ...this.state, tasks: this.state.tasks.filter((t) => t.id !== id) }
    this.commit()
  }

  setCourseHidden(courseId: string, hidden: boolean) {
    this.state = {
      ...this.state,
      courses: this.state.courses.map((c) => (c.id === courseId ? { ...c, hidden } : c)),
    }
    this.commit()
  }

  editCourse(courseId: string, patch: Partial<Pick<Course, 'name' | 'teacher' | 'color' | 'credit' | 'category'>>) {
    const before = this.state.courses.find((c) => c.id === courseId)
    if (!before) return
    const changes: ChangeEntry[] = Object.entries(patch)
      .filter(([k, v]) => before[k as keyof Course] !== v)
      .map(([k, v]) => ({
        id: uid(), at: Date.now(), actor: 'user', target: courseId, field: k,
        from: String(before[k as keyof Course] ?? ''), to: String(v ?? ''),
      }))
    this.state = {
      ...this.state,
      courses: this.state.courses.map((c) => (c.id === courseId ? { ...c, ...patch } : c)),
      changes: [...this.state.changes, ...changes],
      userEditedCourseIds: [...new Set([...this.state.userEditedCourseIds, courseId])],
    }
    this.commit()
  }

  saveRule(rule: RuleManifest) {
    const exists = this.state.savedRules.some((r) => r.id === rule.id)
    this.state = {
      ...this.state,
      savedRules: exists
        ? this.state.savedRules.map((r) => (r.id === rule.id ? rule : r))
        : [...this.state.savedRules, rule],
    }
    this.commit()
  }

  removeRule(id: string) {
    if (id.startsWith('builtin-')) return
    this.state = { ...this.state, savedRules: this.state.savedRules.filter((r) => r.id !== id) }
    this.commit()
  }

  restoreCourse(courseId: string) {
    this.state = {
      ...this.state,
      courses: this.state.courses.map((c) => (c.id === courseId ? { ...c, removedByImport: false, hidden: false } : c)),
    }
    this.commit()
  }

  purgeCourse(courseId: string) {
    this.state = {
      ...this.state,
      courses: this.state.courses.filter((c) => c.id !== courseId),
      rules: this.state.rules.filter((r) => r.courseId !== courseId),
      overrides: this.state.overrides.filter((o) => this.state.rules.find((r) => r.id === o.ruleId)?.courseId !== courseId),
    }
    this.commit()
  }

  previewImport(incoming: NormalizedCourse[]): ImportDiff {
    return diffImport(this.state.courses, incoming, new Set(this.state.userEditedCourseIds))
  }

  /** 事务式导入：全部计算完成后一次性替换状态。三方合并：
      - 用户改过的课保留用户字段，只更新排课规则
      - 本次消失的标 removedByImport，不物理删除
      - UserEntry / Override 永不触碰 */
  applyImport(incoming: NormalizedCourse[], batch: Omit<ImportBatch, 'added' | 'updated' | 'removed'>): ImportDiff {
    const diff = this.previewImport(incoming)
    const edited = new Set(this.state.userEditedCourseIds)
    const exByName = new Map(this.state.courses.filter((c) => c.source === 'import').map((c) => [c.identityKey, c]))

    const courses: Course[] = this.state.courses.filter((c) => c.source !== 'import')
    let rules: SessionRule[] = this.state.rules.filter((r) => {
      const c = this.state.courses.find((x) => x.id === r.courseId)
      return c?.source !== 'import'
    })
    let updated = 0

    for (const nc of incoming) {
      const k = nc.course.identityKey
      const ex = exByName.get(k)
      let course: Course
      if (ex) {
        course = edited.has(ex.id)
          ? { ...ex, removedByImport: false } // 保留用户值
          : { ...ex, ...nc.course, id: ex.id, semesterId: ex.semesterId, removedByImport: false }
        updated++
        exByName.delete(k)
      } else {
        course = { ...nc.course, id: uid(), semesterId: this.state.semester?.id ?? '' }
      }
      courses.push(course)
      for (const r of nc.rules) rules.push({ ...r, id: uid(), courseId: course.id })
    }
    // 消失的
    for (const c of exByName.values()) {
      courses.push({ ...c, removedByImport: true, hidden: true })
      // 保留其旧规则以便恢复
      rules = [...rules, ...this.state.rules.filter((r) => r.courseId === c.id)]
    }

    const fullBatch: ImportBatch = {
      ...batch, added: diff.added.length, updated, removed: diff.removed.length,
    }
    this.state = { ...this.state, courses, rules, batches: [...this.state.batches, fullBatch] }
    this.commit()
    return diff
  }

  /** 回滚到某次导入前：删除该批次引入的课程与规则的最简实现——
      依赖批次时间戳之后 source=import 的内容整体重放。P0 先支持回滚最近一次。 */
  rollbackLastImport(prev: State) {
    this.state = prev
    this.commit()
  }

  cloneState(): State {
    return JSON.parse(JSON.stringify(this.state, (_, v) => (typeof v === 'bigint' ? v.toString() : v)), (k, v) =>
      k === 'weeksMask' ? BigInt(v) : v) as State
  }
}
