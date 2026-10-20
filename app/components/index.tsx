'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { useBoolean, useClickAway } from 'ahooks'
import { XMarkIcon } from '@heroicons/react/24/outline'
import ChevronRightIcon from '@/app/components/base/icons/line/arrows/ChevronRight'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'
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

// 并发上限：同一时刻最多执行的任务数，默认 5（避免触发 Dify 的 RPM 限制），可用 NEXT_PUBLIC_MAX_CONCURRENT 覆盖。
const MAX_CONCURRENT = Math.max(1, Number(process.env.NEXT_PUBLIC_MAX_CONCURRENT) || 5)
// 历史最多保留的任务条数，避免 localStorage 无限膨胀。
const MAX_HISTORY_TASKS = 100
const HISTORY_STORAGE_KEY = 'customer-complaint.task-history.v1'
enum TaskStatus {
  pending = 'pending',
  running = 'running',
  completed = 'completed',
  failed = 'failed',
}

type TaskSource = 'create' | 'batch'

type TaskParam = {
  inputs: Record<string, any>
  files?: VisionFile[]
}

type Task = {
  id: number
  sendToken: number
  retryToken?: number
  status: TaskStatus
  failureReason?: string
  createdAt: number
  customerId: string
  source: TaskSource
  /** 截图缩略图（data url，仅用于右侧历史标题展示，不参与请求） */
  thumbnails?: string[]
  /** 放大查看用的图片（data url，比缩略图大，同样不参与请求） */
  previews?: string[]
  screenshotCount?: number
  params: TaskParam
}

type PersistedHistory = {
  version: 1
  nextTaskId: number
  tasks: Task[]
  results: Record<string, any>
}

// 从工作流变量里取“客户ID”列，取不到时退回第一个非文件类变量（与导出逻辑一致）
const resolveCustomerIdVariable = (promptConfig: PromptConfig | null) =>
  promptConfig?.prompt_variables.find(variable => variable.name.trim() === '客户ID')
  || promptConfig?.prompt_variables.find(variable => variable.type !== 'file-list')

const buildCustomerId = (inputs: Record<string, any>, promptConfig: PromptConfig | null) => {
  const variable = resolveCustomerIdVariable(promptConfig)
  if (!variable)
    return ''
  const value = inputs?.[variable.key]
  return Array.isArray(value) ? '' : String(value ?? '').trim()
}

const THUMBNAIL_MAX_SIZE = 96
const THUMBNAIL_LIMIT = 3
const THUMBNAIL_KEEP_TASKS = 30
const PREVIEW_MAX_SIZE = 720
const PREVIEW_LIMIT = 2
const PREVIEW_KEEP_TASKS = 8

// 生成缩放宽高后的 data url 图片，只用于右侧展示，不进入请求体
const createScaledImage = (dataUrl: string, maxSize: number, quality: number) => new Promise<string>((resolve) => {
  if (!dataUrl || typeof document === 'undefined') {
    resolve('')
    return
  }
  const image = new Image()
  image.onload = () => {
    try {
      const naturalWidth = image.naturalWidth || 1
      const naturalHeight = image.naturalHeight || 1
      const scale = Math.min(1, maxSize / Math.max(naturalWidth, naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        resolve('')
        return
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    catch {
      resolve('')
    }
  }
  image.onerror = () => resolve('')
  image.src = dataUrl
})

const createThumbnail = (dataUrl: string) => createScaledImage(dataUrl, THUMBNAIL_MAX_SIZE, 0.6)

const buildThumbnails = async (dataUrls: string[]) => {
  const targets = dataUrls.filter(Boolean).slice(0, THUMBNAIL_LIMIT)
  const thumbnails = await Promise.all(targets.map(createThumbnail))
  return thumbnails.filter(Boolean)
}

// 一次产出缩略图（列表用）和放大图（点击查看用）
const buildTaskImages = async (dataUrls: string[]) => {
  const targets = dataUrls.filter(Boolean)
  if (targets.length === 0)
    return { thumbnails: [] as string[], previews: [] as string[] }
  const previews = (await Promise.all(targets.slice(0, PREVIEW_LIMIT).map(dataUrl => createScaledImage(dataUrl, PREVIEW_MAX_SIZE, 0.65)))).filter(Boolean)
  const thumbnails = await buildThumbnails(previews.length > 0 ? previews : targets)
  return { thumbnails, previews }
}

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve) => {
  const reader = new FileReader()
  reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
  reader.onerror = () => resolve('')
  reader.readAsDataURL(file)
})

const countScreenshots = (inputs: Record<string, any>, promptConfig: PromptConfig | null) => {
  let count = 0
  promptConfig?.prompt_variables.forEach((variable) => {
    if (variable.type !== 'file-list')
      return
    const value = inputs?.[variable.key]
    if (Array.isArray(value))
      count += value.length
  })
  return count
}

// 手动格式化，避免服务端渲染与浏览器的时区/locale 差异导致 hydration 警告
const formatTaskTime = (timestamp: number) => {
  const date = new Date(timestamp)
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const TextGeneration = () => {
  const { t } = useTranslation()

  const media = useBreakpoints()
  const isPC = media === MediaType.pc
  const isTablet = media === MediaType.tablet
  const isMobile = media === MediaType.mobile

  const [currTab, setCurrTab] = useState<string>('create')
  const isInBatchTab = currTab === 'batch'

  /*
  * app info
  */
  const hasSetAppConfig = Boolean(APP_ID)
  const [appUnavailable, setAppUnavailable] = useState<boolean>(false)
  const [isUnknwonReason, setIsUnknwonReason] = useState<boolean>(false)

  const [inputs, setInputs] = useState<Record<string, any>>({})
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null)
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
  const [visionConfig, setVisionConfig] = useState<VisionSettings>({
    enabled: false,
    number_limits: 2,
    detail: Resolution.low,
    transfer_methods: [TransferMethod.local_file],
  })
  const [completionFiles, setCompletionFiles] = useState<VisionFile[]>([])
  const [formPreviews, setFormPreviews] = useState<string[]>([])
  const [resetFormToken, setResetFormToken] = useState(0)
  // 提交成功提示改成左侧表单内联展示（右上角 toast 容易看不到）
  const [submitHintToken, setSubmitHintToken] = useState(0)

  // 提交成功后清空左侧表单，方便立刻录入下一条
  const resetInputForm = () => {
    const emptyInputs: Record<string, any> = {}
    const customerIdVariable = promptConfig?.prompt_variables.find(item => item.name.trim() === '客户ID')
    promptConfig?.prompt_variables.forEach((item) => {
      // 提交后清空图片等输入，但保留客户ID，便于连续录入同一客户。
      emptyInputs[item.key] = item.key === customerIdVariable?.key
        ? inputs[item.key] ?? ''
        : item.type === 'file-list' ? [] : ''
    })
    setInputs(emptyInputs)
    setCompletionFiles([])
    setFormPreviews([])
    setResetFormToken(token => token + 1)
  }

  // 单次运行：不再等待上一条结束，直接把当前输入入队，并行执行
  const handleRunOnce = async () => {
    if (isPreparingBatchRef.current) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForResponse') })
      return
    }
    if (!checkCanSend())
      return

    const previews = [...formPreviews]
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    const createdTasks = enqueueTasks([{
      inputs: { ...inputs },
      files: completionFiles.length > 0 ? [...completionFiles] : undefined,
      source: 'create',
    }])
    resetInputForm()
    setSubmitHintToken(token => token + 1)

    // 缩略图是纯展示数据，异步生成后回填，避免拖慢提交
    if (createdTasks.length && previews.length) {
      const { thumbnails, previews: previewImages } = await buildTaskImages(previews)
      if (thumbnails.length || previewImages.length) {
        const createdIds = createdTasks.map(task => task.id)
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        setAllTaskList(getLatestTaskList().map(task => createdIds.includes(task.id) ? { ...task, thumbnails, previews: previewImages } : task))
      }
    }
  }

  const taskRetryTokenRef = useRef(0)
  const [allTaskList, doSetAllTaskList] = useState<Task[]>([])
  const taskSendTokenRef = useRef(0)
  const nextTaskIdRef = useRef(1)
  const allTaskListRef = useRef<Task[]>([])
  const [historyReady, setHistoryReady] = useState(false)
  const getLatestTaskList = () => allTaskListRef.current
  const setAllTaskList = (taskList: Task[]) => {
    doSetAllTaskList(taskList)
    allTaskListRef.current = taskList
  }
  const [expandedTaskIds, setExpandedTaskIds] = useState<number[]>([])
  const [previewImages, setPreviewImages] = useState<string[]>([])
  const openTaskImages = (task: Task) => {
    const images = (task.previews?.length ? task.previews : task.thumbnails) || []
    if (images.length > 0)
      setPreviewImages(images)
  }
  const toggleTaskExpanded = (taskId: number) => {
    setExpandedTaskIds(ids => ids.includes(taskId) ? ids.filter(id => id !== taskId) : [...ids, taskId])
  }
  const isCallBatchAPI = allTaskList.length > 0 // 有任务时右侧按任务历史列表渲染
  const pendingTaskList = allTaskList.filter(task => task.status === TaskStatus.pending)
  const runningTaskList = allTaskList.filter(task => task.status === TaskStatus.running)
  const allFailedTaskList = allTaskList.filter(task => task.status === TaskStatus.failed)
  const allTaskRuned = allTaskList.every(task => [TaskStatus.completed, TaskStatus.failed].includes(task.status))

  // 单次运行与批量运行都走这里入队，由调度器统一控制并发
  const enqueueTasks = (items: Array<{ inputs: Record<string, any>, files?: VisionFile[], source: TaskSource, thumbnails?: string[], previews?: string[] }>) => {
    if (items.length === 0)
      return []
    const createdAt = Date.now()
    const tasks: Task[] = items.map((item, index) => ({
      id: nextTaskIdRef.current++,
      sendToken: ++taskSendTokenRef.current,
      status: TaskStatus.pending,
      createdAt: createdAt + index,
      customerId: buildCustomerId(item.inputs, promptConfig),
      source: item.source,
      thumbnails: item.thumbnails,
      previews: item.previews,
      screenshotCount: countScreenshots(item.inputs, promptConfig),
      params: { inputs: item.inputs, files: item.files },
    }))
    setAllTaskList([...getLatestTaskList(), ...tasks])
    // 新任务默认展开，方便立刻看到进度
    setExpandedTaskIds(ids => [...ids, ...tasks.map(task => task.id)])
    showResSidebar()
    return tasks
  }

  const handleRetryAllFailedTask = () => {
    const retryToken = ++taskRetryTokenRef.current
    const latest = getLatestTaskList()
    const retryIds = latest.filter(task => task.status === TaskStatus.failed).map(task => task.id)
    setExpandedTaskIds(ids => [...new Set([...ids, ...retryIds])])
    setAllTaskList(latest.map(task => task.status === TaskStatus.failed ? { ...task, status: TaskStatus.running, retryToken } : task))
  }
  const [batchCompletionRes, doSetBatchCompletionRes] = useState<Record<string, string>>({})
  const batchCompletionResRef = useRef<Record<string, string>>({})
  const setBatchCompletionRes = (res: Record<string, string>) => {
    doSetBatchCompletionRes(res)
    batchCompletionResRef.current = res
  }
  const getBatchCompletionRes = () => batchCompletionResRef.current

  // 调度：始终让运行中的任务数不超过 MAX_CONCURRENT，谁先结束谁先补位
  useEffect(() => {
    if (!historyReady)
      return
    const latest = getLatestTaskList()
    const available = MAX_CONCURRENT - latest.filter(task => task.status === TaskStatus.running).length
    if (available <= 0)
      return
    const nextRunningIds = latest
      .filter(task => task.status === TaskStatus.pending)
      .slice(0, available)
      .map(task => task.id)
    if (nextRunningIds.length === 0)
      return
    setAllTaskList(latest.map(task => nextRunningIds.includes(task.id) ? { ...task, status: TaskStatus.running } : task))
  }, [allTaskList, historyReady])

  // 恢复历史：已完成的任务刷新后仍可查看；被中断的任务标记为失败，可手动重试
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedHistory
        if (parsed?.version === 1 && Array.isArray(parsed.tasks)) {
          const restoredTasks = parsed.tasks
            .filter(task => task && typeof task.id === 'number')
            .map((task, index) => {
              // 负数 token：唯一但不会触发自动执行（只有正数 token 会启动任务）
              const sendToken = -(index + 1)
              return task.status === TaskStatus.completed
                ? { ...task, sendToken }
                : {
                    ...task,
                    sendToken,
                    retryToken: undefined,
                    status: TaskStatus.failed as TaskStatus,
                    failureReason: task.status === TaskStatus.failed
                      ? (task.failureReason || '任务执行失败')
                      : '页面刷新中断，可点击重试',
                  }
            })
          setAllTaskList(restoredTasks)
          setBatchCompletionRes(parsed.results || {})
          nextTaskIdRef.current = Math.max(parsed.nextTaskId || 1, ...restoredTasks.map(task => task.id + 1), 1)
        }
      }
    }
    catch {
      // 历史数据损坏时忽略，不影响正常使用
    }
    setHistoryReady(true)
  }, [])

  // 持久化任务历史（含结果），刷新后仍可查看
  useEffect(() => {
    if (!historyReady)
      return
    try {
      const trimmedTasks = allTaskList.slice(-MAX_HISTORY_TASKS)
      const keptIds = new Set(trimmedTasks.map(task => `${task.id}`))
      const results: Record<string, any> = {}
      Object.entries(getBatchCompletionRes()).forEach(([key, value]) => {
        if (keptIds.has(key))
          results[key] = value
      })
      // 图片只保留最近若干条，避免 localStorage 超限
      const trimImages = (tasks: Task[], keepPreviews: boolean, keepThumbnails: boolean) => {
        const previewStart = Math.max(0, tasks.length - PREVIEW_KEEP_TASKS)
        const thumbStart = Math.max(0, tasks.length - THUMBNAIL_KEEP_TASKS)
        return tasks.map((task, index) => ({
          ...task,
          previews: keepPreviews && index >= previewStart ? task.previews : undefined,
          thumbnails: keepThumbnails && index >= thumbStart ? task.thumbnails : undefined,
        }))
      }
      const payloadOf = (tasks: Task[]) => JSON.stringify({
        version: 1,
        nextTaskId: nextTaskIdRef.current,
        tasks,
        results,
      } as PersistedHistory)
      try {
        window.localStorage.setItem(HISTORY_STORAGE_KEY, payloadOf(trimImages(trimmedTasks, true, true)))
      }
      catch {
        // 超出配额时逐级降级：先去放大图，再去缩略图
        try {
          window.localStorage.setItem(HISTORY_STORAGE_KEY, payloadOf(trimImages(trimmedTasks, false, true)))
        }
        catch {
          try {
            window.localStorage.setItem(HISTORY_STORAGE_KEY, payloadOf(trimImages(trimmedTasks, false, false)))
          }
          catch {
            // 仍然失败就只保留本次会话，不影响使用
          }
        }
      }
    }
    catch {
      // 超出存储配额等情况静默跳过，不影响本次会话
    }
  }, [allTaskList, batchCompletionRes, historyReady])

  const handleClearHistory = () => {
    if (allTaskList.length === 0)
      return
    if (!window.confirm(String(t('app.generation.history.clearConfirm'))))
      return
    setAllTaskList([])
    setBatchCompletionRes({})
    setExpandedTaskIds([])
    // 清空历史后编号重新从 1 开始
    nextTaskIdRef.current = 1
    try {
      window.localStorage.removeItem(HISTORY_STORAGE_KEY)
    }
    catch {
      // 忽略清理失败
    }
  }
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
  const checkBatchInputs = (data: string[][], embeddedImages: EmbeddedImagesByCell) => {
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
          if ((item[varIndex] || '').length > maxLen) {
            moreThanMaxLengthVarName = varItem.name
            maxLength = maxLen
            errorRowIndex = index + 1
            return
          }
        }
        if (varItem.type === 'file-list') {
          if (embeddedImages[index]?.[varIndex]?.length || varItem.required === false)
            return
          requiredVarName = varItem.name
          errorRowIndex = index + 1
          return
        }
        if (varItem.required === false)
          return

        if ((item[varIndex] || '').trim() === '') {
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

  const handleRunBatch = async (data: string[][], embeddedImages: EmbeddedImagesByCell) => {
    if (!checkBatchInputs(data, embeddedImages))
      return
    if (isPreparingBatchRef.current) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForBatchResponse') })
      return
    }

    const payloadData = data.filter(item => !item.every(i => i === '')).slice(1)
    const varLen = promptConfig?.prompt_variables.length || 0
    const fileVariables = (promptConfig?.prompt_variables || [])
      .map((variable, index) => ({ variable, index }))
      .filter(({ variable }) => variable.type === 'file-list')
    const imageFilesByRow = payloadData.map((_, rowIndex) => fileVariables.flatMap(({ index }) => embeddedImages[rowIndex]?.[index] || []))

    isPreparingBatchRef.current = true
    setIsPreparingBatch(true)
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

      const imagesByRow = await Promise.all(payloadData.map(async (_, rowIndex) => {
        const rowImages = fileVariables.flatMap(({ index }) => embeddedImages[rowIndex]?.[index] || []).slice(0, PREVIEW_LIMIT)
        if (rowImages.length === 0)
          return { thumbnails: [] as string[], previews: [] as string[] }
        const dataUrls = (await Promise.all(rowImages.map(readFileAsDataUrl))).filter(Boolean)
        return buildTaskImages(dataUrls)
      }))

      const batchTasks = payloadData.map((item, i) => {
        const taskInputs: Record<string, any> = {}
        if (varLen > 0) {
          item.slice(0, varLen).forEach((input, index) => {
            const variable = promptConfig?.prompt_variables[index]
            if (variable?.type === 'file-list') {
              const files = embeddedImages[i]?.[index] || []
              taskInputs[variable.key] = files.map(file => ({
                type: 'image',
                transfer_method: TransferMethod.local_file,
                url: '',
                upload_file_id: uploadedImages.get(file) || '',
              }))
            }
            else {
              taskInputs[variable?.key as string] = input
            }
          })
        }
        // 批量任务的图片来自表格内嵌图片，这里显式置空，避免复用左侧单次运行残留的上传文件
        return {
          inputs: taskInputs,
          files: [],
          source: 'batch' as TaskSource,
          thumbnails: imagesByRow[i].thumbnails,
          previews: imagesByRow[i].previews,
        }
      })
      enqueueTasks(batchTasks)
    }
    catch (error) {
      notify({ type: 'error', message: t('app.generation.errorMsg.batchImageUploadFailed', { name: (error as Error).message }) })
    }
    finally {
      isPreparingBatchRef.current = false
      setIsPreparingBatch(false)
    }
  }

  const handleCompleted = (completionRes: string, taskId?: number, isSuccess?: boolean, failureReason?: string) => {
    if (taskId === undefined)
      return
    const latestTaskList = getLatestTaskList()
    // 用 sendToken 匹配任务：清空历史后编号会重新计数，用 id 匹配可能串到新任务上
    const task = latestTaskList.find(item => item.sendToken === taskId)
    // 已完成的任务不再重复写入（重试中的失败任务允许更新结果）
    if (!task || task.status === TaskStatus.completed)
      return
    setBatchCompletionRes({
      ...getBatchCompletionRes(),
      [`${task.id}`]: completionRes,
    })
    setAllTaskList(latestTaskList.map(item => item.sendToken === taskId
      ? {
          ...item,
          status: isSuccess ? TaskStatus.completed : TaskStatus.failed,
          failureReason: isSuccess ? undefined : failureReason,
        }
      : item))
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
      isCallBatchAPI={Boolean(task)}
      isPC={isPC}
      isMobile={isMobile}
      isError={task?.status === TaskStatus.failed}
      promptConfig={promptConfig}
      inputs={task ? task.params.inputs : inputs}
      // 只有调度器已启动的任务才发送；展开已完成任务时不应重放请求。
      controlSend={task && task.status === TaskStatus.running && task.sendToken > 0 ? task.sendToken : undefined}
      controlRetry={task?.retryToken ?? 0}
      initialContent={task ? getBatchCompletionRes()[`${task.id}`] : undefined}
      onShowRes={showResSidebar}
      taskId={task?.id}
      runKey={task?.sendToken}
      onCompleted={handleCompleted}
      visionConfig={visionConfig}
      completionFiles={task?.params.files ?? completionFiles}
    />
  )

  const statusText = (status: TaskStatus) => ({
    [TaskStatus.pending]: t('app.generation.history.statusPending'),
    [TaskStatus.running]: t('app.generation.history.statusRunning'),
    [TaskStatus.completed]: t('app.generation.history.statusCompleted'),
    [TaskStatus.failed]: t('app.generation.history.statusFailed'),
  })[status]

  const statusClassName = (status: TaskStatus) => ({
    [TaskStatus.pending]: 'bg-gray-100 text-gray-600',
    [TaskStatus.running]: 'bg-[#EAF2FF] text-[#155EEF]',
    [TaskStatus.completed]: 'bg-[#ECFDF3] text-[#027A48]',
    [TaskStatus.failed]: 'bg-[#FEF3F2] text-[#B42318]',
  })[status]

  const renderTaskRow = (task: Task) => {
    const isExpanded = expandedTaskIds.includes(task.id)
    const thumbnails = task.thumbnails || []
    return (
      <div
        key={`${task.id}-${task.sendToken}`}
        className={cn(
          'mb-3 rounded-xl border p-3',
          task.status === TaskStatus.failed ? 'border-[#FECDCA] bg-[#FEF3F2]/40' : 'border-gray-200 bg-white',
        )}
      >
        <button
          type='button'
          onClick={() => toggleTaskExpanded(task.id)}
          className='w-full rounded-lg px-2 py-1 text-left hover:bg-gray-50'
        >
          <div className='flex items-center justify-between gap-3'>
            <div className='flex min-w-0 items-center gap-3'>
              {thumbnails.length > 0
                ? (
                  <div className='relative shrink-0'>
                    <img
                      src={thumbnails[0]}
                      alt=''
                      className='h-11 w-11 rounded-md border border-gray-200 bg-gray-50 object-cover cursor-zoom-in'
                      onClick={(event) => {
                        event.stopPropagation()
                        openTaskImages(task)
                      }}
                    />
                    {(task.screenshotCount || 0) > 1 && (
                      <span className='pointer-events-none absolute -bottom-1 -right-1 rounded-full bg-gray-800/80 px-1 text-[10px] font-medium text-white'>
                        {task.screenshotCount}
                      </span>
                    )}
                  </div>
                )
                : (
                  <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-[10px] leading-tight text-gray-400'>
                    {t('app.generation.history.noThumbnail')}
                  </div>
                )}
              <div className='min-w-0'>
                <div className='truncate text-sm font-medium text-gray-800'>
                  {t('app.generation.history.customerId')}：{task.customerId || '-'}
                </div>
                <div className='mt-0.5 flex min-w-0 items-center gap-2 text-xs text-gray-500'>
                  <span className='shrink-0'>#{task.id}</span>
                  <span className='shrink-0'>{t('app.generation.history.screenshotCount', { count: task.screenshotCount || 0 })}</span>
                  <span className='shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-gray-600'>
                    {task.source === 'batch' ? t('app.generation.history.sourceBatch') : t('app.generation.history.sourceCreate')}
                  </span>
                </div>
              </div>
            </div>
            <div className='flex shrink-0 items-center gap-2'>
              <span className='text-xs text-gray-400'>{formatTaskTime(task.createdAt)}</span>
              <span className={cn('rounded px-1.5 py-0.5 text-xs', statusClassName(task.status))}>{statusText(task.status)}</span>
              <ChevronRightIcon className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', isExpanded && 'rotate-90')} />
            </div>
          </div>
        </button>
        <div className={cn('pr-1', !isExpanded && 'hidden')}>
            {task.status === TaskStatus.pending
              ? <div className='text-xs text-gray-500'>{t('app.generation.history.pendingHint')}</div>
              : renderRes(task)}
            {(task.status === TaskStatus.failed && task.failureReason) && (
              <div className='mt-1 text-xs text-[#B42318]'>{task.failureReason}</div>
            )}
        </div>
      </div>
    )
  }

  // 右侧任务倒序排列（最新在最上）
  const renderHistoryRes = () => [...allTaskList].reverse().map(task => renderTaskRow(task))

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
        <div className='shrink-0 flex items-center justify-between mb-4'>
          <div className='flex items-center space-x-3'>
            <div className={s.starIcon}></div>
            <div className='text-lg text-gray-800 font-semibold'>{t('app.generation.title')}</div>
          </div>
          <div className='flex items-center space-x-2'>
            {allTaskList.length > 0 && (
              <span className='text-xs text-gray-500'>
                {t('app.generation.history.summary', { total: allTaskList.length, running: runningTaskList.length + pendingTaskList.length })}
              </span>
            )}
            {allTaskList.length > 0 && (
              <Button
                className='!h-8 !px-3'
                onClick={handleClearHistory}
              >{t('app.generation.history.clear')}</Button>
            )}
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
          {isCallBatchAPI ? renderHistoryRes() : renderRes()}
        </div>
        {previewImages.length > 0 && (
          <ImagePreview
            url={previewImages[0]}
            urls={previewImages}
            onCancel={() => setPreviewImages([])}
          />
        )}
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
                onSend={handleRunOnce}
                isSending={isPreparingBatch}
                resetToken={resetFormToken}
                submitHintToken={submitHintToken}
                onPreviewsChange={setFormPreviews}
                visionConfig={visionConfig}
                onVisionFilesChange={setCompletionFiles}
              />
            </div>
            {isInBatchTab && (
              <RunBatch
                onSend={handleRunBatch}
                isAllFinished={!isPreparingBatch && allTaskRuned}
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
