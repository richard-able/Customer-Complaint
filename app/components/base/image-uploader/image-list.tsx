import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading02 from '@/app/components/base/icons/line/loading-02'
import XClose from '@/app/components/base/icons/line/x-close'
import RefreshCcw01 from '@/app/components/base/icons/line/refresh-ccw-01'
import AlertTriangle from '@/app/components/base/icons/solid/alert-triangle'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import type { ImageFile } from '@/types/app'
import { TransferMethod } from '@/types/app'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'

type ImageListProps = {
  list: ImageFile[]
  readonly?: boolean
  onRemove?: (imageFileId: string) => void
  onReUpload?: (imageFileId: string) => void
  onImageLinkLoadSuccess?: (imageFileId: string) => void
  onImageLinkLoadError?: (imageFileId: string) => void
}

const ImageList: FC<ImageListProps> = ({
  list,
  readonly,
  onRemove,
  onReUpload,
  onImageLinkLoadSuccess,
  onImageLinkLoadError,
}) => {
  const { t } = useTranslation()
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')

  const handleImageLinkLoadSuccess = (item: ImageFile) => {
    if (item.type === TransferMethod.remote_url && onImageLinkLoadSuccess && item.progress !== -1)
      onImageLinkLoadSuccess(item._id)
  }
  const handleImageLinkLoadError = (item: ImageFile) => {
    if (item.type === TransferMethod.remote_url && onImageLinkLoadError)
      onImageLinkLoadError(item._id)
  }

  return (
    <div className='flex flex-wrap'>
      {
        list.map(item => (
          <div
            key={item._id}
            className='group relative mr-1 border-[0.5px] border-black/5 rounded-lg'
          >
            {
              item.type === TransferMethod.local_file && item.progress !== 100 && (
                <div className='absolute inset-0 z-[1] flex flex-col items-center justify-center gap-1 rounded-lg bg-gray-200/95 text-gray-600' role='status' aria-live='polite'>
                  {
                    item.progress === -1
                      ? <RefreshCcw01 className='w-5 h-5 cursor-pointer' onClick={() => onReUpload && onReUpload(item._id)} />
                      : (
                        <>
                          <Loading02 className='w-5 h-5 animate-spin' />
                          <span className='text-[10px] font-medium'>{t('common.imageUploader.uploading', { progress: item.progress })}</span>
                          <div className='h-1 w-10 overflow-hidden rounded-full bg-gray-300'>
                            <div className='h-full rounded-full bg-blue-600 transition-all duration-300' style={{ width: `${item.progress}%` }} />
                          </div>
                        </>
                      )
                  }
                </div>
              )
            }
            {
              item.type === TransferMethod.remote_url && item.progress !== 100 && (
                <div className={`
                  absolute inset-0 flex items-center justify-center rounded-lg z-[1] border
                  ${item.progress === -1 ? 'bg-[#FEF0C7] border-[#DC6803]' : 'bg-gray-200/95 border-transparent'}
                `}>
                  {
                    item.progress > -1 && (
                      <Loading02 className='animate-spin w-5 h-5 text-gray-600' />
                    )
                  }
                  {
                    item.progress === -1 && (
                      <TooltipPlus popupContent={t('common.imageUploader.pasteImageLinkInvalid')}>
                        <AlertTriangle className='w-4 h-4 text-[#DC6803]' />
                      </TooltipPlus>
                    )
                  }
                </div>
              )
            }
            <img
              className='w-16 h-16 rounded-lg object-cover cursor-pointer border-[0.5px] border-black/5'
              alt=''
              onLoad={() => handleImageLinkLoadSuccess(item)}
              onError={() => handleImageLinkLoadError(item)}
              src={item.type === TransferMethod.remote_url ? item.url : item.base64Url}
              onClick={() => item.progress === 100 && setImagePreviewUrl((item.type === TransferMethod.remote_url ? item.url : item.base64Url) as string)}
            />
            {
              !readonly && (
                <div
                  className={`
                    absolute z-10 -top-[9px] -right-[9px] items-center justify-center w-[18px] h-[18px] 
                    bg-white hover:bg-gray-50 border-[0.5px] border-black/[0.02] rounded-2xl shadow-lg
                    cursor-pointer
                    ${item.progress === -1 ? 'flex' : 'hidden group-hover:flex'}
                  `}
                  onClick={() => onRemove && onRemove(item._id)}
                >
                  <XClose className='w-3 h-3 text-gray-500' />
                </div>
              )
            }
          </div>
        ))
      }
      {
        imagePreviewUrl && (
          <ImagePreview
            url={imagePreviewUrl}
            onCancel={() => setImagePreviewUrl('')}
          />
        )
      }
    </div>
  )
}

export default ImageList
