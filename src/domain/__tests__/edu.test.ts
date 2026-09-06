import { describe, expect, it } from 'vitest'
import { guessTerm, parseJcs, parseZfKbList, termLabel, zcdToWeeks } from '../edu/zhengfang'
import { detectSystem, hostOf, isTimetablePage, scrubUrl } from '../edu/systems'
import { schoolByUrl, schoolCount, searchSchools, urlFromQuery } from '../edu/schools'
import { wrapRun, zfTermOptions } from '../edu/scripts'
import { isNewer, issueUrl } from '../edu/release'
import { parseHtml } from '../importers/html'

describe('正方新版课表解析', () => {
  it('周次串逐段解析，单双周只作用于本段', () => {
    expect(zcdToWeeks('1-16周').weeks).toBe('1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16')
    expect(zcdToWeeks('1-8周(单)').weeks).toBe('1,3,5,7')
    expect(zcdToWeeks('2-8周(双),9-12周').weeks).toBe('2,4,6,8,9,10,11,12')
    expect(zcdToWeeks('1,3,5-7周').weeks).toBe('1,3,5,6,7')
  })

  it('节次串支持 3-4 / 0304 / 5', () => {
    expect(parseJcs('3-4')).toEqual([3, 4])
    expect(parseJcs('0304')).toEqual([3, 4])
    expect(parseJcs('5')).toEqual([5, 5])
    expect(parseJcs('11-13')).toEqual([11, 13])
    expect(parseJcs('x')).toBeNull()
  })

  it('kbList → 规则输出，坏行进诊断不进课程', () => {
    const out = parseZfKbList({
      kbList: [
        { kcmc: '高等数学', xm: '张三', cdmc: '教 101', xqj: '1', jcs: '1-2', zcd: '1-16周' },
        { kcmc: '体育', xm: '', cdmc: '操场', xqj: '3', jcs: '7-8', zcd: '1-8周(单),10-16周' },
        { kcmc: '', xqj: '2', jcs: '3-4', zcd: '1-16周' },
        { kcmc: '坏星期', xqj: '9', jcs: '3-4', zcd: '1-16周' },
      ],
      xsxx: { XM: '不应出现' },
    })
    expect(out.courses).toHaveLength(2)
    expect(out.courses[0]).toMatchObject({ name: '高等数学', teacher: '张三', location: '教 101', weekday: 1, startPeriod: 1, endPeriod: 2 })
    expect(out.courses[1]).toMatchObject({ name: '体育', weekday: 3, startPeriod: 7, endPeriod: 8, weeks: '1,3,5,7,10,11,12,13,14,15,16' })
    expect(out.courses[1].teacher).toBeUndefined()
    expect(out.diagnostics.map((d) => d.code)).toEqual(['EMPTY_NAME', 'BAD_WEEKDAY'])
    expect(JSON.stringify(out)).not.toContain('不应出现')
    expect(out.timeGrid).toBeUndefined()
  })

  it('空列表给一条错误诊断', () => {
    const out = parseZfKbList({ kbList: [] })
    expect(out.courses).toHaveLength(0)
    expect(out.diagnostics[0].code).toBe('EMPTY')
  })

  it('学期文案与猜测', () => {
    expect(termLabel({ xnm: '2025', xqm: '3' })).toBe('2025–2026 学年 第 1 学期')
    expect(termLabel({ xnm: '2025', xqm: '12' })).toBe('2025–2026 学年 第 2 学期')
    expect(guessTerm(new Date(2026, 8, 6))).toEqual({ xnm: '2026', xqm: '3' })
    expect(guessTerm(new Date(2026, 2, 1))).toEqual({ xnm: '2025', xqm: '12' })
    expect(guessTerm(new Date(2026, 0, 10))).toEqual({ xnm: '2025', xqm: '3' })
  })

  it('课表页下拉 → 当前与上一学年的学期', () => {
    const opts = zfTermOptions({ xnm: ['2023', '2024', '2025', '2026'], xqm: ['3', '12', '16'], sel: { xnm: '2025', xqm: '3' } })
    expect(opts).toEqual([
      { xnm: '2025', xqm: '3' }, { xnm: '2025', xqm: '12' }, { xnm: '2025', xqm: '16' },
      { xnm: '2024', xqm: '3' }, { xnm: '2024', xqm: '12' }, { xnm: '2024', xqm: '16' },
    ])
  })
})

describe('教务系统指纹', () => {
  it('按地址认系统', () => {
    expect(detectSystem('https://jwglxt.sdu.edu.cn/jwglxt/xtgl/index_initMenu.html')).toBe('zhengfang_new')
    expect(detectSystem('http://jwxt.xxx.edu.cn/jsxsd/framework/xsMain.jsp')).toBe('qiangzhi')
    expect(detectSystem('http://jw.xxx.edu.cn/', 'urp')).toBe('urp')
    expect(detectSystem('http://jw.xxx.edu.cn/')).toBeNull()
  })

  it('课表页判断', () => {
    expect(isTimetablePage('zhengfang_new', 'https://x/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default', '')).toBe(true)
    expect(isTimetablePage('zhengfang_new', 'https://x/jwglxt/xtgl/index_initMenu.html', '课表')).toBe(false)
    expect(isTimetablePage('qiangzhi', 'http://x/jsxsd/xskb/xskb_list.do', '学生个人课表')).toBe(true)
    expect(isTimetablePage(null, 'http://x/login', '统一身份认证')).toBe(false)
  })

  it('地址脱敏只留主机和路径', () => {
    expect(scrubUrl('https://jw.x.edu.cn/jwglxt/kbcx/a.html?gnmkdm=N2151&su=2021001#x')).toBe('https://jw.x.edu.cn/jwglxt/kbcx/a.html')
    expect(hostOf('https://jw.x.edu.cn/a/b')).toBe('jw.x.edu.cn')
  })
})

describe('学校索引', () => {
  it('内置索引非空，可按名字与网址搜索', () => {
    expect(schoolCount()).toBeGreaterThan(1000)
    const r = searchSchools('山东大学')
    expect(r[0].name).toBe('山东大学')
    expect(r[0].url).toMatch(/^https?:\/\//)
    expect(searchSchools('sdu.edu.cn').length).toBeGreaterThan(0)
    expect(searchSchools('')).toEqual([])
  })

  it('输入网址时补协议；同主机可回查学校', () => {
    expect(urlFromQuery('jwglxt.sdu.edu.cn/jwglxt')).toBe('http://jwglxt.sdu.edu.cn/jwglxt')
    expect(urlFromQuery('https://a.b.edu.cn')).toBe('https://a.b.edu.cn')
    expect(urlFromQuery('山东')).toBeNull()
    const s = searchSchools('浙江大学')[0]
    expect(schoolByUrl(s.url)?.name).toBe('浙江大学')
  })
})

describe('注入脚本包装', () => {
  it('结果经 TtBridge.post 回传，带 id', async () => {
    const posted: string[] = []
    const g = globalThis as unknown as { TtBridge?: { post: (s: string) => void } }
    g.TtBridge = { post: (s) => posted.push(s) }
    try {
      new Function(wrapRun('r1', 'return 1 + 1;'))()
      new Function(wrapRun('r2', 'throw new Error("boom");'))()
      await new Promise((r) => setTimeout(r, 0))
    } finally {
      delete g.TtBridge
    }
    expect(posted.map((s) => JSON.parse(s))).toEqual([
      { id: 'r1', ok: true, r: 2 },
      { id: 'r2', ok: false, e: 'boom' },
    ])
  })
})

describe('未识别页出口', () => {
  it('版本比较：只认数字段，前缀 v 可有可无', () => {
    expect(isNewer('v1.4.56', '1.4.55')).toBe(true)
    expect(isNewer('1.5', '1.4.55')).toBe(true)
    expect(isNewer('1.4.55', '1.4.55')).toBe(false)
    expect(isNewer('1.4.9', 'v1.4.55')).toBe(false)
    expect(isNewer('nightly', '1.4.55')).toBe(false)
    expect(isNewer('1.5.0', '')).toBe(false)
  })

  it('反馈链接只带脱敏地址、系统猜测、版本号', () => {
    const u = new URL(issueUrl({ url: 'http://jw.x.edu.cn/kbcx/list.jsp?JSESSIONID=abc&xh=2021001', system: 'zhengfang_new', version: '1.4.55' }))
    expect(u.pathname).toBe('/shuakami/timetable/issues/new')
    const body = u.searchParams.get('body') ?? ''
    expect(body).toContain('http://jw.x.edu.cn/kbcx/list.jsp')
    expect(body).not.toContain('JSESSIONID')
    expect(body).not.toContain('2021001')
    expect(body).toContain('正方教务')
    expect(body).toContain('1.4.55')
  })
})

describe('非正方系统兜底：页面表格通用解析', () => {
  it('课表网格 HTML 能解出课程', () => {
    const html = `<html><body><table>
      <tr><th>节次</th><th>星期一</th><th>星期二</th><th>星期三</th><th>星期四</th><th>星期五</th></tr>
      <tr><td>1-2</td><td>高等数学<br>1-16周<br>教一 201<br>张三</td><td></td><td>大学英语<br>1-8周(单)<br>外语楼 305</td><td></td><td></td></tr>
      <tr><td>3-4</td><td></td><td>程序设计<br>3-18周<br>信息楼 A102</td><td></td><td></td><td></td></tr>
    </table></body></html>`
    const out = parseHtml(html, { mode: 'grid' })
    expect(out.courses.map((c) => [c.name, c.weekday, c.startPeriod, c.endPeriod, c.weeks, c.location])).toEqual([
      ['高等数学', 1, 1, 2, '1-16', '教一 201'],
      ['大学英语', 3, 1, 2, '1-8单', '外语楼 305'],
      ['程序设计', 2, 3, 4, '3-18', '信息楼 A102'],
    ])
  })

  it('登录页没有课表表格 → 无课程，进未识别', () => {
    const out = parseHtml('<html><body><form><input name="u"><input name="p"></form></body></html>', { mode: 'grid' })
    expect(out.courses).toHaveLength(0)
    expect(out.diagnostics[0].code).toBe('NO_TABLE')
  })
})
