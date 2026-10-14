'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { useBoolean, useClickAway } from 'ahooks'
import { XMarkIcon } from '@heroicons/react/24/outline'
import RunOnce from './run-once'
import RunBatch from './run-batch'
import ResDownload from './run-batch/res-download'
import Result from './result'
import Button from './base/button'
import s from './style.module.css'
import AlertCircle from '@/app/components/base/icons/line/alert-circle'
import TabHeader from '@/app/components/base/tab-header'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { fetchAppParams, updateFeedback } from '@/service'
import Toast from '@/app/components/base/toast'
import type { Feedbacktype, PromptConfig, VisionFile, VisionSettings } from '@/types/app'
import { Resolution, TransferMethod } from '@/types/app'
import { changeLanguage } from '@/i18n/i18next-config'
import Loading from '@/app/components/base/loading'
import AppUnavailable from '@/app/components/app-unavailable'
import { APP_ID, APP_INFO, DEFAULT_VALUE_MAX_LEN, IS_WORKFLOW } from '@/config'
import { userInputsFormToPromptVariables } from '@/utils/prompt'
import { imageUpload } from '@/app/components/base/image-uploader/utils'
import type { EmbeddedImagesByCell } from './run-batch/parse-xlsx'

const GROUP_SIZE = 5 // to avoid RPM(Request per minute) limit. The group task finished then the next group.
enum TaskStatus {
  pending = 'pending',
  running = 'running',
  completed = 'completed',
  failed = 'failed',
}

type TaskParam = {
  inputs: Record<string, any>
}

type Task = {
  id: number
  sendToken: number
  retryToken?: number
  status: TaskStatus
  failureReason?: string
  params: TaskParam
}

const TextGeneration = () => {
  const { t } = useTranslation()

  const media = useBreakpoints()
  const isPC = media === MediaType.pc
  const isTablet = media === MediaType.tablet
  const isMobile = media === MediaType.mobile

  const [currTab, setCurrTab] = useState<string>('create')
  // Notice this situation isCallBatchAPI but not in batch tab
  const [isCallBatchAPI, setIsCallBatchAPI] = useState(false)
  const isInBatchTab = currTab === 'batch'

  /*
  * app info
  */
  const hasSetAppConfig = Boolean(APP_ID)
  const [appUnavailable, setAppUnavailable] = useState<boolean>(false)
  const [isUnknwonReason, setIsUnknwonReason] = useState<boolean>(false)

  const [inputs, setInputs] = useState<Record<string, any>>({})
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null)
  const [isResponsing, { setTrue: setResponsingTrue, setFalse: setResponsingFalse }] = useBoolean(false)
  const isResponsingRef = useRef(false)
  const [isPreparingBatch, setIsPreparingBatch] = useState(false)
  const isPreparingBatchRef = useRef(false)
  const [completionRes, setCompletionRes] = useState('')
  const { notify } = Toast
  const isNoData = !completionRes
  const [messageId, setMessageId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedbacktype>({
    rating: null,
  })

  const handleFeedback = async (feedback: Feedbacktype) => {
    await updateFeedback({ url: `/messages/${messageId}/feedbacks`, body: { rating: feedback.rating } })
    setFeedback(feedback)
  }

  const logError = (message: string) => {
    notify({ type: 'error', message })
  }

  const handleResponsingChange = useCallback((responsing: boolean, taskId?: number) => {
    if (taskId !== undefined)
      return
    isResponsingRef.current = responsing
    if (responsing)
      setResponsingTrue()
    else
      setResponsingFalse()
  }, [setResponsingFalse, setResponsingTrue])

  const checkCanSend = () => {
    const prompt_variables = promptConfig?.prompt_variables
    const hasUploadingFiles = completionFiles.some(file => file.transfer_method === TransferMethod.local_file && !file.upload_file_id)
      || !!prompt_variables?.some(({ type, key }) => type === 'file-list' && (inputs[key] || []).some((file: VisionFile) => file.transfer_method === TransferMethod.local_file && !file.upload_file_id))
    if (hasUploadingFiles) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForImgUpload') })
      return false
    }
    if (!prompt_variables || prompt_variables?.length === 0)
      return true

    let hasEmptyInput = false
    const requiredVars = prompt_variables?.filter(({ key, name, required }) => {
      const res = (!key || !key.trim()) || (!name || !name.trim()) || (required || required === undefined || required === null)
      return res
    }) || [] // compatible with old version
    requiredVars.forEach(({ key }) => {
      if (hasEmptyInput)
        return

      const value = inputs[key]
      if (!value || (Array.isArray(value) && value.length === 0))
        hasEmptyInput = true
    })

    if (hasEmptyInput) {
      logError(t('app.errorMessage.valueOfVarRequired'))
      return false
    }
    return !hasEmptyInput
  }
  const [controlSend, setControlSend] = useState(0)
  const [controlStopResponding, setControlStopResponding] = useState(0)
  const [visionConfig, setVisionConfig] = useState<VisionSettings>({
    enabled: false,
    number_limits: 2,
    detail: Resolution.low,
    transfer_methods: [TransferMethod.local_file],
  })
  const [completionFiles, setCompletionFiles] = useState<VisionFile[]>([])
  const handleSend = async () => {
    if (isResponsingRef.current || isPreparingBatchRef.current || (isCallBatchAPI && !allTaskRuned)) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForResponse') })
      return
    }
    if (!checkCanSend())
      return

    handleResponsingChange(true)
    setIsCallBatchAPI(false)
    setControlSend(Date.now())
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    setAllTaskList([]) // clear batch task running status
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    showResSidebar()
  }

  const taskRetryTokenRef = useRef(0)
  const handleRetryAllFailedTask = () => {
    const retryToken = ++taskRetryTokenRef.current
    setAllTaskList(getLatestTaskList().map(task => task.status === TaskStatus.failed ? { ...task, status: TaskStatus.running, retryToken } : task))
  }
  const [allTaskList, doSetAllTaskList] = useState<Task[]>([])
  const taskSendTokenRef = useRef(0)
  const allTaskListRef = useRef<Task[]>([])
  const getLatestTaskList = () => allTaskListRef.current
  const setAllTaskList = (taskList: Task[]) => {
    doSetAllTaskList(taskList)
    allTaskListRef.current = taskList
  }
  const pendingTaskList = allTaskList.filter(task => task.status === TaskStatus.pending)
  const noPendingTask = pendingTaskList.length === 0
  const showTaskList = allTaskList.filter(task => task.status !== TaskStatus.pending)
  const [currGroupNum, doSetCurrGroupNum] = useState(0)
  const currGroupNumRef = useRef(0)
  const setCurrGroupNum = (num: number) => {
    doSetCurrGroupNum(num)
    currGroupNumRef.current = num
  }
  const getCurrGroupNum = () => {
    return currGroupNumRef.current
  }
  const allSuccessTaskList = allTaskList.filter(task => task.status === TaskStatus.completed)
  const allFailedTaskList = allTaskList.filter(task => task.status === TaskStatus.failed)
  const allTaskFinished = allTaskList.every(task => task.status === TaskStatus.completed)
  const allTaskRuned = allTaskList.every(task => [TaskStatus.completed, TaskStatus.failed].includes(task.status))
  const [batchCompletionRes, doSetBatchCompletionRes] = useState<Record<string, string>>({})
  const batchCompletionResRef = useRef<Record<string, string>>({})
  const setBatchCompletionRes = (res: Record<string, string>) => {
    doSetBatchCompletionRes(res)
    batchCompletionResRef.current = res
  }
  const getBatchCompletionRes = () => batchCompletionResRef.current
  const candidateFieldNames = [
    '客户成功',
    '销售',
    '一级分类',
    '二级分类',
    '责任部门',
    '责任人',
    '登记日期',
    '客户咨询时间',
    '响应时间',
    '响应时长',
    '客户发送内容',
    '分类原因',
  ]
  const exportRes = allTaskList.map((task) => {
    const batchCompletionResLatest = getBatchCompletionRes()
    const { inputs } = task.params
    const customerIdVariable = promptConfig?.prompt_variables.find(variable => variable.name.trim() === '客户ID')
      || promptConfig?.prompt_variables.find(variable => variable.type !== 'file-list')
    const rawResult = batchCompletionResLatest[task.id] as any
    const resultText = typeof rawResult === 'string'
      ? rawResult
      : typeof rawResult?.result_tsv === 'string'
        ? rawResult.result_tsv
        : Object.values(rawResult || {}).find(value => typeof value === 'string' && value.includes('\t')) as string | undefined
    const resultRow = resultText?.split(/\r?\n/).map(line => line.split('\t')).find(row => row.length >= 23) || []
    const hasExtendedFields = resultRow.length >= 27
    const firstFieldCount = hasExtendedFields ? 12 : 10
    const secondCandidateStart = hasExtendedFields ? 13 : 11
    const firstConfidenceIndex = hasExtendedFields ? 12 : 10
    const secondConfidenceIndex = hasExtendedFields ? 25 : 21
    const gapIndex = hasExtendedFields ? 26 : 22
    const firstConfidence = Number(resultRow[firstConfidenceIndex])
    const secondConfidence = Number(resultRow[secondConfidenceIndex])
    const confidenceGap = Number(resultRow[gapIndex])
    const warningMessages: string[] = []
    if (Number.isFinite(firstConfidence) && resultRow[firstConfidenceIndex] !== '' && firstConfidence < 0.70)
      warningMessages.push('置信度偏低，建议人工介入复查')
    const normalizedGap = Number.isFinite(confidenceGap) && resultRow[gapIndex] !== ''
      ? confidenceGap
      : (Number.isFinite(firstConfidence) && Number.isFinite(secondConfidence) ? firstConfidence - secondConfidence : NaN)
    if (Number.isFinite(normalizedGap) && normalizedGap < 0.15)
      warningMessages.push(`置信度相近（相差 ${(normalizedGap * 100).toFixed(1)}%），建议人工介入复查`)
    const formatConfidence = (value: number, raw: string | undefined) => {
      if (!raw?.trim() || !Number.isFinite(value))
        return ''
      return `${(value * 100).toFixed(1)}%`
    }
    const firstCandidateFields = resultRow.slice(0, firstFieldCount)
    const secondCandidateFields = resultRow.slice(secondCandidateStart, secondCandidateStart + firstFieldCount)
    const statusLabel = {
      [TaskStatus.pending]: '排队中',
      [TaskStatus.running]: '运行中',
      [TaskStatus.completed]: '成功',
      [TaskStatus.failed]: '失败',
    }[task.status]
    const res: Record<string, string | number> = {
      序号: task.id,
      客户ID: String(inputs[customerIdVariable?.key || ''] ?? ''),
      '告警/复核提示': warningMessages.join('；'),
      执行状态: statusLabel,
    }
    candidateFieldNames.forEach((fieldName, index) => {
      res[`主候选${fieldName}`] = firstCandidateFields[index] || ''
    })
    res['主候选置信度'] = formatConfidence(firstConfidence, resultRow[firstConfidenceIndex])
    candidateFieldNames.forEach((fieldName, index) => {
      res[`第二候选${fieldName}`] = secondCandidateFields[index] || ''
    })
    res['第二候选置信度'] = formatConfidence(secondConfidence, resultRow[secondConfidenceIndex])
    res['失败原因'] = task.status === TaskStatus.failed ? (task.failureReason || '任务执行失败') : ''
    return res
  })
  const checkBatchInputs = (data: string[][]) => {
    if (!data || data.length === 0) {
      notify({ type: 'error', message: t('app.generation.errorMsg.empty') })
      return false
    }
    const headerData = data[0]
    let isMapVarName = true
    promptConfig?.prompt_variables.forEach((item, index) => {
      if (!isMapVarName)
        return

      if (item.name !== headerData[index])
        isMapVarName = false
    })

    if (!isMapVarName) {
      notify({ type: 'error', message: t('app.generation.errorMsg.fileStructNotMatch') })
      return false
    }

    let payloadData = data.slice(1)
    if (payloadData.length === 0) {
      notify({ type: 'error', message: t('app.generation.errorMsg.atLeastOne') })
      return false
    }

    // check middle empty line
    const allEmptyLineIndexes = payloadData.filter(item => item.every(i => i === '')).map(item => payloadData.indexOf(item))
    if (allEmptyLineIndexes.length > 0) {
      let hasMiddleEmptyLine = false
      let startIndex = allEmptyLineIndexes[0] - 1
      allEmptyLineIndexes.forEach((index) => {
        if (hasMiddleEmptyLine)
          return

        if (startIndex + 1 !== index) {
          hasMiddleEmptyLine = true
          return
        }
        startIndex++
      })

      if (hasMiddleEmptyLine) {
        notify({ type: 'error', message: t('app.generation.errorMsg.emptyLine', { rowIndex: startIndex + 2 }) })
        return false
      }
    }

    // check row format
    payloadData = payloadData.filter(item => !item.every(i => i === ''))
    // after remove empty rows in the end, checked again
    if (payloadData.length === 0) {
      notify({ type: 'error', message: t('app.generation.errorMsg.atLeastOne') })
      return false
    }
    let errorRowIndex = 0
    let requiredVarName = ''
    let moreThanMaxLengthVarName = ''
    let maxLength = 0
    payloadData.forEach((item, index) => {
      if (errorRowIndex !== 0)
        return

      promptConfig?.prompt_variables.forEach((varItem, varIndex) => {
        if (errorRowIndex !== 0)
          return
        if (varItem.type === 'string') {
          const maxLen = varItem.max_length || DEFAULT_VALUE_MAX_LEN
          if (item[varIndex].length > maxLen) {
            moreThanMaxLengthVarName = varItem.name
            maxLength = maxLen
            errorRowIndex = index + 1
            return
          }
        }
        if (varItem.required === false)
          return

        if (item[varIndex].trim() === '') {
          requiredVarName = varItem.name
          errorRowIndex = index + 1
        }
      })
    })

    if (errorRowIndex !== 0) {
      if (requiredVarName)
        notify({ type: 'error', message: t('app.generation.errorMsg.invalidLine', { rowIndex: errorRowIndex + 1, varName: requiredVarName }) })

      if (moreThanMaxLengthVarName)
        notify({ type: 'error', message: t('app.generation.errorMsg.moreThanMaxLengthLine', { rowIndex: errorRowIndex + 1, varName: moreThanMaxLengthVarName, maxLength }) })

      return false
    }
    return true
  }

  const handleRunBatch = async (data: string[][], embeddedImages: EmbeddedImagesByCell, selectedImages: File[]) => {
    if (!checkBatchInputs(data))
      return
    if (!allTaskFinished || isResponsingRef.current || isPreparingBatchRef.current || (isCallBatchAPI && !allTaskRuned)) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForBatchResponse') })
      return
    }

    const payloadData = data.filter(item => !item.every(i => i === '')).slice(1)
    const varLen = promptConfig?.prompt_variables.length || 0
    const fileVariables = (promptConfig?.prompt_variables || [])
      .map((variable, index) => ({ variable, index }))
      .filter(({ variable }) => variable.type === 'file-list')
    const selectedImagesByName = new Map(selectedImages.map(file => [file.name, file]))
    const imageFilesByRow = payloadData.map((row, rowIndex) => fileVariables.flatMap(({ index }) => {
      const embeddedCellImages = embeddedImages[rowIndex]?.[index] || []
      if (embeddedCellImages.length > 0)
        return embeddedCellImages
      return (row[index] || '').split(/[;；\n]/).map(name => selectedImagesByName.get(name.trim())).filter((image): image is File => Boolean(image))
    }))
    const missingImageNames = [...new Set(payloadData.flatMap((row, rowIndex) => fileVariables.flatMap(({ index }) => {
      if ((embeddedImages[rowIndex]?.[index] || []).length > 0)
        return []
      return (row[index] || '').split(/[;；\n]/).map(name => name.trim()).filter(name => name && !selectedImagesByName.has(name))
    })))]
    if (missingImageNames.length > 0) {
      notify({ type: 'error', message: t('app.generation.errorMsg.batchImagesMissing', { names: missingImageNames.join(', ') }) })
      return
    }

    isPreparingBatchRef.current = true
    setIsPreparingBatch(true)
    setIsCallBatchAPI(true)
    setCurrGroupNum(0)
    setBatchCompletionRes({})
    try {
      const requiredImages = [...new Set(imageFilesByRow.flat())]
      const uploadedImages = new Map<File, string>()
      await Promise.all(requiredImages.map(file => new Promise<void>((resolve, reject) => {
        imageUpload({
          file,
          onProgressCallback: () => {},
          onSuccessCallback: ({ id }) => {
            uploadedImages.set(file, id)
            resolve()
          },
          onErrorCallback: () => reject(new Error(file.name)),
        })
      })))

      const allTaskList: Task[] = payloadData.map((item, i) => {
        const inputs: Record<string, any> = {}
        if (varLen > 0) {
          item.slice(0, varLen).forEach((input, index) => {
            const variable = promptConfig?.prompt_variables[index]
            if (variable?.type === 'file-list') {
              const files = embeddedImages[i]?.[index]?.length
                ? embeddedImages[i][index]
                : (input || '').split(/[;；\n]/).map(name => selectedImagesByName.get(name.trim())).filter((image): image is File => Boolean(image))
              inputs[variable.key] = files.map(file => ({
                type: 'image',
                transfer_method: TransferMethod.local_file,
                url: '',
                upload_file_id: uploadedImages.get(file) || '',
              }))
            }
            else {
              inputs[variable?.key as string] = input
            }
          })
        }
        return {
          id: i + 1,
          sendToken: ++taskSendTokenRef.current,
          status: i < GROUP_SIZE ? TaskStatus.running : TaskStatus.pending,
          params: { inputs },
        }
      })
      setAllTaskList(allTaskList)
      setControlSend(Date.now())
      setControlStopResponding(Date.now())
      showResSidebar()
    }
    catch (error) {
      setIsCallBatchAPI(false)
      notify({ type: 'error', message: t('app.generation.errorMsg.batchImageUploadFailed', { name: (error as Error).message }) })
    }
    finally {
      isPreparingBatchRef.current = false
      setIsPreparingBatch(false)
    }
  }

  const handleCompleted = (completionRes: string, taskId?: number, isSuccess?: boolean, failureReason?: string) => {
    if (taskId === undefined)
      handleResponsingChange(false)
    const allTasklistLatest = getLatestTaskList()
    if (taskId !== undefined) {
      const task = allTasklistLatest.find(item => item.id === taskId)
      if (!task || task.status === TaskStatus.completed || task.status === TaskStatus.failed)
        return
    }
    const batchCompletionResLatest = getBatchCompletionRes()
    const pendingTaskList = allTasklistLatest.filter(task => task.status === TaskStatus.pending)
    const hadRunedTaskNum = 1 + allTasklistLatest.filter(task => [TaskStatus.completed, TaskStatus.failed].includes(task.status)).length
    const needToAddNextGroupTask = (getCurrGroupNum() !== hadRunedTaskNum) && pendingTaskList.length > 0 && (hadRunedTaskNum % GROUP_SIZE === 0 || (allTasklistLatest.length - hadRunedTaskNum < GROUP_SIZE))
    // avoid add many task at the same time
    if (needToAddNextGroupTask)
      setCurrGroupNum(hadRunedTaskNum)
    // console.group()
    // console.log(`[#${taskId}]: ${isSuccess ? 'success' : 'fail'}.currGroupNum: ${getCurrGroupNum()}.hadRunedTaskNum: ${hadRunedTaskNum}, needToAddNextGroupTask: ${needToAddNextGroupTask}`)
    // console.log([...allTasklistLatest.filter(task => [TaskStatus.completed, TaskStatus.failed].includes(task.status)).map(item => item.id), taskId].sort((a: any, b: any) => a - b).join(','))
    // console.groupEnd()
    const nextPendingTaskIds = needToAddNextGroupTask ? pendingTaskList.slice(0, GROUP_SIZE).map(item => item.id) : []
    const newAllTaskList = allTasklistLatest.map((item) => {
      if (item.id === taskId) {
        return {
          ...item,
          status: isSuccess ? TaskStatus.completed : TaskStatus.failed,
          failureReason: isSuccess ? undefined : failureReason,
        }
      }
      if (needToAddNextGroupTask && nextPendingTaskIds.includes(item.id)) {
        return {
          ...item,
          status: TaskStatus.running,
        }
      }
      return item
    })
    setAllTaskList(newAllTaskList)
    if (taskId) {
      setBatchCompletionRes({
        ...batchCompletionResLatest,
        [`${taskId}`]: completionRes,
      })
    }
  }

  useEffect(() => {
    if (!hasSetAppConfig) {
      setAppUnavailable(true)
      return
    }
    (async () => {
      try {
        changeLanguage(APP_INFO.default_language)

        const { user_input_form, file_upload, system_parameters }: any = await fetchAppParams()
        const prompt_variables = userInputsFormToPromptVariables(user_input_form)

        setPromptConfig({
          prompt_template: '',
          prompt_variables,
        } as PromptConfig)
        setVisionConfig({
          ...file_upload?.image,
          image_file_size_limit: system_parameters?.image_file_size_limit || 0,
        })
      }
      catch (e: any) {
        if (e.status === 404) {
          setAppUnavailable(true)
        }
        else {
          setIsUnknwonReason(true)
          setAppUnavailable(true)
        }
      }
    })()
  }, [])

  useEffect(() => {
    if (APP_INFO?.title)
      document.title = `${APP_INFO.title} - Powered by Dify`
  }, [APP_INFO?.title])

  const [isShowResSidebar, { setTrue: showResSidebar, setFalse: hideResSidebar }] = useBoolean(false)
  const resRef = useRef<HTMLDivElement>(null)
  useClickAway(() => {
    hideResSidebar()
  }, resRef)

  const renderRes = (task?: Task) => (
    <Result
      key={task ? `${task.id}-${task.sendToken}` : 'single-result'}
      isWorkflow={IS_WORKFLOW}
      isCallBatchAPI={isCallBatchAPI}
      isPC={isPC}
      isMobile={isMobile}
      isError={task?.status === TaskStatus.failed}
      promptConfig={promptConfig}
      inputs={isCallBatchAPI ? (task as Task).params.inputs : inputs}
      controlSend={task?.sendToken ?? controlSend}
      controlRetry={task?.retryToken ?? 0}
      controlStopResponding={controlStopResponding}
      onShowRes={showResSidebar}
      taskId={task?.id}
      onCompleted={handleCompleted}
      onResponsingChange={handleResponsingChange}
      visionConfig={visionConfig}
      completionFiles={completionFiles}
    />
  )

  const renderBatchRes = () => {
    return (showTaskList.map(task => renderRes(task)))
  }

  const renderResWrap = (
    <div
      ref={resRef}
      className={
        cn(
          'flex flex-col h-full shrink-0',
          isPC ? 'px-10 py-8' : 'bg-gray-50',
          isTablet && 'p-6', isMobile && 'p-4')
      }
    >
      <>
        <div className='shrink-0 flex items-center justify-between'>
          <div className='flex items-center space-x-3'>
            <div className={s.starIcon}></div>
            <div className='text-lg text-gray-800 font-semibold'>{t('app.generation.title')}</div>
          </div>
          <div className='flex items-center space-x-2'>
            {allFailedTaskList.length > 0 && (
              <div className='flex items-center'>
                <AlertCircle className='w-4 h-4 text-[#D92D20]' />
                <div className='ml-1 text-[#D92D20]'>{t('app.generation.batchFailed.info', { num: allFailedTaskList.length })}</div>
                <Button
                  type='primary'
                  className='ml-2 !h-8 !px-3'
                  onClick={handleRetryAllFailedTask}
                >{t('app.generation.batchFailed.retry')}</Button>
                <div className='mx-3 w-[1px] h-3.5 bg-gray-200'></div>
              </div>
            )}
            {allTaskList.length > 0 && (
              <ResDownload
                isMobile={isMobile}
                values={exportRes}
              />
            )}
            {!isPC && (
              <div
                className='flex items-center justify-center cursor-pointer'
                onClick={hideResSidebar}
              >
                <XMarkIcon className='w-4 h-4 text-gray-800' />
              </div>
            )}
          </div>
        </div>

        <div className='grow overflow-y-auto'>
          {!isCallBatchAPI ? renderRes() : renderBatchRes()}
          {!noPendingTask && (
            <div className='mt-4'>
              <Loading type='area' />
            </div>
          )}
        </div>
      </>
    </div>
  )

  if (appUnavailable)
    return <AppUnavailable isUnknwonReason={isUnknwonReason} errMessage={!hasSetAppConfig ? 'Please set NEXT_PUBLIC_APP_ID in the deployment environment' : ''} />

  if (!APP_INFO || !promptConfig)
    return <Loading type='app' />

  return (
    <>
      <div className={cn(isPC && 'flex', 'h-screen bg-gray-50')}>
        {/* Left */}
        <div className={cn(isPC ? 'w-[600px] max-w-[50%] p-8' : 'p-4', 'shrink-0 relative flex flex-col pb-10 h-full border-r border-gray-100 bg-white')}>
          <div className='mb-6'>
            <div className='flex justify-between items-center'>
              <div className='flex items-center space-x-3'>
                <div className={cn(s.appIcon, 'shrink-0')}></div>
                <div className='text-lg text-gray-800 font-semibold'>{APP_INFO.title}</div>
              </div>
              {!isPC && (
                <Button
                  className='shrink-0 !h-8 !px-3'
                  onClick={showResSidebar}
                >
                  <div className='flex items-center space-x-2 text-primary-600 text-[13px] font-medium'>
                    <div className={s.starIcon}></div>
                    <span>{t('app.generation.title')}</span>
                  </div>
                </Button>
              )}
            </div>
            {APP_INFO.description && (
              <div className='mt-2 text-xs text-gray-500'>{APP_INFO.description}</div>
            )}
          </div>

          <TabHeader
            items={[
              { id: 'create', name: t('app.generation.tabs.create') },
              { id: 'batch', name: t('app.generation.tabs.batch') },
            ]}
            value={currTab}
            onChange={setCurrTab}
          />

          <div className='grow h-20 overflow-y-auto'>
            <div className={cn(currTab === 'create' ? 'block' : 'hidden')}>
              <RunOnce
                inputs={inputs}
                onInputsChange={setInputs}
                promptConfig={promptConfig}
                onSend={handleSend}
                isSending={isResponsing || isPreparingBatch || (isCallBatchAPI && !allTaskRuned)}
                visionConfig={visionConfig}
                onVisionFilesChange={setCompletionFiles}
              />
            </div>
            {isInBatchTab && (
              <RunBatch
                vars={promptConfig.prompt_variables.map(item => ({ name: item.name }))}
                onSend={handleRunBatch}
                isAllFinished={allTaskFinished && !isResponsing && !isPreparingBatch && (!isCallBatchAPI || allTaskRuned)}
                isPreparingImages={isPreparingBatch}
              />
            )}
          </div>

          {/* copyright */}
          <div className='fixed left-8 bottom-4  flex space-x-2 text-gray-400 font-normal text-xs'>
            <div className="">© {APP_INFO.copyright || APP_INFO.title} {(new Date()).getFullYear()}</div>
            {APP_INFO.privacy_policy && (
              <>
                <div>·</div>
                <div>{t('app.generation.privacyPolicyLeft')}
                  <a
                    className='text-gray-500'
                    href={APP_INFO.privacy_policy}
                    target='_blank'>{t('app.generation.privacyPolicyMiddle')}</a>
                  {t('app.generation.privacyPolicyRight')}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Result */}
        {isPC && (
          <div className='grow h-full'>
            {renderResWrap}
          </div>
        )}

        {(!isPC && isShowResSidebar) && (
          <div
            className={cn('fixed z-50 inset-0', isTablet ? 'pl-[128px]' : 'pl-6')}
            style={{
              background: 'rgba(35, 56, 118, 0.2)',
            }}
          >
            {renderResWrap}
          </div>
        )}
      </div>
    </>
  )
}

export default TextGeneration
