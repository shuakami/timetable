import type {
  Course, ImportBatch, Override, Semester, SessionRule, UserEntry, ChangeEntry, Task, TaskPhoto, Prefs, WidgetStyle,
} from './types'
import { WIDGET_STYLES, defaultPrefs } from './types'
import type { Snapshot } from './engine'
import type { NormalizedCourse, ImportDiff } from './importer'
import { diffImport, matchImport, pairRules } from './importer'
import { BUILTIN_RULES, type RuleManifest } from './rules'

/* 本地权威存储。真相全部在内存 State，持久化通过 Persistence 适配器：
   Web 用 localStorage，Capacitor 换 SQLite 适配器，接口不变。 */

/** 往期学期：整份快照原样封存，只用于查看与导出 */
export interface SemesterArchive extends Snapshot {
  archivedAt: number
}

/** 持久化结构版本，`hydrate` 按它做一次性迁移 */
export const STATE_VERSION = 2

export interface State {
  version?: number
  semester: Semester | null
  archives: SemesterArchive[]
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
    version: STATE_VERSION,
    semester: null, archives: [], courses: [], rules: [], overrides: [], entries: [],
    batches: [], changes: [], userEditedCourseIds: [], savedRules: [...BUILTIN_RULES], tasks: [],
    prefs: defaultPrefs(),
  }
}

/** 只保留当前 Prefs 有的字段；旧版本的本地通知偏好（静音时段、每日摘要等）在这里丢掉 */
function hydratePrefs(raw: unknown): Prefs {
  const d = defaultPrefs()
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const nums = (v: unknown, fallback: number[]) => (Array.isArray(v) && v.every((x) => typeof x === 'number') ? (v as number[]) : fallback)
  return {
    classLead: typeof p.classLead === 'number' && p.classLead > 0 ? p.classLead : d.classLead,
    earlyLead: typeof p.earlyLead === 'number' ? p.earlyLead : d.earlyLead,
    taskLeads: nums(p.taskLeads, d.taskLeads),
    examDays: nums(p.examDays, d.examDays),
    widgetStyle: (WIDGET_STYLES as readonly string[]).includes(p.widgetStyle as string) ? (p.widgetStyle as WidgetStyle) : d.widgetStyle,
    name: typeof p.name === 'string' ? p.name : d.name,
    avatar: typeof p.avatar === 'string' ? p.avatar : d.avatar,
    wall: typeof p.wall === 'string' ? p.wall : d.wall,
  }
}

/** 从持久化读回的原始对象补齐类型：周次位掩码转 bigint，新字段补默认值 */
export function hydrate(s: State): State {
  for (const r of s.rules) r.weeksMask = BigInt(r.weeksMask as unknown as string)
  if (!s.archives) s.archives = []
  for (const a of s.archives) for (const r of a.rules) r.weeksMask = BigInt(r.weeksMask as unknown as string)
  if (!s.savedRules || s.savedRules.length === 0) s.savedRules = [...BUILTIN_RULES]
  if (!s.tasks) s.tasks = []
  for (const t of s.tasks) if (!t.photos) t.photos = []
  s.prefs = hydratePrefs(s.prefs)
  if ((s.version ?? 1) < 2) {
    // v1 身份键带 星期|起始节，去掉后才能和新导入对上
    const strip = (c: Course) => { c.identityKey = c.identityKey.replace(/\|\d+\|\d+$/, '') }
    s.courses.forEach(strip)
    for (const a of s.archives) a.courses.forEach(strip)
  }
  const dropOrphans = (snap: Pick<Snapshot, 'rules' | 'overrides'>) => {
    const ruleIds = new Set(snap.rules.map((r) => r.id))
    snap.overrides = snap.overrides.filter((o) => ruleIds.has(o.ruleId))
  }
  dropOrphans(s)
  s.archives.forEach(dropOrphans)
  s.version = STATE_VERSION
  return s
}

export interface Persistence {
  load(): State | null
  save(s: State): void
}

export const serializeState = (s: State): string => JSON.stringify(s, (_, v) => (typeof v === 'bigint' ? v.toString() : v))

/** 读回并迁移。结构版本升级时先把迁移前的原文交给 backup 留底，迁移出错还能找回 */
export function restoreState(raw: string, backup?: (json: string, fromVersion: number) => void): State {
  const parsed = JSON.parse(raw) as State
  const v = parsed.version ?? 1
  if (v < STATE_VERSION) backup?.(raw, v)
  return hydrate(parsed)
}

const KEY = 'timetable.v1'

export const localStoragePersistence: Persistence = {
  load() {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? restoreState(raw, (json, v) => localStorage.setItem(`${KEY}.bak.v${v}`, json)) : null
    } catch {
      return null
    }
  },
  save(s) {
    localStorage.setItem(KEY, serializeState(s))
  },
}

export const memoryPersistence = (): Persistence => {
  let mem: string | null = null
  return {
    load: () => (mem ? restoreState(mem) : null),
    save: (s) => {
      mem = serializeState(s)
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

  /** 整份数据清空，回到刚安装的状态 */
  reset() {
    this.state = emptyState()
    this.commit()
  }

  setSemester(sem: Semester) {
    this.state = { ...this.state, semester: sem }
    this.commit()
  }

  /** 开始新学期：当前学期连课程一起封存进往期，课表清空；作息、待办、规则与偏好保留 */
  startSemester(next: Semester) {
    const cur = this.snapshot()
    const archives = cur && (cur.courses.length > 0 || cur.entries.length > 0)
      ? [...this.state.archives.filter((a) => a.semester.id !== cur.semester.id), { ...cur, archivedAt: Date.now() }]
      : this.state.archives
    this.state = {
      ...this.state,
      semester: next,
      archives,
      courses: [], rules: [], overrides: [], entries: [], changes: [], userEditedCourseIds: [],
    }
    this.commit()
  }

  removeArchive(semesterId: string) {
    this.state = { ...this.state, archives: this.state.archives.filter((a) => a.semester.id !== semesterId) }
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

  addPhotos(taskId: string, photos: TaskPhoto[]) {
    this.editTask(taskId, {
      photos: [...(this.state.tasks.find((t) => t.id === taskId)?.photos ?? []), ...photos],
    })
  }

  removePhoto(taskId: string, photoId: string) {
    const t = this.state.tasks.find((x) => x.id === taskId)
    if (!t) return
    this.editTask(taskId, { photos: (t.photos ?? []).filter((p) => p.id !== photoId) })
  }

  setCourseHidden(courseId: string, hidden: boolean) {
    this.state = {
      ...this.state,
      courses: this.state.courses.map((c) => (c.id === courseId ? { ...c, hidden } : c)),
    }
    this.commit()
  }

  setCourseSticker(courseId: string, sticker: string | undefined) {
    this.state = {
      ...this.state,
      courses: this.state.courses.map((c) => {
        if (c.id !== courseId) return c
        const { sticker: _, ...rest } = c
        return sticker === undefined ? rest : { ...rest, sticker }
      }),
    }
    this.commit()
  }

  editCourse(courseId: string, patch: Partial<Pick<Course, 'name' | 'teacher' | 'teacherPhone' | 'color' | 'credit' | 'category'>>) {
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
    return diffImport(this.state.courses, incoming, new Set(this.state.userEditedCourseIds), this.state.rules)
  }

  /** 事务式导入：全部计算完成后一次性替换状态。三方合并：
      - 用户改过的课保留用户字段，只更新排课规则
      - 规则尽量沿用旧 id（同星期同节次优先），挂在上面的 Override 和变更记录继续有效；
        没有接班规则的 Override 随课次一起去掉
      - 本次消失的标 removedByImport，不物理删除，规则和 Override 保留
      - UserEntry 永不触碰 */
  applyImport(incoming: NormalizedCourse[], batch: Omit<ImportBatch, 'added' | 'updated' | 'removed'>): ImportDiff {
    const diff = this.previewImport(incoming)
    const edited = new Set(this.state.userEditedCourseIds)
    const matched = matchImport(this.state.courses, incoming)
    const kept = new Set(matched.values())
    const importIds = new Set(this.state.courses.filter((c) => c.source === 'import').map((c) => c.id))

    const courses: Course[] = this.state.courses.filter((c) => c.source !== 'import')
    const rules: SessionRule[] = this.state.rules.filter((r) => !importIds.has(r.courseId))
    const liveRuleIds = new Set(rules.map((r) => r.id))
    let updated = 0

    for (const nc of incoming) {
      const ex = matched.get(nc)
      let course: Course
      let oldRules: SessionRule[] = []
      if (ex) {
        course = edited.has(ex.id)
          ? { ...ex, teacherPhone: ex.teacherPhone ?? nc.course.teacherPhone, removedByImport: false } // 保留用户值
          : { ...ex, ...nc.course, id: ex.id, semesterId: ex.semesterId, removedByImport: false }
        oldRules = this.state.rules.filter((r) => r.courseId === ex.id)
        updated++
      } else {
        course = { ...nc.course, id: uid(), semesterId: this.state.semester?.id ?? '' }
      }
      courses.push(course)
      const pairs = pairRules(oldRules, nc.rules)
      for (const r of nc.rules) {
        const id = pairs.get(r)?.id ?? uid()
        rules.push({ ...r, id, courseId: course.id })
        liveRuleIds.add(id)
      }
    }
    // 消失的：课、规则、Override 原样保留以便恢复
    for (const c of this.state.courses) {
      if (c.source !== 'import' || kept.has(c)) continue
      courses.push({ ...c, removedByImport: true, hidden: true })
      for (const r of this.state.rules) {
        if (r.courseId !== c.id) continue
        rules.push(r)
        liveRuleIds.add(r.id)
      }
    }
    const overrides = this.state.overrides.filter((o) => liveRuleIds.has(o.ruleId))

    const fullBatch: ImportBatch = {
      ...batch, added: diff.added.length, updated, removed: diff.removed.length,
    }
    this.state = { ...this.state, courses, rules, overrides, batches: [...this.state.batches, fullBatch] }
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
