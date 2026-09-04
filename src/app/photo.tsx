import { useEffect, useState } from 'react'
import { loadPhotoSrc, photoSrc } from './camera'

/** 待办照片：路径异步转成可显示的地址，文件不在时留占位 */
export function TaskPhotoImg({ path, className = '', alt = '' }: { path: string; className?: string; alt?: string }) {
  const [src, setSrc] = useState(() => photoSrc(path))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setSrc(photoSrc(path))
    void loadPhotoSrc(path).then((s) => {
      if (alive && s) setSrc(s)
      else if (alive && !s) setFailed(true)
    })
    return () => {
      alive = false
    }
  }, [path])

  if (!src || failed) {
    return (
      <span className={`flex items-center justify-center bg-(--c-surface2) ${className}`}>
        <svg viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink5)' }} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="m3 16 5-4 4 3 3-2 6 4" />
        </svg>
      </span>
    )
  }
  return <img src={src} alt={alt} onError={() => setFailed(true)} className={`object-cover ${className}`} />
}
