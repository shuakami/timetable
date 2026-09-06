import manifest from './stickers.json'
import type { Course } from './types'

/** [贴纸 id, 来源, ...关键词]；关键词以 `~` 开头的是泛词，只在没有更具体命中时兜底 */
type Entry = [string, string, ...string[]]

const ENTRIES = manifest as Entry[]
const ASCII = /^[\x20-\x7e]+$/
const WORD = /[a-z0-9]/

/** 纯英文关键词按整词命中（`ai` 不命中 `chain`），中文按子串 */
function hit(name: string, kw: string): boolean {
  let i = name.indexOf(kw)
  if (!ASCII.test(kw)) return i >= 0
  while (i >= 0) {
    const a = name[i - 1]
    const b = name[i + kw.length]
    if (!(a && WORD.test(a)) && !(b && WORD.test(b))) return true
    i = name.indexOf(kw, i + 1)
  }
  return false
}

const cache = new Map<string, string | null>()

/** 按课程名匹配学科贴纸；匹配不到返回 null */
export function stickerOf(name: string): string | null {
  const key = name.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!key) return null
  const hitCache = cache.get(key)
  if (hitCache !== undefined) return hitCache
  let out: string | null = null
  outer: for (const generic of [false, true]) {
    for (const [id, , ...kws] of ENTRIES) {
      for (const k of kws) {
        if (k.startsWith('~') !== generic) continue
        if (hit(key, generic ? k.slice(1) : k)) {
          out = id
          break outer
        }
      }
    }
  }
  cache.set(key, out)
  return out
}

/** 课程最终显示的贴纸：手动选过的优先，否则按课名自动匹配 */
export function stickerFor(course: Pick<Course, 'name' | 'sticker'>): string | null {
  return course.sticker ?? stickerOf(course.name)
}

/** 某次上课的贴纸：能对到课程就用课程的设置，否则按名字匹配 */
export function stickerOfOcc(occ: { courseId?: string; name: string }, courses: readonly Course[]): string | null {
  const c = occ.courseId ? courses.find((x) => x.id === occ.courseId) : undefined
  return c ? stickerFor(c) : stickerOf(occ.name)
}

export function stickerSrc(id: string): string {
  return `/stickers/${id}.svg`
}

export const STICKER_IDS: readonly string[] = ENTRIES.map((e) => e[0])

/** 按关键词筛贴纸；空串返回全部 */
export function searchStickers(query: string): string[] {
  const q = query.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!q) return ENTRIES.map((e) => e[0])
  return ENTRIES.filter(([id, , ...kws]) => id.includes(q) || kws.some((k) => (k.startsWith('~') ? k.slice(1) : k).includes(q))).map((e) => e[0])
}
