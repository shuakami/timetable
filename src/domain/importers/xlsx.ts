import * as XLSX from 'xlsx'
import type { Diagnostic } from '../types'
import type { CsvMapping, RuleCourse, RuleOutput } from '../importer'
import { parseWeekday } from '../importer'
import { parsePeriodRange } from '../weeks'

/* Excel(.xlsx/.xls) 导入：第一个工作表按行读取，列映射同 CSV。 */

export function parseXlsx(bytes: Uint8Array, map: CsvMapping): RuleOutput {
  const diags: Diagnostic[] = []
  let rows: string[][]
  try {
    const wb = XLSX.read(bytes, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    if (!sheet) return { courses: [], diagnostics: [{ level: 'error', code: 'NO_SHEET', message: '文件中没有工作表' }] }
    rows = (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][]).map((r) =>
      r.map((c) => String(c ?? '').trim()),
    )
  } catch {
    return { courses: [], diagnostics: [{ level: 'error', code: 'BAD_XLSX', message: 'Excel 文件无法解析' }] }
  }
  const courses: RuleCourse[] = []
  rows.slice(map.skipRows ?? 1).forEach((cells, i) => {
    const row = i + (map.skipRows ?? 1) + 1
    const name = cells[map.name]
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
      teacher: map.teacher != null ? cells[map.teacher] || undefined : undefined,
      location: map.location != null ? cells[map.location] || undefined : undefined,
      weekday,
      startPeriod: pr.start,
      endPeriod: pr.end,
      weeks: cells[map.weeks] ?? '',
    })
  })
  return { courses, diagnostics: diags }
}
