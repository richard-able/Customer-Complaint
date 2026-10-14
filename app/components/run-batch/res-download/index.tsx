'use client'
import type { FC } from 'react'
import React from 'react'
import { usePapaParse } from 'react-papaparse'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import Download02 from '@/app/components/base/icons/solid/download-02'
import Button from '@/app/components/base/button'
export type IResDownloadProps = {
  isMobile: boolean
  values: Record<string, string | number>[]
}

const ResDownload: FC<IResDownloadProps> = ({
  isMobile,
  values,
}) => {
  const { t } = useTranslation()
  const { jsonToCSV } = usePapaParse()

  const downloadTsv = () => {
    const content = jsonToCSV(values, { delimiter: '\t' })
    const blob = new Blob(['\uFEFF', content], { type: 'text/tab-separated-values;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'result.tsv'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <Button onClick={downloadTsv} className={cn('flex items-center !h-8 space-x-2 bg-white !text-[13px] font-medium', isMobile ? '!p-0 !w-8 justify-center' : '!px-3')}>
      <Download02 className='w-4 h-4 text-[#155EEF]' />
      {!isMobile && <span className='text-[#155EEF]'>{t('common.operation.download')}</span>}
    </Button>
  )
}
export default React.memo(ResDownload)
