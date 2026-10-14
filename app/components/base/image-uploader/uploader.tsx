'use client'

import type { ChangeEvent, FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { imageUpload } from './utils'
import type { ImageFile } from '@/types/app'
import { TransferMethod } from '@/types/app'
import Toast from '@/app/components/base/toast'

type UploaderProps = {
  children: (hovering: boolean) => JSX.Element
  onUpload: (imageFile: ImageFile) => void
  limit?: number
  disabled?: boolean
  enablePaste?: boolean
}

const Uploader: FC<UploaderProps> = ({
  children,
  onUpload,
  limit,
  disabled,
  enablePaste = false,
}) => {
  const [hovering, setHovering] = useState(false)
  const progressTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())
  const { notify } = Toast
  const { t } = useTranslation()

  const stopProgress = (imageId: string) => {
    const timer = progressTimers.current.get(imageId)
    if (timer)
      clearInterval(timer)
    progressTimers.current.delete(imageId)
  }

  useEffect(() => {
    return () => {
      progressTimers.current.forEach(timer => clearInterval(timer))
      progressTimers.current.clear()
    }
  }, [])

  const handleFile = (file: File) => {
    if (limit && file.size > limit * 1024 * 1024) {
      notify({ type: 'error', message: t('common.imageUploader.uploadFromComputerLimit', { size: limit }) })
      return
    }

    const imageFile: ImageFile = {
      type: TransferMethod.local_file,
      _id: `${Date.now()}`,
      fileId: '',
      file,
      url: '',
      progress: 0,
    }
    onUpload(imageFile)
    let simulatedProgress = 0
    let imageWithPreview = imageFile
    const progressTimer = setInterval(() => {
      simulatedProgress = Math.min(simulatedProgress + (simulatedProgress < 70 ? 2 : 1), 92)
      onUpload({ ...imageWithPreview, progress: simulatedProgress })
    }, 250)
    progressTimers.current.set(imageFile._id, progressTimer)

    const reader = new FileReader()
    reader.addEventListener(
      'load',
      () => {
        imageWithPreview = {
          ...imageFile,
          url: reader.result as string,
          base64Url: reader.result as string,
        }
        onUpload(imageWithPreview)
        imageUpload({
          file,
          onProgressCallback: (progress) => {
            simulatedProgress = Math.max(simulatedProgress, Math.min(progress, 92))
            onUpload({ ...imageWithPreview, progress: simulatedProgress })
          },
          onSuccessCallback: (res) => {
            stopProgress(imageFile._id)
            onUpload({ ...imageWithPreview, fileId: res.id, progress: 100 })
          },
          onErrorCallback: () => {
            stopProgress(imageFile._id)
            notify({ type: 'error', message: t('common.imageUploader.uploadFromComputerUploadError') })
            onUpload({ ...imageWithPreview, progress: -1 })
          },
        })
      },
      false,
    )
    reader.addEventListener(
      'error',
      () => {
        stopProgress(imageFile._id)
        notify({ type: 'error', message: t('common.imageUploader.uploadFromComputerReadError') })
        onUpload({ ...imageFile, progress: -1 })
      },
      false,
    )
    reader.readAsDataURL(file)
  }

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file)
      handleFile(file)
  }

  useEffect(() => {
    if (!enablePaste)
      return

    const handlePaste = (e: ClipboardEvent) => {
      if (disabled || e.defaultPrevented)
        return

      const imageFiles = Array.from(e.clipboardData?.items || [])
        .filter(item => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(item.type))
        .map(item => item.getAsFile())
        .filter((file): file is File => file !== null)

      if (!imageFiles.length)
        return

      e.preventDefault()
      imageFiles.forEach(handleFile)
    }

    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [disabled, enablePaste, handleFile])

  return (
    <div
      className='relative'
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {children(hovering)}
      <input
        className={`
          absolute block inset-0 opacity-0 text-[0] w-full
          ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
        `}
        onClick={e => (e.target as HTMLInputElement).value = ''}
        type='file'
        accept='.png, .jpg, .jpeg, .webp, .gif'
        onChange={handleChange}
        disabled={disabled}
      />
    </div>
  )
}

export default Uploader
