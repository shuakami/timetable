import { describe, expect, it } from 'vitest'
import type { Semester } from '../types'
import { detectDelimiter, parseCsv, parseCsvRows } from '../importer'
import { parseIcs, parseIcsDt, parseIcsEvents } from '../importers/ics'
import { parseHtml } from '../importers/html'

const MAP = { name: 0, teacher: 1, location: 2, weekday: 3, periods: 4, weeks: 5, skipRows: 1 }

describe('CSV：RFC 4180', () => {
  it('引号里的分隔符、换行、"" 转义；CRLF', () => {
    const rows = parseCsvRows('a,"b,c","say ""hi""","x\ny"\r\n1,2,3,4\r\n', ',')
    expect(rows).toEqual([
      { cells: ['a', 'b,c', 'say "hi"', 'x\ny'], line: 1 },
      { cells: ['1', '2', '3', '4'], line: 3 },
    ])
  })
  it('空行跳过，行号按原文', () => {
    const rows = parseCsvRows('a\n\n\nb\rc', ',')
    expect(rows.map((r) => [r.cells[0], r.line])).toEqual([['a', 1], ['b', 4], ['c', 5]])
  })
  it('分隔符自动识别：Tab / 分号 / 逗号', () => {
    expect(detectDelimiter('课程\t教师\t星期')).toBe('\t')
    expect(detectDelimiter('课程;教师;星期')).toBe(';')
    expect(detectDelimiter('课程,教师,星期')).toBe(',')
    expect(detectDelimiter('只有一列')).toBe(',')
  })
  it('BOM、分号分隔、地点里带逗号、诊断行号是原文行号', () => {
    const csv = '\uFEFF课程;教师;地点;星期;节次;周次\r\n"高等数学";王立群;"教三,302";周一;1-2;1-16\r\n\r\n坏行;;;周八;1-2;1-16\r\n'
    const out = parseCsv(csv, MAP)
    expect(out.courses).toHaveLength(1)
    expect(out.courses[0]).toMatchObject({ name: '高等数学', location: '教三,302', weekday: 1 })
    expect(out.diagnostics).toHaveLength(1)
    expect(out.diagnostics[0].at?.row).toBe(4)
  })
  it('显式 delimiter 优先于自动识别', () => {
    const out = parseCsv('课程|教师|地点|星期|节次|周次\n高数,上|王|教一|一|1-2|1-4', { ...MAP, delimiter: '|' })
    expect(out.courses[0]).toMatchObject({ name: '高数,上', teacher: '王' })
  })
  it('引号字段内的换行不算新行', () => {
    const out = parseCsv('课程,教师,地点,星期,节次,周次\n"高等\n数学",王,教一,一,1-2,1-4\n英语,陈,外语楼,二,3-4,1-4', MAP)
    expect(out.courses.map((c) => c.name)).toEqual(['高等\n数学', '英语'])
  })
})

const sem: Semester = {
  id: 's1', name: '秋', startDate: '2026-08-31', totalWeeks: 16,
  timeGrid: [
    { index: 1, start: 480, end: 525 },
    { index: 2, start: 535, end: 580 },
    { index: 3, start: 600, end: 645 },
    { index: 4, start: 655, end: 700 },
  ],
  vacations: [], examWeeks: [],
}
const vevent = (dt: string, dtend: string, extra = '') =>
  `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:高数\r\n${dt}\r\n${dtend}\r\n${extra}END:VEVENT\r\nEND:VCALENDAR\r\n`

describe('ICS：时区策略（测试环境为 UTC）', () => {
  it('浮动时间按墙钟', () => {
    expect(parseIcsDt('20260831T080000')).toEqual({ date: '2026-08-31', minutes: 480 })
    expect(parseIcsDt('20260831')).toEqual({ date: '2026-08-31', minutes: 0 })
  })
  it('Z 是 UTC，换算到设备时区，可能跨日', () => {
    expect(parseIcsDt('20260831T080000Z')).toEqual({ date: '2026-08-31', minutes: 480 })
    expect(parseIcsDt('20260831T000000Z', undefined)).toEqual({ date: '2026-08-31', minutes: 0 })
  })
  it('TZID=Asia/Shanghai 08:00 在 UTC 设备上是前一天 00:00', () => {
    expect(parseIcsDt('20260831T080000', 'Asia/Shanghai')).toEqual({ date: '2026-08-31', minutes: 0 })
    expect(parseIcsDt('20260831T060000', 'Asia/Shanghai')).toEqual({ date: '2026-08-30', minutes: 22 * 60 })
  })
  it('TZID 等于设备时区或不认识：按墙钟', () => {
    expect(parseIcsDt('20260831T080000', 'UTC')).toEqual({ date: '2026-08-31', minutes: 480 })
    expect(parseIcsDt('20260831T080000', 'China Standard Time')).toEqual({ date: '2026-08-31', minutes: 480 })
  })
  it('DTSTART 的 TZID 参数被读到并传给解析；EXDATE 同理', () => {
    const [ev] = parseIcsEvents(vevent('DTSTART;TZID=Asia/Shanghai:20260831T160000', 'DTEND;TZID=Asia/Shanghai:20260831T174500', 'EXDATE;TZID=Asia/Shanghai:20260907T160000\r\n'))
    expect(ev.dtstartTz).toBe('Asia/Shanghai')
    expect(ev.exdate).toEqual([{ v: '20260907T160000', tzid: 'Asia/Shanghai' }])
  })
  it('上海 16:00 的课在 UTC 设备上是 08:00 → 第 1-2 节；EXDATE 挖掉第 2 周', () => {
    const out = parseIcs(vevent(
      'DTSTART;TZID=Asia/Shanghai:20260831T160000', 'DTEND;TZID=Asia/Shanghai:20260831T174000',
      'RRULE:FREQ=WEEKLY;COUNT=4\r\nEXDATE;TZID=Asia/Shanghai:20260907T160000\r\n',
    ), sem)
    expect(out.diagnostics).toHaveLength(0)
    expect(out.courses[0]).toMatchObject({ weekday: 1, startPeriod: 1, endPeriod: 2, weeks: '1,3,4' })
  })
  it('UTC 事件跨日：周一 UTC 23:00 之后在东八区是周二，但 UTC 设备上仍是周一', () => {
    const out = parseIcs(vevent('DTSTART:20260831T080000Z', 'DTEND:20260831T094000Z'), sem)
    expect(out.courses[0]).toMatchObject({ weekday: 1, startPeriod: 1, endPeriod: 2 })
  })
})

describe('HTML 表格模式', () => {
  it('一行一课的列表页，rowspan/空行/嵌套标签', () => {
    const html = `<table class="kb">
      <thead><tr><th>课程</th><th>教师</th><th>地点</th><th>星期</th><th>节次</th><th>周次</th></tr></thead>
      <tbody>
        <tr><td><a href="#">高等数学</a></td><td>王立群&nbsp;13800138000</td><td>教三 302</td><td>星期一</td><td>1-2节</td><td>1-16周</td></tr>
        <tr><td>大学英语</td><td>陈晓</td><td>外语楼 105</td><td>周二</td><td>第3-4节</td><td>1-8周(单)</td></tr>
        <tr><td></td><td></td><td></td><td></td><td></td><td></td></tr>
        <tr><td>坏行</td><td></td><td></td><td>周八</td><td>1-2</td><td>1-16</td></tr>
      </tbody>
    </table>`
    const out = parseHtml(html, { mode: 'table', mapping: { name: 0, teacher: 1, location: 2, weekday: 3, periods: 4, weeks: 5, skipRows: 1 } })
    expect(out.courses.map((c) => [c.name, c.teacher, c.teacherPhone, c.weekday, c.startPeriod, c.endPeriod])).toEqual([
      ['高等数学', '王立群 13800138000', '13800138000', 1, 1, 2],
      ['大学英语', '陈晓', undefined, 2, 3, 4],
    ])
    expect(out.diagnostics.map((d) => d.code)).toEqual(['UNPARSED_WEEKDAY'])
  })
  it('网格模式：同一格两门课、rowspan 跨两行合并节次', () => {
    const html = `<table>
      <tr><th>节次</th><th>周一</th><th>周二</th></tr>
      <tr><td>1</td><td rowspan="2">高等数学<br>1-16周<br>教一 201<br>张三</td><td>体育<br>1-8周<br>操场<br><br>形势与政策<br>9-16周<br>报告厅</td></tr>
      <tr><td>2</td><td></td></tr>
    </table>`
    const out = parseHtml(html, { mode: 'grid' })
    expect(out.courses.map((c) => [c.name, c.weekday, c.startPeriod, c.endPeriod, c.weeks])).toEqual([
      ['高等数学', 1, 1, 2, '1-16'],
      ['体育', 2, 1, 1, '1-8'],
      ['形势与政策', 2, 1, 1, '9-16'],
    ])
  })
})
