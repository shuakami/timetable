import { getQuickJS } from 'quickjs-emscripten'
import type { Diagnostic } from './types'
import type { RuleCourse, RuleOutput } from './importer'

/* QuickJS-WASM 沙箱：脚本规则是纯函数 (input, ctx) => RuleOutput。
   不接触 DOM、cookie、fetch、文件系统；宿主只注入 ctx.log / ctx.warn。
   限制：执行超时、内存上限、输出体积上限。超限即失败并给出诊断。 */

const TIMEOUT_MS = 2000
const MEMORY_LIMIT = 32 * 1024 * 1024
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024

export async function runScript(script: string, input: string): Promise<RuleOutput> {
  const diags: Diagnostic[] = []
  const QuickJS = await getQuickJS()
  const runtime = QuickJS.newRuntime()
  runtime.setMemoryLimit(MEMORY_LIMIT)
  const deadline = Date.now() + TIMEOUT_MS
  runtime.setInterruptHandler(() => Date.now() > deadline)
  const vm = runtime.newContext()
  try {
    // 注入 ctx.log / ctx.warn（只能产生诊断，不能越权）
    const logFn = vm.newFunction('log', (msg) => {
      diags.push({ level: 'info', code: 'SCRIPT_LOG', message: String(vm.dump(msg)) })
    })
    const warnFn = vm.newFunction('warn', (msg) => {
      diags.push({ level: 'warn', code: 'SCRIPT_WARN', message: String(vm.dump(msg)) })
    })
    const ctxObj = vm.newObject()
    vm.setProp(ctxObj, 'log', logFn)
    vm.setProp(ctxObj, 'warn', warnFn)
    vm.setProp(vm.global, '__ctx', ctxObj)
    logFn.dispose()
    warnFn.dispose()
    ctxObj.dispose()

    const inputHandle = vm.newString(input)
    vm.setProp(vm.global, '__input', inputHandle)
    inputHandle.dispose()

    const code = `JSON.stringify((${script})(__input, __ctx))`
    const result = vm.evalCode(code)
    if (result.error) {
      const err = vm.dump(result.error)
      result.error.dispose()
      const msg = typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message) : String(err)
      return { courses: [], diagnostics: [...diags, { level: 'error', code: 'SCRIPT_ERROR', message: `脚本执行失败：${msg}` }] }
    }
    const json = String(vm.dump(result.value))
    result.value.dispose()
    if (json.length > MAX_OUTPUT_BYTES) {
      return { courses: [], diagnostics: [...diags, { level: 'error', code: 'OUTPUT_TOO_LARGE', message: '脚本输出超过体积上限' }] }
    }
    return validateOutput(json, diags)
  } finally {
    vm.dispose()
    runtime.dispose()
  }
}

function validateOutput(json: string, diags: Diagnostic[]): RuleOutput {
  let obj: unknown
  try {
    obj = JSON.parse(json)
  } catch {
    return { courses: [], diagnostics: [...diags, { level: 'error', code: 'BAD_OUTPUT', message: '脚本输出不是合法 JSON' }] }
  }
  const root = obj as { courses?: unknown[]; diagnostics?: unknown[] }
  if (!Array.isArray(root.courses)) {
    return { courses: [], diagnostics: [...diags, { level: 'error', code: 'BAD_OUTPUT', message: '脚本输出缺少 courses 数组' }] }
  }
  const courses: RuleCourse[] = []
  root.courses.forEach((c, i) => {
    const o = c as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    const weekday = typeof o.weekday === 'number' ? o.weekday : NaN
    const startPeriod = typeof o.startPeriod === 'number' ? o.startPeriod : NaN
    const endPeriod = typeof o.endPeriod === 'number' ? o.endPeriod : startPeriod
    const weeks = typeof o.weeks === 'string' ? o.weeks : Array.isArray(o.weeks) ? (o.weeks as number[]).join(',') : ''
    if (!name || !(weekday >= 1 && weekday <= 7) || isNaN(startPeriod)) {
      diags.push({ level: 'error', code: 'BAD_COURSE', message: `脚本输出第 ${i + 1} 条课程缺少必需字段`, at: { row: i + 1 } })
      return
    }
    courses.push({
      name,
      teacher: typeof o.teacher === 'string' ? o.teacher : undefined,
      location: typeof o.location === 'string' ? o.location : undefined,
      weekday,
      startPeriod,
      endPeriod,
      weeks,
    })
  })
  return { courses, diagnostics: diags }
}
