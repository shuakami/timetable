import { useEffect } from 'react'
import { useMotionValue, type MotionValue } from 'motion/react'

/**
 * 键盘跟随（页面侧）。原生 ImeFollow 逐帧喂进「键盘露出 WebView 底边多少 CSS px」；
 * WebView 本身会在弹出动画结束那一帧被压短（收起时则在第一帧放回全高），
 * 所以要跟着键盘走的元素只平移「键盘高度里 WebView 还没让出来的那部分」：
 *   offset = kb - (fullHeight - innerHeight)
 * 弹出过程 WebView 全高 ⇒ offset 就是键盘高度；压短那一帧 offset 归零，元素在屏幕上位置不变。
 */
type Listener = (offset: number) => void

let kb = 0
let fullH = typeof window === 'undefined' ? 0 : window.innerHeight
const listeners = new Set<Listener>()

const offset = () => Math.max(0, kb - Math.max(0, fullH - window.innerHeight))
const emit = () => { const o = offset(); listeners.forEach((l) => l(o)) }

if (typeof window !== 'undefined') {
  const w = window as Window & { __ttIme?: (kb: number) => void }
  w.__ttIme = (v) => { kb = v; emit() }
  window.addEventListener('resize', () => {
    if (kb === 0) fullH = window.innerHeight
    emit()
  })
}

/** 当前键盘相对 WebView 底边露出的高度（CSS px） */
export const imeHeight = () => kb

/** 返回跟随键盘的 y（负值，往上），挂到要贴着键盘的元素 style.y 上 */
export function useImeY(): MotionValue<number> {
  const y = useMotionValue(-offset())
  useEffect(() => {
    const l: Listener = (o) => y.set(-o)
    listeners.add(l)
    l(offset())
    return () => { listeners.delete(l) }
  }, [y])
  return y
}
