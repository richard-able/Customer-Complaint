'use client'

import { upload } from '@/service/base'

// Vercel Functions reject request bodies larger than 4.5 MB. Leave room for
// multipart/form-data metadata so uploads can safely pass through our API route.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

const loadImage = (file: File) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  const objectUrl = URL.createObjectURL(file)
  image.onload = () => {
    URL.revokeObjectURL(objectUrl)
    resolve(image)
  }
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl)
    reject(new Error('Unable to read image'))
  }
  image.src = objectUrl
})

const canvasToBlob = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('Unable to compress image')),
    'image/webp',
    quality,
  )
})

const prepareImageForUpload = async (file: File) => {
  if (file.size <= MAX_UPLOAD_BYTES)
    return file

  const image = await loadImage(file)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context)
    throw new Error('Canvas is unavailable')

  let width = image.naturalWidth
  let height = image.naturalHeight
  const maxDimension = 4096
  const initialScale = Math.min(1, maxDimension / Math.max(width, height))
  width = Math.max(1, Math.round(width * initialScale))
  height = Math.max(1, Math.round(height * initialScale))

  let blob: Blob | undefined
  for (let attempt = 0; attempt < 6; attempt++) {
    canvas.width = width
    canvas.height = height
    context.clearRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    blob = await canvasToBlob(canvas, Math.max(0.55, 0.88 - attempt * 0.07))
    if (blob.size <= MAX_UPLOAD_BYTES)
      break
    width = Math.max(1, Math.round(width * 0.82))
    height = Math.max(1, Math.round(height * 0.82))
  }

  if (!blob || blob.size > MAX_UPLOAD_BYTES)
    throw new Error('Image is too large after compression')

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'image'
  return new File([blob], `${baseName}.webp`, {
    type: blob.type,
    lastModified: file.lastModified,
  })
}

type ImageUploadParams = {
  file: File
  onProgressCallback: (progress: number) => void
  onSuccessCallback: (res: { id: string }) => void
  onErrorCallback: () => void
}
type ImageUpload = (v: ImageUploadParams) => void
export const imageUpload: ImageUpload = ({
  file,
  onProgressCallback,
  onSuccessCallback,
  onErrorCallback,
}) => {
  const onProgress = (e: ProgressEvent) => {
    if (e.lengthComputable) {
      const percent = Math.floor(e.loaded / e.total * 100)
      onProgressCallback(percent)
    }
  }

  prepareImageForUpload(file)
    .then((uploadFile) => {
      const formData = new FormData()
      formData.append('file', uploadFile)
      return upload({
        xhr: new XMLHttpRequest(),
        data: formData,
        onprogress: onProgress,
      })
    })
    .then((res: { id: string }) => {
      onSuccessCallback(res)
    })
    .catch(() => {
      onErrorCallback()
    })
}
