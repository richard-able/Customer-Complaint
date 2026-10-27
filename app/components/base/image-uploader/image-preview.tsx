import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import XClose from '@/app/components/base/icons/line/x-close'

type ImagePreviewProps = {
  url: string
  onCancel: () => void
  /** 传多个图片时支持左右切换（url 作为初始展示） */
  urls?: string[]
}
const ImagePreview: FC<ImagePreviewProps> = ({
  url,
  onCancel,
  urls,
}) => {
  const images = (urls && urls.length > 0 ? urls : [url]).filter(Boolean)
  const [currentIndex, setCurrentIndex] = useState(0)
  const safeIndex = Math.min(currentIndex, Math.max(images.length - 1, 0))
  const current = images[safeIndex]

  useEffect(() => {
    setCurrentIndex(0)
  }, [images.length])

  const goPrev = () => setCurrentIndex(index => (index - 1 + images.length) % images.length)
  const goNext = () => setCurrentIndex(index => (index + 1) % images.length)

  return createPortal(
    // 点击遮罩或图片本身都会关闭预览；只有左右切换和关闭按钮阻止冒泡
    <div
      className='fixed inset-0 p-8 flex items-center justify-center bg-black/80 z-[1000] cursor-zoom-out'
      onClick={(event) => {
        event.stopPropagation()
        onCancel()
      }}
    >
      <img
        alt='preview image'
        src={current}
        className='max-w-full max-h-full'
      />
      {images.length > 1 && (
        <>
          <div
            className='absolute left-6 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg bg-white/[0.08] text-xl text-white backdrop-blur-[2px] cursor-pointer'
            onClick={(event) => {
              event.stopPropagation()
              goPrev()
            }}
          >
            ‹
          </div>
          <div
            className='absolute right-6 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg bg-white/[0.08] text-xl text-white backdrop-blur-[2px] cursor-pointer'
            onClick={(event) => {
              event.stopPropagation()
              goNext()
            }}
          >
            ›
          </div>
          <div className='absolute bottom-6 text-xs text-white/80'>{safeIndex + 1} / {images.length}</div>
        </>
      )}
      <div
        className='absolute top-6 right-6 flex items-center justify-center w-8 h-8 bg-white/[0.08] rounded-lg backdrop-blur-[2px] cursor-pointer'
        onClick={(event) => {
          event.stopPropagation()
          onCancel()
        }}
      >
        <XClose className='w-4 h-4 text-white' />
      </div>
    </div>,
    document.body,
  )
}

export default ImagePreview
