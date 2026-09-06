import raw from './schools.json'
import { isEduSystem, type EduSystemId } from './systems'

/** 学校索引：名称、系统、教务入口。数据来自 baoozak/timetable（MIT），随应用打包，不在线更新 */
export interface School {
  name: string
  system: EduSystemId | null
  url: string
}

const ALL: School[] = (raw as [string, string, string][]).map(([name, sys, url]) => ({
  name,
  system: isEduSystem(sys) ? sys : null,
  url,
}))

export const schoolCount = () => ALL.length

const looksLikeUrl = (q: string) => /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/|$)/i.test(q) || /^https?:\/\//i.test(q)

/** 按校名或教务网址子串搜索；名称前缀命中排前 */
export function searchSchools(q: string, limit = 30): School[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  const pre: School[] = []
  const mid: School[] = []
  for (const x of ALL) {
    const n = x.name.toLowerCase()
    if (n.startsWith(s)) pre.push(x)
    else if (n.includes(s) || x.url.toLowerCase().includes(s)) mid.push(x)
    if (pre.length >= limit) break
  }
  return [...pre, ...mid].slice(0, limit)
}

/** 输入的是网址时，补全协议 */
export function urlFromQuery(q: string): string | null {
  const s = q.trim()
  if (!looksLikeUrl(s)) return null
  return /^https?:\/\//i.test(s) ? s : `http://${s}`
}

/** 同主机的已知学校，用来给手输网址标系统 */
export function schoolByUrl(url: string): School | null {
  let host: string
  try {
    host = new URL(url).host.toLowerCase()
  } catch {
    return null
  }
  const root = host.split('.').slice(-3).join('.')
  return ALL.find((x) => {
    try {
      const h = new URL(x.url).host.toLowerCase()
      return h === host || h.endsWith(root)
    } catch {
      return false
    }
  }) ?? null
}
