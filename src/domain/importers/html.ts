import type { Diagnostic } from '../types'
import type { RuleCourse, RuleOutput, CsvMapping } from '../importer'
import { parseWeekday } from '../importer'
import { parsePeriodRange } from '../weeks'
 
/* HTML 课表导入：不依赖 DOMParser，纯文本表格提取，Node/浏览器通用。
   两种形态：
   - table：一行一条课，列映射同 CSV
   - grid：课表网格，行=节次、列=星期，格内多行文本按模板拆字段 */

const PHONE_RE = /(?:\+?86[- ]?)?1[3-9]\d(?:[ \-]?\d){8}/
function extractPhone(s: string | undefined): string | undefined {
  if (!s) return undefined
  const m = s.match(PHONE_RE)
  return m ? m[0].replace(/[\s\-]/g, '').replace(/^\+?86/, '') : undefined
}
 
interface Cell {
  text: string
  rowspan: number
  colspan: number
}
 
/** 提取 HTML 里第 tableIndex 个 <table> 的单元格矩阵（已展开 rowspan/colspan） */
export function extractTable(html: string, tableIndex = 0): string[][] {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((m) => m[0])
  const t = tables[tableIndex]
  if (!t) return []
  const rows: Cell[][] = []
  for (const rm of t.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const cells: Cell[] = []
    for (const cm of rm[0].matchAll(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const attrs = cm[2]
      const span = (name: string) => {
        const m = attrs.match(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i'))
        return m ? parseInt(m[1], 10) : 1
      }
      cells.push({ text: cellText(cm[3]), rowspan: span('rowspan'), colspan: span('colspan') })
    }
    rows.push(cells)
  }
  // 展开 rowspan/colspan
  const grid: string[][] = []
  const pending = new Map<string, { text: string; remain: number }>()
  rows.forEach((cells, r) => {
    const out: string[] = []
    let c = 0
    const fill = () => {
      while (pending.has(`${r},${c}`)) {
        out[c] = pending.get(`${r},${c}`)!.text
        c++
      }
    }
    fill()
    for (const cell of cells) {
      fill()
      for (let k = 0; k < cell.colspan; k++) {
        out[c] = cell.text
        for (let dr = 1; dr < cell.rowspan; dr++) pending.set(`${r + dr},${c}`, { text: cell.text, remain: 0 })
        c++
      }
      fill()
    }
    grid.push(out)
  })
  return grid
}
 
function cellText(inner: string): string {
  return inner
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
}
 
export interface HtmlTableOptions {
  mode: 'table'
  tableIndex?: number
  mapping: CsvMapping // 列下标映射，skipRows 生效
}
 
export interface HtmlGridOptions {
  mode: 'grid'
  tableIndex?: number
  headerRows?: number // 顶部表头行数，默认 1
  periodCol?: number // 节次所在列，默认 0
  weekdayStartCol?: number // 周一所在列，默认 1
  /** 格内多行：第 1 行课名，其余行按正则找教师/地点/周次 */
  weeksPattern?: string // 默认匹配「1-16周」「1-8,10周(单)」等
}
 
export type HtmlOptions = HtmlTableOptions | HtmlGridOptions
 
export function parseHtml(html: string, opts: HtmlOptions): RuleOutput {
  const grid = extractTable(html, opts.tableIndex ?? 0)
  if (grid.length === 0) {
    return { courses: [], diagnostics: [{ level: 'error', code: 'NO_TABLE', message: '页面中没有找到课表表格' }] }
  }
  if (opts.mode === 'table') return parseTableMode(grid, opts)
  return parseGridMode(grid, opts)
}
 
function parseTableMode(grid: string[][], opts: HtmlTableOptions): RuleOutput {
  const diags: Diagnostic[] = []
  const courses: RuleCourse[] = []
  const map = opts.mapping
  grid.slice(map.skipRows ?? 1).forEach((cells, i) => {
    const row = i + (map.skipRows ?? 1) + 1
    const name = cells[map.name]?.trim()
    if (!name) return
    const weekday = parseWeekday(cells[map.weekday])
    if (!weekday) {
      diags.push({ level: 'error', code: 'UNPARSED_WEEKDAY', message: `第 ${row} 行星期无法解析：${cells[map.weekday] ?? ''}`, at: { row } })
      return
    }
    const pr = parsePeriodRange(cells[map.periods] ?? '')
    if (!pr) {
      diags.push({ level: 'error', code: 'UNPARSED_PERIOD', message: `第 ${row} 行节次无法解析：${cells[map.periods] ?? ''}`, at: { row } })
      return
    }
    courses.push({
      name,
      teacher: map.teacher != null ? cells[map.teacher]?.trim() || undefined : undefined,
      teacherPhone: map.teacherPhone != null
        ? cells[map.teacherPhone]?.trim() || undefined
        : extractPhone(cells[map.teacher]),
      location: map.location != null ? cells[map.location]?.trim() || undefined : undefined,
      weekday,
      startPeriod: pr.start,
      endPeriod: pr.end,
      weeks: cells[map.weeks] ?? '',
    })
  })
  return { courses, diagnostics: diags }
}
 
const DEFAULT_WEEKS_RE = /((?:\d+(?:-\d+)?(?:[,，]\d+(?:-\d+)?)*)\s*周?\s*[（(]?(单|双)?[)）]?周?)/
 
function parseGridMode(grid: string[][], opts: HtmlGridOptions): RuleOutput {
  const diags: Diagnostic[] = []
  const courses: RuleCourse[] = []
  const headerRows = opts.headerRows ?? 1
  const periodCol = opts.periodCol ?? 0
  const startCol = opts.weekdayStartCol ?? 1
  const weeksRe = opts.weeksPattern ? new RegExp(opts.weeksPattern) : DEFAULT_WEEKS_RE
  const seen = new Map<string, RuleCourse>()
 
  grid.slice(headerRows).forEach((cells, ri) => {
    const pr = parsePeriodRange(cells[periodCol] ?? '') ?? { start: ri + 1, end: ri + 1 }
    for (let wd = 1; wd <= 7; wd++) {
      const raw = cells[startCol + wd - 1]
      if (!raw?.trim()) continue
      // 同一格可能有多门课（空行分隔）
      for (const block of raw.split(/\n{2,}/)) {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
        if (lines.length === 0) continue
        const name = lines[0]
        const rest = lines.slice(1).join(' ')
        const wm = rest.match(weeksRe) ?? block.match(weeksRe)
        if (!wm) {
          diags.push({ level: 'warn', code: 'NO_WEEKS', message: `「${name}」没有识别出周次，按整学期处理`, at: { snippet: block } })
        }
        const weeks = wm ? wm[1].replace(/周/g, '').replace(/[（(]/, '').replace(/[)）]/, '') : '1-52'
        const location = lines.slice(1).find((l) => /楼|馆|室|区|号|[A-Z]\d{2,}/.test(l))
        const cleanPhone = extractPhone(block)
        const phoneLine = cleanPhone ? lines.find((l) => l.replace(/[\s\-]/g, '').includes(cleanPhone)) : undefined
        const teacher = lines.slice(1).find((l) => l !== location && l !== phoneLine && !weeksRe.test(l) && !/楼|馆|室|区|号|[A-Z]\d{2,}/.test(l) && !(cleanPhone && l.replace(/[\s\-]/g, '').includes(cleanPhone)))
        // rowspan 展开后同一门课出现在连续多行：合并为一个节次区间
        const key = `${name}|${wd}|${weeks}`
        const prev = seen.get(key)
        if (prev && pr.start <= prev.endPeriod + 1) {
          prev.endPeriod = Math.max(prev.endPeriod, pr.end)
          if (!prev.teacher && teacher) prev.teacher = teacher
          if (!prev.teacherPhone && cleanPhone) prev.teacherPhone = cleanPhone
          if (!prev.location && location) prev.location = location
          continue
        }
        const rc: RuleCourse = { name, teacher, teacherPhone: cleanPhone, location, weekday: wd, startPeriod: pr.start, endPeriod: pr.end, weeks }
        seen.set(key, rc)
        courses.push(rc)
      }
    }
  })
  return { courses, diagnostics: diags }
}
