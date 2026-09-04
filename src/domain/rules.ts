import type { Diagnostic, Semester } from './types'
import type { CsvMapping, RuleOutput } from './importer'
import { parseCsv, parseJsonTable } from './importer'
import { parseHtml, type HtmlOptions } from './importers/html'
import { parseIcs } from './importers/ics'
import { parseXlsx } from './importers/xlsx'
import { runScript } from './sandbox'

/* 规则系统：规则是用户可选、可配置、可版本化的解析器。
   声明式优先（csv/json/html/xlsx/ics），脚本规则跑在 QuickJS 沙箱里。 */

export type RuleInputKind = 'csv' | 'json' | 'html' | 'xlsx' | 'ics' | 'script'

export interface RuleSample {
  input: string
  expectCourses: number
}

export interface RuleManifest {
  id: string
  name: string
  version: string
  input: RuleInputKind
  csv?: CsvMapping
  html?: HtmlOptions
  script?: string
  samples?: RuleSample[]
  createdAt: number
  updatedAt: number
}

export const DEFAULT_CSV_MAPPING: CsvMapping = {
  name: 0, teacher: 1, location: 2, weekday: 3, periods: 4, weeks: 5, skipRows: 1,
}

export const BUILTIN_RULES: RuleManifest[] = [
  { id: 'builtin-csv', name: 'CSV 通用规则', version: '1.0', input: 'csv', csv: DEFAULT_CSV_MAPPING, createdAt: 1, updatedAt: 1 },
  { id: 'builtin-json', name: 'JSON 课表', version: '1.0', input: 'json', createdAt: 2, updatedAt: 2 },
  { id: 'builtin-html', name: '教务 HTML 课表网格', version: '1.0', input: 'html', html: { mode: 'grid' }, createdAt: 3, updatedAt: 3 },
  { id: 'builtin-xlsx', name: 'Excel 表格', version: '1.0', input: 'xlsx', csv: DEFAULT_CSV_MAPPING, createdAt: 4, updatedAt: 4 },
  { id: 'builtin-ics', name: 'ICS 日历订阅', version: '1.0', input: 'ics', createdAt: 5, updatedAt: 5 },
]

export interface RuleInput {
  text: string
  bytes?: Uint8Array
}

export async function runRule(rule: RuleManifest, input: RuleInput, sem: Semester): Promise<RuleOutput> {
  switch (rule.input) {
    case 'csv':
      return parseCsv(input.text, rule.csv ?? DEFAULT_CSV_MAPPING)
    case 'json':
      return parseJsonTable(input.text)
    case 'html':
      return parseHtml(input.text, rule.html ?? { mode: 'grid' })
    case 'xlsx': {
      if (!input.bytes) {
        return { courses: [], diagnostics: [{ level: 'error', code: 'NO_FILE', message: 'Excel 导入需要选择 .xlsx 文件' }] }
      }
      return parseXlsx(input.bytes, rule.csv ?? DEFAULT_CSV_MAPPING)
    }
    case 'ics':
      return parseIcs(input.text, sem)
    case 'script': {
      if (!rule.script) {
        return { courses: [], diagnostics: [{ level: 'error', code: 'NO_SCRIPT', message: '脚本规则缺少脚本内容' }] }
      }
      return runScript(rule.script, input.text)
    }
  }
}

/** 规则自带样本回归：安装/保存时本地跑一遍，输出不一致则给诊断 */
export async function runSamples(rule: RuleManifest, sem: Semester): Promise<Diagnostic[]> {
  const diags: Diagnostic[] = []
  for (const [i, s] of (rule.samples ?? []).entries()) {
    try {
      const out = await runRule(rule, { text: s.input }, sem)
      const errors = out.diagnostics.filter((d) => d.level === 'error')
      if (errors.length > 0) {
        diags.push({ level: 'error', code: 'SAMPLE_FAILED', message: `样本 ${i + 1} 解析报错：${errors[0].message}` })
      } else if (out.courses.length !== s.expectCourses) {
        diags.push({
          level: 'error', code: 'SAMPLE_MISMATCH',
          message: `样本 ${i + 1} 期望 ${s.expectCourses} 条课程，实际 ${out.courses.length} 条`,
        })
      } else {
        diags.push({ level: 'info', code: 'SAMPLE_OK', message: `样本 ${i + 1} 通过（${out.courses.length} 条课程）` })
      }
    } catch (e) {
      diags.push({ level: 'error', code: 'SAMPLE_THREW', message: `样本 ${i + 1} 执行失败：${e instanceof Error ? e.message : String(e)}` })
    }
  }
  return diags
}

