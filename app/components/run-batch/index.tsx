'use client'
import type { FC } from 'react'
import React, { useRef, useState } from 'react'
import {
  PlayIcon,
} from '@heroicons/react/24/solid'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import CSVReader from './csv-reader'
import CSVDownload from './csv-download'
import Button from '@/app/components/base/button'
import Loading02 from '@/app/components/base/icons/line/loading-02'
import { parseXlsx } from './parse-xlsx'
import type { EmbeddedImagesByCell } from './parse-xlsx'
import Toast from '@/app/components/base/toast'
import { API_PREFIX } from '@/config'
export type IRunBatchProps = {
  vars: { name: string }[]
  onSend: (data: string[][], embeddedImages: EmbeddedImagesByCell, images: File[]) => void
  isAllFinished: boolean
  isPreparingImages: boolean
}

const RunBatch: FC<IRunBatchProps> = ({
  vars,
  onSend,
  isAllFinished,
  isPreparingImages,
}) => {
  const { t } = useTranslation()
  const imageInputRef = useRef<HTMLInputElement>(null)
  const excelInputRef = useRef<HTMLInputElement>(null)

  const [csvData, setCsvData] = React.useState<string[][]>([])
  const [embeddedImages, setEmbeddedImages] = useState<EmbeddedImagesByCell>({})
  const [excelFileName, setExcelFileName] = useState('')
  const [images, setImages] = useState<File[]>([])
  const [isParsed, setIsParsed] = React.useState(false)
  const [isParsingExcel, setIsParsingExcel] = useState(false)
  const [password, setPassword] = useState('')
  const [isVerifyingPassword, setIsVerifyingPassword] = useState(false)
  const { notify } = Toast
  const handleParsed = (data: string[][], imageMap: EmbeddedImagesByCell = {}, fileName = '') => {
    setCsvData(data)
    setEmbeddedImages(imageMap)
    setExcelFileName(fileName)
    setImages([])
    setIsParsed(true)
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
      onSend(csvData, embeddedImages, images)
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
    setIsParsed(false)
    try {
      const parsed = await parseXlsx(file)
      handleParsed(parsed.data, parsed.images, file.name)
    }
    catch {
      notify({ type: 'error', message: t('app.generation.errorMsg.invalidExcel') })
    }
    finally {
      setIsParsingExcel(false)
    }
  }
  const embeddedImageCount = Object.values(embeddedImages).reduce((total, row) => total + Object.values(row).reduce((rowTotal, cell) => rowTotal + cell.length, 0), 0)
  const Icon = isAllFinished ? PlayIcon : Loading02
  return (
    <div className='pt-4'>
      <CSVReader onParsed={data => handleParsed(data)} />
      <div className='mt-3 flex items-center gap-3'>
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
      </div>
      <div className='mt-4 rounded-lg border border-gray-200 p-4'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <div className='text-sm font-medium text-gray-900'>{excelFileName ? t('app.generation.excelImagesReady') : t('app.generation.batchImagesTitle')}</div>
            <div className='mt-1 text-xs text-gray-500'>{excelFileName ? t('app.generation.embeddedImagesDetected', { count: embeddedImageCount }) : t('app.generation.batchImagesHint')}</div>
          </div>
          {!excelFileName && (
            <>
              <Button
                className='!h-8 !px-3'
                onClick={() => imageInputRef.current?.click()}
                disabled={!isAllFinished || isParsingExcel}
              >
                <span className='text-[13px]'>{t('app.generation.selectImages')}</span>
              </Button>
              <input
                ref={imageInputRef}
                type='file'
                accept='image/*'
                multiple
                className='hidden'
                onClick={(event) => {
                  event.currentTarget.value = ''
                }}
                onChange={(event) => {
                  setImages(Array.from(event.target.files || []))
                }}
              />
            </>
          )}
        </div>
        {excelFileName && <div className='mt-3 text-xs text-gray-600'>{t('app.generation.embeddedImagesCount', { count: embeddedImageCount })}</div>}
        {!excelFileName && images.length > 0 && (
          <div className='mt-3 text-xs text-gray-600'>
            {t('app.generation.selectedImages', { count: images.length })}: {images.map(image => image.name).join(', ')}
          </div>
        )}
        {isPreparingImages && <div className='mt-2 text-xs text-primary-600'>{t('app.generation.batchUploadingImages')}</div>}
      </div>
      {!excelFileName && csvData.length > 0 && <CSVDownload vars={vars} />}
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
          disabled={!isParsed || !isAllFinished || isParsingExcel || isVerifyingPassword || !password.trim()}
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
