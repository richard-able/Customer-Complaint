import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PlayIcon,
} from '@heroicons/react/24/solid'
import Select from '@/app/components/base/select'
import { Resolution, TransferMethod } from '@/types/app'
import type { PromptConfig, VisionFile, VisionSettings } from '@/types/app'
import Button from '@/app/components/base/button'
import { DEFAULT_VALUE_MAX_LEN } from '@/config'
import TextGenerationImageUploader from '@/app/components/base/image-uploader/text-generation-image-uploader'

export type IRunOnceProps = {
  promptConfig: PromptConfig
  inputs: Record<string, any>
  onInputsChange: (inputs: Record<string, any>) => void
  onSend: () => void
  isSending: boolean
  resetToken?: number
  /** 每次提交成功后 +1，用于在表单内显示"已提交"提示 */
  submitHintToken?: number
  onPreviewsChange?: (previews: string[]) => void
  visionConfig: VisionSettings
  onVisionFilesChange: (files: VisionFile[]) => void
}
const RunOnce: FC<IRunOnceProps> = ({
  promptConfig,
  inputs,
  onInputsChange,
  onSend,
  isSending,
  resetToken,
  submitHintToken,
  onPreviewsChange,
  visionConfig,
  onVisionFilesChange,
}) => {
  const { t } = useTranslation()
  const [clearVersion, setClearVersion] = useState(0)
  // 工作流自己已有 file-list 变量（如“客户聊天截图”）时，不再显示模板自带的通用图片上传区，避免重复上传
  const hasFileListVariable = promptConfig.prompt_variables.some(item => item.type === 'file-list')

  // 提交后由父组件触发，清空图片上传区，方便继续录入下一条
  useEffect(() => {
    if (!resetToken)
      return
    setClearVersion(version => version + 1)
  }, [resetToken])

  // 提交成功提示：显示在按钮下方，5 秒后自动消失
  const [showSubmitHint, setShowSubmitHint] = useState(false)
  useEffect(() => {
    if (!submitHintToken)
      return
    setShowSubmitHint(true)
    const timer = setTimeout(() => setShowSubmitHint(false), 5000)
    return () => clearTimeout(timer)
  }, [submitHintToken])

  const onClear = () => {
    const newInputs: Record<string, any> = {}
    promptConfig.prompt_variables.forEach((item) => {
      newInputs[item.key] = ''
    })
    onInputsChange(newInputs)
    onVisionFilesChange([])
    setClearVersion(version => version + 1)
  }

  return (
    <div className="">
      <section>
        {/* input form */}
        <form>
          {promptConfig.prompt_variables.map(item => (
            <div className='w-full mt-4' key={item.key}>
              <label className='text-gray-900 text-sm font-medium'>{item.name}</label>
              <div className='mt-2'>
                {item.type === 'select' && (
                  <Select
                    className='w-full'
                    defaultValue={inputs[item.key]}
                    onSelect={(i) => { onInputsChange({ ...inputs, [item.key]: i.value }) }}
                    items={(item.options || []).map(i => ({ name: i, value: i }))}
                    allowSearch={false}
                    bgClassName='bg-gray-50'
                  />
                )}
                {item.type === 'string' && (
                  <input
                    type="text"
                    className="block w-full p-2 text-gray-900 border border-gray-300 rounded-lg bg-gray-50 sm:text-xs focus:ring-blue-500 focus:border-blue-500 "
                    placeholder={`${item.name}${!item.required ? `(${t('appDebug.variableTable.optional')})` : ''}`}
                    value={inputs[item.key]}
                    onChange={(e) => { onInputsChange({ ...inputs, [item.key]: e.target.value }) }}
                    maxLength={item.max_length || DEFAULT_VALUE_MAX_LEN}
                  />
                )}
                {item.type === 'paragraph' && (
                  <textarea
                    className="block w-full h-[104px] p-2 text-gray-900 border border-gray-300 rounded-lg bg-gray-50 sm:text-xs focus:ring-blue-500 focus:border-blue-500 "
                    placeholder={`${item.name}${!item.required ? `(${t('appDebug.variableTable.optional')})` : ''}`}
                    value={inputs[item.key]}
                    onChange={(e) => { onInputsChange({ ...inputs, [item.key]: e.target.value }) }}
                  />
                )}
                {item.type === 'number' && (
                  <input
                    type="number"
                    className="block w-full p-2 text-gray-900 border border-gray-300 rounded-lg bg-gray-50 sm:text-xs focus:ring-blue-500 focus:border-blue-500 "
                    placeholder={`${item.name}${!item.required ? `(${t('appDebug.variableTable.optional')})` : ''}`}
                    value={inputs[item.key]}
                    onChange={(e) => { onInputsChange({ ...inputs, [item.key]: e.target.value }) }}
                  />
                )}
                {item.type === 'file-list' && (
                  <TextGenerationImageUploader
                    key={`${item.key}-${clearVersion}`}
                    settings={{
                      enabled: true,
                      number_limits: item.number_limits || 20,
                      transfer_methods: item.transfer_methods?.length ? item.transfer_methods : [TransferMethod.local_file],
                      detail: Resolution.low,
                      image_file_size_limit: 10,
                    }}
                    onFilesChange={(files) => {
                      const readyFiles = files.filter(file => file.progress !== -1)
                      onPreviewsChange?.(readyFiles.map(file => file.base64Url || '').filter(Boolean))
                      onInputsChange({
                        ...inputs,
                        [item.key]: readyFiles.map(fileItem => ({
                          type: 'image',
                          transfer_method: fileItem.type,
                          url: fileItem.type === 'local_file' ? '' : fileItem.url,
                          upload_file_id: fileItem.fileId,
                        })),
                      })
                    }}
                  />
                )}
              </div>
            </div>
          ))}
          {
            visionConfig?.enabled && !hasFileListVariable && (
              <div className="w-full mt-4">
                <div className="text-gray-900 text-sm font-medium">{t('common.imageUploader.imageUpload')}</div>
                <div className='mt-2'>
                  <TextGenerationImageUploader
                    key={`vision-${clearVersion}`}
                    settings={visionConfig}
                    onFilesChange={files => onVisionFilesChange(files.filter(file => file.progress !== -1).map(fileItem => ({
                      type: 'image',
                      transfer_method: fileItem.type,
                      url: fileItem.url,
                      upload_file_id: fileItem.fileId,
                    })))}
                  />
                </div>
              </div>
            )
          }
          {promptConfig.prompt_variables.length > 0 && (
            <div className='mt-4 h-[1px] bg-gray-100'></div>
          )}
          <div className='w-full mt-4'>
            <div className="flex items-center justify-between">
              <Button
                className='!h-8 !p-3'
                onClick={onClear}
                disabled={false}
              >
                <span className='text-[13px]'>{t('common.operation.clear')}</span>
              </Button>
              <Button
                type="primary"
                className='!h-8 !pl-3 !pr-4'
                onClick={onSend}
                disabled={isSending}
              >
                <PlayIcon className="shrink-0 w-4 h-4 mr-1" aria-hidden="true" />
                <span className='text-[13px]'>{t('app.generation.run')}</span>
              </Button>
            </div>
            {showSubmitHint && (
              <div className='mt-3 flex items-center gap-1 rounded-lg bg-[#ECFDF3] px-3 py-2 text-xs text-[#027A48]'>
                <span className='text-sm leading-none'>✓</span>
                <span>{t('app.generation.history.submitted')}</span>
              </div>
            )}
          </div>
        </form>
      </section>
    </div>
  )
}
export default React.memo(RunOnce)
