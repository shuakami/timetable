import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { STICKER_IDS, stickerOf } from '../stickers'

describe('stickerOf', () => {
  it('课表里常见课名都能落到合理的贴纸', () => {
    expect(stickerOf('python程序设计')).toBe('python')
    expect(stickerOf('Web前端应用开发I')).toBe('html5')
    expect(stickerOf('信息数学基础AI')).toBe('math-calc')
    expect(stickerOf('大学语文BⅡ')).toBe('chinese')
    expect(stickerOf('思想道德与法治')).toBe('party')
    expect(stickerOf('职业生涯规划与就业指导Ⅰ')).toBe('career')
    expect(stickerOf('中华民族共同体概论')).toBe('history-cn')
    expect(stickerOf('党史')).toBe('party')
    expect(stickerOf('艺术欣赏')).toBe('art')
    expect(stickerOf('人工智能通识')).toBe('ai')
    expect(stickerOf('体育I(民族传统体育)')).toBe('sport-martial')
    expect(stickerOf('职场通用英语DⅠ')).toBe('english')
    expect(stickerOf('大学生心理健康教育')).toBe('psychology')
    expect(stickerOf('军事理论')).toBe('military')
    expect(stickerOf('信息技术A')).toBe('office')
    expect(stickerOf('创新创业I')).toBe('innovation')
  })

  it('编程语言按更具体的优先，英文整词命中', () => {
    expect(stickerOf('C++程序设计')).toBe('cplusplus')
    expect(stickerOf('C语言程序设计')).toBe('c')
    expect(stickerOf('JavaScript 高级编程')).toBe('javascript')
    expect(stickerOf('Java面向对象程序设计')).toBe('java')
    expect(stickerOf('区块链原理（chain）')).toBe('crypto')
    expect(stickerOf('数据库原理与 MySQL 应用')).toBe('mysql')
    expect(stickerOf('高等数学A')).toBe('math-calc')
    expect(stickerOf('机械设计基础')).toBe('mechanical')
    expect(stickerOf('物流管理')).toBe('logistics')
    expect(stickerOf('教学法')).toBe('teacher')
  })

  it('匹配不到返回 null', () => {
    expect(stickerOf('')).toBeNull()
    expect(stickerOf('周三下午')).toBeNull()
  })

  it('清单里每个 id 都有对应 SVG，且不重复', () => {
    const files = new Set(readdirSync(join(__dirname, '../../../public/stickers')).map((f) => f.replace(/\.svg$/, '')))
    for (const id of STICKER_IDS) expect(files.has(id), id).toBe(true)
    expect(new Set(STICKER_IDS).size).toBe(STICKER_IDS.length)
    expect(STICKER_IDS.length).toBeGreaterThanOrEqual(300)
  })
})
