import { Capacitor, registerPlugin } from '@capacitor/core'
import type { TaskPhoto } from '../domain/types'
import { uid } from '../domain/store'

/** 拍下或导入的一张照片：path 存进 Task，uri 只用来显示 */
export interface CapturedPhoto {
  path: string
  uri: string
  width: number
  height: number
}

export interface GalleryItem {
  id: string
  thumb: string
  width: number
  height: number
}

export type PermissionStatus = 'granted' | 'denied' | 'prompt'

interface TtCameraPlugin {
  checkPermissions(): Promise<{ camera: PermissionStatus; photos: PermissionStatus }>
  requestPermission(o: { kind: 'camera' | 'photos' }): Promise<{ status: PermissionStatus }>
  start(o: { position: 'back' | 'front'; x: number; y: number; width: number; height: number; delay: number }): Promise<{ position: 'back' | 'front' }>
  freeze(): Promise<{ frozen?: string }>
  stop(): Promise<void>
  switchCamera(): Promise<{ position: 'back' | 'front' }>
  setTorch(o: { on: boolean }): Promise<void>
  setZoom(o: { ratio: number }): Promise<{ ratio: number }>
  capture(): Promise<CapturedPhoto>
  listRecent(o: { limit: number; page: number }): Promise<{ items: GalleryItem[] }>
  importPicked(o: { ids: string[] }): Promise<{ items: CapturedPhoto[] }>
  resolve(o: { path: string }): Promise<{ uri: string }>
  saveToGallery(o: { path: string }): Promise<void>
  deleteFiles(o: { paths: string[] }): Promise<void>
}

const TtCamera = registerPlugin<TtCameraPlugin>('TtCamera')

export const nativeCamera = () => Capacitor.getPlatform() === 'android'

/* ---------------- 浏览器降级：预览走 getUserMedia，照片存成 data URL ---------------- */

const webPhotos = new Map<string, string>()
let webStream: MediaStream | null = null
let webVideo: HTMLVideoElement | null = null
let webFacing: 'back' | 'front' = 'back'

async function webStart(position: 'back' | 'front'): Promise<void> {
  webFacing = position
  webStop()
  webStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: position === 'front' ? 'user' : 'environment' },
    audio: false,
  })
  webVideo = document.createElement('video')
  webVideo.playsInline = true
  webVideo.muted = true
  webVideo.srcObject = webStream
  await webVideo.play()
}

function webStop() {
  webStream?.getTracks().forEach((t) => t.stop())
  webStream = null
  webVideo = null
}

async function webCapture(): Promise<CapturedPhoto> {
  if (!webVideo) throw new Error('not-started')
  const w = webVideo.videoWidth
  const h = webVideo.videoHeight
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')?.drawImage(webVideo, 0, 0, w, h)
  const data = canvas.toDataURL('image/jpeg', 0.9)
  const path = `web/${uid()}.jpg`
  webPhotos.set(path, data)
  return { path, uri: data, width: w, height: h }
}

/** 浏览器里没有相册接口：用文件选择顶上，选中的图直接当结果 */
async function webPick(): Promise<CapturedPhoto[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = async () => {
      const files = input.files ? Array.from(input.files) : []
      const out: CapturedPhoto[] = []
      for (const f of files) {
        const data = await new Promise<string>((ok) => {
          const r = new FileReader()
          r.onload = () => ok(String(r.result))
          r.readAsDataURL(f)
        })
        const size = await new Promise<[number, number]>((ok) => {
          const img = new Image()
          img.onload = () => ok([img.naturalWidth, img.naturalHeight])
          img.onerror = () => ok([0, 0])
          img.src = data
        })
        const path = `web/${uid()}.jpg`
        webPhotos.set(path, data)
        out.push({ path, uri: data, width: size[0], height: size[1] })
      }
      resolve(out)
    }
    input.click()
  })
}

/* ---------------- 对外接口 ---------------- */

export const camera = {
  async permissions() {
    if (!nativeCamera()) {
      return { camera: 'granted' as PermissionStatus, photos: 'granted' as PermissionStatus }
    }
    return TtCamera.checkPermissions()
  },

  async request(kind: 'camera' | 'photos'): Promise<PermissionStatus> {
    if (!nativeCamera()) return 'granted'
    try {
      const r = await TtCamera.requestPermission({ kind })
      return r.status
    } catch {
      return 'denied'
    }
  },

  /** rect 是取景区在页面里的位置：原生预览叠在这块上方；delay 后才淡入（等页面推入动画走完） */
  async start(position: 'back' | 'front', rect: { x: number; y: number; width: number; height: number }, delay = 0) {
    if (!nativeCamera()) return webStart(position).then(() => undefined)
    await TtCamera.start({ position, ...rect, delay })
  },

  /**
   * 定格：预览立刻静止，最后一帧以 data URL 返回，页面填在取景框里；
   * 原生层还在，等页面画好后再 stop()，接缝上不会露出空洞。
   */
  async freeze(): Promise<string | null> {
    if (!nativeCamera()) {
      if (!webVideo || !webVideo.videoWidth) return null
      const w = 720
      const h = Math.round(webVideo.videoHeight * (w / webVideo.videoWidth))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')?.drawImage(webVideo, 0, 0, w, h)
      webStop()
      return canvas.toDataURL('image/jpeg', 0.8)
    }
    const r = await TtCamera.freeze()
    return r?.frozen ?? null
  },

  /** 撤掉预览层 */
  async stop(): Promise<void> {
    if (!nativeCamera()) {
      webStop()
      return
    }
    await TtCamera.stop()
  },

  async switchCamera(): Promise<'back' | 'front'> {
    if (!nativeCamera()) {
      const next = webFacing === 'back' ? 'front' : 'back'
      await webStart(next)
      return next
    }
    const r = await TtCamera.switchCamera()
    return r.position
  },

  async torch(on: boolean) {
    if (!nativeCamera()) return
    await TtCamera.setTorch({ on })
  },

  /** 双指缩放：返回实际生效的倍率（浏览器里用 CSS 放大预览顶上，最大 4x） */
  async zoom(ratio: number): Promise<number> {
    if (!nativeCamera()) {
      const r = Math.max(1, Math.min(4, ratio))
      if (webVideo) webVideo.style.transform = `scale(${r})`
      return r
    }
    const r = await TtCamera.setZoom({ ratio })
    return r.ratio
  },

  async capture(): Promise<CapturedPhoto> {
    if (!nativeCamera()) return webCapture()
    return TtCamera.capture()
  },

  /** 浏览器里返回空列表，由 pick() 走系统文件选择 */
  async listRecent(page = 0, limit = 60): Promise<GalleryItem[]> {
    if (!nativeCamera()) return []
    try {
      const r = await TtCamera.listRecent({ limit, page })
      return r.items
    } catch {
      return []
    }
  },

  async importPicked(ids: string[]): Promise<CapturedPhoto[]> {
    if (!nativeCamera()) return webPick()
    const r = await TtCamera.importPicked({ ids })
    return r.items
  },

  async pick(): Promise<CapturedPhoto[]> {
    return webPick()
  },

  /** 浏览器降级时的预览元素：相机页把它挂进取景框 */
  webPreview(): HTMLVideoElement | null {
    return webVideo
  },

  /** 存到系统相册；浏览器里直接下载 */
  async save(path: string): Promise<boolean> {
    if (!nativeCamera()) {
      const src = photoSrc(path)
      if (!src) return false
      const a = document.createElement('a')
      a.href = src
      a.download = `${path.split('/').pop() ?? 'photo'}`
      a.click()
      return true
    }
    try {
      await TtCamera.saveToGallery({ path })
      return true
    } catch {
      return false
    }
  },

  async remove(paths: string[]) {
    for (const p of paths) webPhotos.delete(p)
    if (!nativeCamera()) return
    try {
      await TtCamera.deleteFiles({ paths })
    } catch {
      // 文件可能已经不在，忽略
    }
  },
}

const srcCache = new Map<string, string>()

/** 相对路径转 <img src>；原生下第一次要问一次插件 */
export function photoSrc(path: string): string {
  if (path.startsWith('data:')) return path
  const web = webPhotos.get(path)
  if (web) return web
  return srcCache.get(path) ?? ''
}

export async function loadPhotoSrc(path: string): Promise<string> {
  const cached = photoSrc(path)
  if (cached) return cached
  if (!nativeCamera()) return ''
  try {
    const r = await TtCamera.resolve({ path })
    const src = r.uri ? Capacitor.convertFileSrc(r.uri) : ''
    if (src) srcCache.set(path, src)
    return src
  } catch {
    return ''
  }
}

export function rememberPhoto(p: CapturedPhoto): TaskPhoto {
  if (nativeCamera() && p.uri) srcCache.set(p.path, Capacitor.convertFileSrc(p.uri))
  return { id: uid(), path: p.path, w: p.width, h: p.height, takenAt: Date.now() }
}
