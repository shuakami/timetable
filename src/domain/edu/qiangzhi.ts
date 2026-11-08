import type { Diagnostic } from '../types'
import type { RuleCourse, RuleOutput } from '../importer'
import { extractPhone, parseWeekday } from '../importer'
import { maskToWeeks, parsePeriodRange, parseWeekExpr } from '../weeks'

/**
 * 强智教务（jsxsd）学生课表 `xskb/xskb_list.do` 的 `table#kbtable` 网格解析。
 * 版面：首行 星期一~星期日；每行一个节次组（行首「第一二节」+ 起止时间），
 * 每个课程格里是若干 `div.kbcontent`（放大版：课名 / 老师 / 周次(节次)[xx-yy节] / 教室，
 * 同格多门课用 `----------------` 分隔），另有 `div.kbcontent1`（缩略版：无老师、无节次）。
 * 节次以格内 `[xx-yy节]` 为准；缺失时退回行首中文数字节次组。
 */

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/** 单元格 / 课程块内层 HTML → 行文本（<br> 分行、去标签、解常见实体） */
function linesOf(inner: string): string[] {
  return inner
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** 一行里取每个 <td>/<th> 的内层 HTML */
function cellsOf(rowHtml: string): string[] {
  const out: string[] = []
  const re = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(rowHtml))) out.push(m[1])
  return out
}

/** 在给定 HTML（课表 frame 的 outerHTML 或整页）里找到 kbtable；找不到退回含 kbcontent 的表 */
function findKbTable(html: string): string | null {
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map((m) => m[0])
  for (const t of tables) {
    if (/\bid\s*=\s*["']?kbtable["'\s>]/i.test(t.slice(0, 300))) return t
  }
  for (const t of tables) {
    if (/<div\b[^>]*class\s*=\s*["'][^"']*\bkbcontent1?\b/i.test(t)) return t
  }
  return null
}

const WEEKDAY_HEAD = /(星期|周)\s*[一二三四五六日天1-7]/

/** 表头格 → 星期 1-7；只认显式星期标记，避免把「第一二节」误判成星期 */
function headerWeekday(h: string): number | null {
  if (!WEEKDAY_HEAD.test(h)) return null
  return parseWeekday(h)
}

/* ---------- 中文数字节次组（行首「第一二节」「第九十十一节」兜底用） ---------- */

const CN_DIGIT: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/** 严格中文数字 1-99：九 / 十 / 十一 / 二十 / 二十三 …；「二三」这种不算数 */
function cnNumber(s: string): number | null {
  if (!s) return null
  if (/^[一二三四五六七八九]$/.test(s)) return CN_DIGIT[s]
  const m = s.match(/^([二三四五六七八九])?十([一二三四五六七八九])?$/)
  if (!m) return null
  const tens = m[1] ? CN_DIGIT[m[1]] : 1
  const ones = m[2] ? CN_DIGIT[m[2]] : 0
  return tens * 10 + ones
}

const CN_RUN = /[一二三四五六七八九十]+/

/**
 * 「九十一」「十一二」「一二」这类逐节连写的中文数字串 → 节次号列表。
 * 整体能按单个数字读（≤30）时按单节处理；否则从左到右贪心切分，
 * 十几开头的后一位数字按续号处理（「十一二」→ 11,12）。
 */
function cnSections(s: string): number[] | null {
  const whole = cnNumber(s)
  if (whole != null && whole >= 1 && whole <= 30) return [whole]
  const out: number[] = []
  let i = 0
  while (i < s.length) {
    let adv = 0
    let val = 0
    for (const len of [3, 2, 1]) {
      const v = cnNumber(s.slice(i, i + len))
      if (v != null && v >= 1 && v <= 30) {
        adv = len
        val = v
        break
      }
    }
    if (!adv) return null
    const prev = out[out.length - 1]
    if (prev != null && prev >= 10 && prev <= 19 && val >= 1 && val <= 9) val += 10
    out.push(val)
    i += adv
  }
  return out.length ? out : null
}

/** 行首节次格（「第一二节 08:20-09:55」）→ 节次区间；只作格内缺 [xx节] 时的兜底 */
function headerPeriods(cellInner: string): { start: number; end: number } | null {
  const first = linesOf(cellInner)[0] ?? ''
  const core = first.replace(/[第节\s]/g, '')
  const pr = parsePeriodRange(core)
  if (pr) return pr
  const cn = core.match(CN_RUN)
  if (!cn) return null
  const ns = cnSections(cn[0])
  if (!ns || !ns.length) return null
  return { start: Math.min(...ns), end: Math.max(...ns) }
}

/* ---------- 课程格 ---------- */

const SEP_RE = /^[-—–]{3,}$/
/** 周次行：「4-18(周)[01-02节]」「12,14,16,18(周)」「1-16周(单)」 */
const WEEKS_LINE_RE = /[(（]周[)）]|^\d[\d,.\-]*\s*周/
const BRACKET_RE = /\[([^\]]*)\]/
/** 课名尾部的调课标记（红字 O=整体 P=部分），不属于课名 */
const MARK_RE = /\s+[OP]$/

interface CellDiv {
  expanded: boolean
  inner: string
}

/** 取课程格里的课程块 div：优先 kbcontent（含老师与 [xx节]），为空退回 kbcontent1（缩略版） */
function courseBlocks(cellInner: string): string[][] {
  const divs: CellDiv[] = []
  /* 课程块 div 内不再嵌套 div：逐个开标签匹配，内容取到下一个 </div>，外层包裹 div 不影响 */
  const re = /<div\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(cellInner))) {
    const tag = m[0]
    const cm = tag.match(/class\s*=\s*["']([^"']*)["']/i)
    if (!cm) continue
    const tokens = cm[1].split(/\s+/)
    const expanded = tokens.includes('kbcontent')
    const compact = tokens.includes('kbcontent1')
    if (!expanded && !compact) continue
    const innerStart = re.lastIndex
    const close = cellInner.indexOf('</div>', innerStart)
    const inner = close < 0 ? '' : cellInner.slice(innerStart, close)
    divs.push({ expanded, inner })
  }
  const expandedHasText = divs.some((d) => d.expanded && linesOf(d.inner).length > 0)
  const chosen = expandedHasText ? divs.filter((d) => d.expanded) : divs.filter((d) => !d.expanded)
  const blocks: string[][] = []
  for (const d of chosen) {
    let cur: string[] = []
    for (const l of linesOf(d.inner)) {
      if (SEP_RE.test(l)) {
        if (cur.length) blocks.push(cur)
        cur = []
        continue
      }
      cur.push(l)
    }
    if (cur.length) blocks.push(cur)
  }
  return blocks
}

function periodsFromBracket(inner: string): { start: number; end: number } | null {
  const ns = [...inner.matchAll(/\d+/g)].map((m) => parseInt(m[0], 10)).filter((n) => n >= 1)
  if (!ns.length) return null
  return { start: Math.min(...ns), end: Math.max(...ns) }
}

/** 周次部分：「4-18(周)」→「4-18」；带单双周的括号保留给 parseWeekExpr */
function weeksExprOf(weeksLine: string): string {
  const pre = weeksLine.split('[')[0]
  return pre.replace(/[（(][^)）]*[)）]/g, (m) => (/[单双]/.test(m) ? m : '')).trim()
}

/* ---------- 主入口 ---------- */

export function parseQzTable(html: string): RuleOutput {
  const diags: Diagnostic[] = []
  const courses: RuleCourse[] = []
  const table = findKbTable(html)
  if (!table) {
    return { courses: [], diagnostics: [{ level: 'error', code: 'NO_TABLE', message: '页面中没有找到课表表格' }] }
  }
  const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((m) => m[0])
  if (rows.length < 2) {
    return { courses: [], diagnostics: [{ level: 'error', code: 'NO_TABLE', message: '课表表格为空' }] }
  }

  // 表头：找前几行里星期列最多的一行
  let headerIdx = -1
  let colWd: number[] = []
  for (let i = 0; i < Math.min(3, rows.length); i++) {
    const texts = cellsOf(rows[i]).map((c) => clean(linesOf(c).join(' ')))
    const wd = texts.map((h) => headerWeekday(h) ?? 0)
    if (wd.filter((w) => w > 0).length >= 5) {
      headerIdx = i
      colWd = wd
      break
    }
  }
  if (headerIdx < 0) {
    return { courses: [], diagnostics: [{ level: 'error', code: 'NO_TABLE', message: '课表表头无法识别' }] }
  }
  const maxCol = Math.max(...colWd.map((w, i) => (w > 0 ? i : -1)))

  rows.slice(headerIdx + 1).forEach((rowHtml, ri) => {
    const rowNo = headerIdx + ri + 2
    const cells = cellsOf(rowHtml)
    const firstText = clean(linesOf(cells[0] ?? '').join(' '))
    if (/备注/.test(firstText) || cells.length <= maxCol) return
    const fallback = headerPeriods(cells[0] ?? '')
    for (let ci = 0; ci < colWd.length; ci++) {
      const wd = colWd[ci]
      if (!wd || ci >= cells.length) continue
      for (const block of courseBlocks(cells[ci])) {
        if (!block.length) continue
        const name = clean(block[0]).replace(MARK_RE, '')
        if (!name) continue
        let wi = -1
        for (let i = 1; i < block.length; i++) {
          if (WEEKS_LINE_RE.test(block[i])) {
            wi = i
            break
          }
        }
        if (wi < 0) {
          diags.push({ level: 'warn', code: 'NO_WEEKS', message: `「${name}」没有识别出周次行，已跳过`, at: { row: rowNo, snippet: block.join(' / ') } })
          continue
        }
        const weeksLine = block[wi]
        const bm = weeksLine.match(BRACKET_RE)
        const periods = (bm ? periodsFromBracket(bm[1]) : null) ?? fallback
        if (!periods) {
          diags.push({ level: 'warn', code: 'BAD_PERIOD', message: `「${name}」节次无法识别，已跳过`, at: { row: rowNo, snippet: weeksLine } })
          continue
        }
        const wk = parseWeekExpr(weeksExprOf(weeksLine))
        if (wk.error || wk.mask === 0n) {
          diags.push({ level: 'warn', code: 'BAD_WEEKS', message: `「${name}」周次无法识别：${weeksLine}`, at: { row: rowNo, snippet: weeksLine } })
          continue
        }
        const weeks = maskToWeeks(wk.mask).join(',')
        const teacher = clean(block.slice(1, wi).join(' '))
        const location = clean(block.slice(wi + 1).join(' '))
        const rc: RuleCourse = {
          name,
          weekday: wd,
          startPeriod: periods.start,
          endPeriod: periods.end,
          weeks,
          raw: { name: block[0], weeks: weeksLine },
        }
        if (teacher) {
          rc.teacher = teacher
          const phone = extractPhone(teacher)
          if (phone) rc.teacherPhone = phone
        }
        if (location) rc.location = location
        courses.push(rc)
      }
    }
  })

  if (courses.length === 0) {
    diags.push({ level: 'error', code: 'EMPTY', message: '课表表格里没有解析出课程' })
  }
  return { courses, diagnostics: diags }
}

/** 强智学年学期值「2026-2027-1」→「2026–2027 学年 第 1 学期」 */
export function qzTermLabel(term: string): string {
  const t = term.trim()
  const m = t.match(/^(\d{4})-(\d{4})-([12])$/)
  if (!m) return t
  return `${m[1]}–${m[2]} 学年 第 ${m[3] === '1' ? 1 : 2} 学期`
}
