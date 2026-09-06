/**
 * 教务系统指纹：从 URL / 标题认出是哪家系统、当前是不是课表页。
 * 只看地址和标题，不读页面内容；页面内容只在用户点「导入」后由对应脚本读取。
 */

export type EduSystemId =
  | 'zhengfang_new'
  | 'qiangzhi'
  | 'qiangzhi_old'
  | 'kingosoft'
  | 'kingosoft_new'
  | 'urp'
  | 'urp_new'
  | 'wisedu'
  | 'south_soft'
  | 'chaoxing'

export const SYSTEM_LABEL: Record<EduSystemId, string> = {
  zhengfang_new: '正方教务',
  qiangzhi: '强智教务',
  qiangzhi_old: '强智教务',
  kingosoft: '青果教务',
  kingosoft_new: '青果教务',
  urp: 'URP 教务',
  urp_new: 'URP 教务',
  wisedu: '金智教务',
  south_soft: '南软教务',
  chaoxing: '超星',
}

export const isEduSystem = (s: string): s is EduSystemId => s in SYSTEM_LABEL

/** 有专用抓取脚本的系统；其余走页面表格通用解析 */
export const SCRIPTED: ReadonlySet<EduSystemId> = new Set<EduSystemId>(['zhengfang_new'])

const URL_MARKS: [RegExp, EduSystemId][] = [
  [/\/jwglxt\//i, 'zhengfang_new'],
  [/\/jsxsd\//i, 'qiangzhi'],
  [/kingosoft/i, 'kingosoft'],
  [/\/urp\/|\/urpjw\/|urp\./i, 'urp'],
  [/wisedu|\/ehall\/|\.ehall\./i, 'wisedu'],
  [/southsoft|\/njw2017\//i, 'south_soft'],
  [/chaoxing\.com/i, 'chaoxing'],
]

/** 先看地址；地址认不出再看学校索引给的系统类型 */
export function detectSystem(url: string, hint?: EduSystemId | null): EduSystemId | null {
  for (const [re, id] of URL_MARKS) if (re.test(url)) return id
  return hint ?? null
}

/** 当前页是不是课表页：地址里有课表路径，或标题带「课表」 */
export function isTimetablePage(system: EduSystemId | null, url: string, title: string): boolean {
  if (system === 'zhengfang_new') return /kbcx|xskbcx/i.test(url)
  if (/课表|课程表|上课安排/.test(title)) return true
  return /\b(kb|kcb|kebiao|timetable|schedule|xskb|curriculum)\b|kbcx|kcbcx|xskb/i.test(url)
}

/** 地址里的主机名，给地址栏和反馈用 */
export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0]
  }
}

/** 反馈用的页面地址：去掉 query / hash（里面常有会话票据） */
export function scrubUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return url.split(/[?#]/)[0]
  }
}
