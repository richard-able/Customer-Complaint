'use client'
import type { FC } from 'react'
import React, { useRef, useState } from 'react'
import {
  PlayIcon,
} from '@heroicons/react/24/solid'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import Button from '@/app/components/base/button'
import Loading02 from '@/app/components/base/icons/line/loading-02'
import Download02 from '@/app/components/base/icons/solid/download-02'
import { parseXlsx } from './parse-xlsx'
import type { EmbeddedImagesByCell } from './parse-xlsx'
import Toast from '@/app/components/base/toast'
import { API_PREFIX } from '@/config'
export type IRunBatchProps = {
  onSend: (data: string[][], embeddedImages: EmbeddedImagesByCell) => void
  isAllFinished: boolean
  isPreparingImages: boolean
}

const RunBatch: FC<IRunBatchProps> = ({
  onSend,
  isAllFinished,
  isPreparingImages,
}) => {
  const { t } = useTranslation()
  const excelInputRef = useRef<HTMLInputElement>(null)

  const [excelData, setExcelData] = React.useState<string[][]>([])
  const [embeddedImages, setEmbeddedImages] = useState<EmbeddedImagesByCell>({})
  const [excelFileName, setExcelFileName] = useState('')
  const [isExcelReady, setIsExcelReady] = React.useState(false)
  const [isParsingExcel, setIsParsingExcel] = useState(false)
  const [password, setPassword] = useState('')
  const [isVerifyingPassword, setIsVerifyingPassword] = useState(false)
  const { notify } = Toast
  const handleExcelParsed = (data: string[][], imageMap: EmbeddedImagesByCell, fileName: string) => {
    setExcelData(data)
    setEmbeddedImages(imageMap)
    setExcelFileName(fileName)
    setIsExcelReady(true)
  }

  const handleSend = async () => {
    if (!password.trim() || isVerifyingPassword)
      return

    setIsVerifyingPassword(true)
    try {
      const response = await fetch(`${API_PREFIX}/batch-run/validate-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!response.ok) {
        notify({ type: 'error', message: t('app.generation.errorMsg.batchPasswordInvalid') })
        return
      }

      setPassword('')
      onSend(excelData, embeddedImages)
    }
    catch {
      notify({ type: 'error', message: t('app.generation.errorMsg.batchPasswordVerifyFailed') })
    }
    finally {
      setIsVerifyingPassword(false)
    }
  }

  const handleExcelSelected = async (file?: File) => {
    if (!file)
      return
    setIsParsingExcel(true)
    setIsExcelReady(false)
    try {
      const parsed = await parseXlsx(file)
      handleExcelParsed(parsed.data, parsed.images, file.name)
    }
    catch {
      notify({ type: 'error', message: t('app.generation.errorMsg.invalidExcel') })
    }
    finally {
      setIsParsingExcel(false)
    }
  }
  const embeddedImageCount = Object.values(embeddedImages).reduce((total, row) => total + Object.values(row).reduce((rowTotal, cell) => rowTotal + cell.length, 0), 0)
  const templateHref = `${(process.env.NEXT_PUBLIC_APP_BASE_URL_PATH || '').replace(/\/$/, '')}/template.xlsx`
  const Icon = isAllFinished ? PlayIcon : Loading02
  return (
    <div className='pt-4'>
      <div className='flex items-center gap-3'>
        <Button className='!h-8 !px-3' onClick={() => excelInputRef.current?.click()} disabled={!isAllFinished || isParsingExcel}>
          <span className='text-[13px]'>{t('app.generation.uploadExcel')}</span>
        </Button>
        <input
          ref={excelInputRef}
          type='file'
          accept='.xlsx,.xlsm'
          className='hidden'
          onClick={event => (event.currentTarget.value = '')}
          onChange={event => handleExcelSelected(event.target.files?.[0])}
        />
        {excelFileName && <span className='text-xs text-gray-600'>{excelFileName}</span>}
        <a href={templateHref} download='template.xlsx' className='inline-flex items-center gap-1 text-sm font-medium text-[#155EEF] hover:text-blue-700'>
          <Download02 className='h-4 w-4' />
          <span>{t('app.generation.downloadExcelTemplate')}</span>
        </a>
      </div>
      <div className='mt-3 text-xs text-gray-500'>{t('app.generation.embeddedImagesDetected')}</div>
      {excelFileName && (
        <div className='mt-3 rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-700'>
          <div className='font-medium'>{t('app.generation.excelImagesReady')}</div>
          <div className='mt-1 text-xs text-gray-500'>{t('app.generation.embeddedImagesCount', { count: embeddedImageCount })}</div>
        </div>
      )}
      {isPreparingImages && <div className='mt-2 text-xs text-primary-600'>{t('app.generation.batchUploadingImages')}</div>}
      <div className='mt-4 h-[1px] bg-gray-100'></div>
      <div className='mt-4 flex flex-wrap items-end justify-between gap-3'>
        <label className='flex min-w-[220px] flex-1 flex-col gap-1 text-sm text-gray-700'>
          <span>{t('app.generation.batchPasswordLabel')}</span>
          <input
            type='password'
            autoComplete='current-password'
            value={password}
            onChange={event => setPassword(event.target.value)}
            placeholder={t('app.generation.batchPasswordPlaceholder')}
            disabled={!isAllFinished || isParsingExcel || isVerifyingPassword}
            className='h-9 rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 disabled:bg-gray-50'
          />
        </label>
        <Button
          type="primary"
          className='!h-8 !pl-3 !pr-4'
          onClick={handleSend}
          disabled={!isExcelReady || !isAllFinished || isParsingExcel || isVerifyingPassword || !password.trim()}
          loading={isVerifyingPassword}
        >
          <Icon className={cn(!isAllFinished && 'animate-spin', 'shrink-0 w-4 h-4 mr-1')} aria-hidden="true" />
          <span className='uppercase text-[13px]'>{t('app.generation.run')}</span>
        </Button>
      </div>
    </div>
  )
}
export default React.memo(RunBatch)
