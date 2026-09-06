import { SYSTEM_LABEL, scrubUrl, type EduSystemId } from './systems'

/* 未识别页的两条出口：检查新版本、去 GitHub 反馈。反馈正文只带脱敏地址、系统猜测和版本号 */

export const REPO = 'shuakami/timetable'
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`

/** "v1.4.55" → [1, 4, 55]；不像版本号的返回 null */
export function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+)*)/.exec(v.trim())
  if (!m) return null
  return m[1].split('.').map(Number)
}

export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

export interface FeedbackInfo {
  url: string
  system: EduSystemId | null
  version: string
}

export function issueUrl(info: FeedbackInfo): string {
  const page = scrubUrl(info.url)
  const body = [
    `页面：${page}`,
    `系统猜测：${info.system ? SYSTEM_LABEL[info.system] : '未知'}`,
    `版本：${info.version || '未知'}`,
    '',
    '（可补充：页面截图、课表结构说明）',
  ].join('\n')
  const q = new URLSearchParams({ title: `教务导入未识别：${page}`, body, labels: 'edu-import' })
  return `https://github.com/${REPO}/issues/new?${q.toString()}`
}
