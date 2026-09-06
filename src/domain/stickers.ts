import manifest from './stickers.json'

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

export function stickerSrc(id: string): string {
  return `/stickers/${id}.svg`
}

export const STICKER_IDS: readonly string[] = ENTRIES.map((e) => e[0])
