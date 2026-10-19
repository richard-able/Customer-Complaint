'use client'
import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import { useBoolean } from 'ahooks'
import { t } from 'i18next'
import produce from 'immer'
import cn from 'classnames'
import NoData from '../no-data'
import TextGenerationRes from './item'
import Toast from '@/app/components/base/toast'
import { sendCompletionMessage, sendWorkflowMessage, updateFeedback } from '@/service'
import type { Feedbacktype, PromptConfig, VisionFile, VisionSettings, WorkflowProcess } from '@/types/app'
import { NodeRunningStatus, TransferMethod, WorkflowRunningStatus } from '@/types/app'
import Loading from '@/app/components/base/loading'
import { sleep } from '@/utils'

export type IResultProps = {
  isWorkflow: boolean
  isCallBatchAPI: boolean
  isPC: boolean
  isMobile: boolean
  isError: boolean
  promptConfig: PromptConfig | null
  inputs: Record<string, any>
  controlSend?: number
  controlRetry?: number
  controlStopResponding?: number
  initialContent?: string
  onShowRes: () => void
  taskId?: number
  /** 任务的唯一标识（sendToken），用于回写结果；taskId 只用于展示编号 */
  runKey?: number
  onCompleted: (completionRes: string, taskId?: number, success?: boolean, failureReason?: string) => void
  onResponsingChange?: (isResponsing: boolean, taskId?: number) => void
  visionConfig: VisionSettings
  completionFiles: VisionFile[]
}

const Result: FC<IResultProps> = ({
  isWorkflow,
  isCallBatchAPI,
  isPC,
  isMobile,
  isError,
  promptConfig,
  inputs,
  controlSend,
  controlRetry,
  controlStopResponding,
  initialContent,
  onShowRes,
  taskId,
  runKey,
  onCompleted,
  onResponsingChange,
  visionConfig,
  completionFiles,
}) => {
  const [isResponsing, { setTrue: setResponsingTrue, setFalse: setResponsingFalse }] = useBoolean(false)
  // 结果回写用 runKey（唯一）；没有时退回 taskId，兼容旧调用
  const completionKey = runKey ?? taskId
  const lastControlSendRef = useRef<number | undefined>(undefined)
  const lastControlRetryRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (controlStopResponding) {
      setResponsingFalse()
      onResponsingChange?.(false, taskId)
    }
  }, [controlStopResponding, onResponsingChange, taskId])

  const [completionRes, doSetCompletionRes] = useState(initialContent || '')
  const completionResRef = useRef(initialContent || '')
  const setCompletionRes = (res: string) => {
    completionResRef.current = res
    doSetCompletionRes(res)
  }
  const getCompletionRes = () => completionResRef.current
  const [workflowProcessData, doSetWorkflowProccessData] = useState<WorkflowProcess>()
  const workflowProcessDataRef = useRef<WorkflowProcess>()
  const setWorkflowProccessData = (data: WorkflowProcess) => {
    workflowProcessDataRef.current = data
    doSetWorkflowProccessData(data)
  }
  const getWorkflowProccessData = () => workflowProcessDataRef.current

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
    // batch will check outer
    if (isCallBatchAPI)
      return true

    if (completionFiles.find(item => item.transfer_method === TransferMethod.local_file && !item.upload_file_id)) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForImgUpload') })
      return false
    }

    const prompt_variables = promptConfig?.prompt_variables
    if (!prompt_variables || prompt_variables?.length === 0)
      return true

    let hasEmptyInput = ''
    const requiredVars = prompt_variables?.filter(({ key, name, required }) => {
      const res = (!key || !key.trim()) || (!name || !name.trim()) || (required || required === undefined || required === null)
      return res
    }) || [] // compatible with old version
    requiredVars.forEach(({ key, name }) => {
      if (hasEmptyInput)
        return

      const value = inputs[key]
      if (!value || (Array.isArray(value) && value.length === 0))
        hasEmptyInput = name
    })

    if (hasEmptyInput) {
      logError(t('appDebug.errorMessage.valueOfVarRequired', { key: hasEmptyInput }))
      return false
    }
    if (prompt_variables.some(({ type, key }) => type === 'file-list' && (inputs[key] || []).some((file: VisionFile) => file.transfer_method === TransferMethod.local_file && !file.upload_file_id))) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForImgUpload') })
      return false
    }
    return !hasEmptyInput
  }

  const handleSend = async () => {
    if (isResponsing) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForResponse') })
      return false
    }

    if (!checkCanSend())
      return

    const data: Record<string, any> = {
      inputs,
    }
    if (visionConfig.enabled && completionFiles && completionFiles?.length > 0) {
      data.files = completionFiles.map((item) => {
        if (item.transfer_method === TransferMethod.local_file) {
          return {
            ...item,
            url: '',
          }
        }
        return item
      })
    }

    setMessageId(null)
    setFeedback({
      rating: null,
    })
    setCompletionRes('')
    workflowProcessDataRef.current = undefined
    doSetWorkflowProccessData(undefined)

    const res: string[] = []
    let tempMessageId = ''

    if (!isPC)
      onShowRes()

    setResponsingTrue()
    onResponsingChange?.(true, taskId)
    let isEnd = false
    let isTimeout = false;
    (async () => {
      await sleep(5 * 60 * 1000) // 5min timeout
      if (!isEnd) {
        setResponsingFalse()
        onResponsingChange?.(false, taskId)
        onCompleted(getCompletionRes(), completionKey, false, '任务超时（超过 5 分钟）')
        isTimeout = true
      }
    })()

    if (isWorkflow) {
      sendWorkflowMessage(
        data,
        {
          onWorkflowStarted: ({ workflow_run_id }) => {
            tempMessageId = workflow_run_id
            setWorkflowProccessData({
              status: WorkflowRunningStatus.Running,
              tracing: [],
              expand: false,
            })
          },
          onNodeStarted: ({ data }) => {
            setWorkflowProccessData(produce(getWorkflowProccessData()!, (draft) => {
              draft.expand = true
              draft.tracing!.push({
                ...data,
                status: NodeRunningStatus.Running,
                expand: true,
              } as any)
            }))
          },
          onNodeFinished: ({ data }) => {
            setWorkflowProccessData(produce(getWorkflowProccessData()!, (draft) => {
              const currentIndex = draft.tracing!.findIndex(trace => trace.node_id === data.node_id)
              if (currentIndex > -1 && draft.tracing) {
                draft.tracing[currentIndex] = {
                  ...(draft.tracing[currentIndex].extras
                    ? { extras: draft.tracing[currentIndex].extras }
                    : {}),
                  ...data,
                  expand: !!data.error,
                } as any
              }
            }))
          },
          onWorkflowFinished: ({ data }) => {
            if (isTimeout)
              return
            if (data.error) {
              notify({ type: 'error', message: data.error })
              setResponsingFalse()
              onResponsingChange?.(false, taskId)
              onCompleted(getCompletionRes(), completionKey, false, data.error)
              isEnd = true
              return
            }
            setWorkflowProccessData(produce(getWorkflowProccessData()!, (draft) => {
              draft.status = data.error ? WorkflowRunningStatus.Failed : WorkflowRunningStatus.Succeeded
            }))
            if (!data.outputs)
              setCompletionRes('')
            else if (Object.keys(data.outputs).length > 1)
              setCompletionRes(data.outputs)
            else
              setCompletionRes(data.outputs[Object.keys(data.outputs)[0]])
            setResponsingFalse()
            onResponsingChange?.(false, taskId)
            setMessageId(tempMessageId)
            onCompleted(getCompletionRes(), completionKey, true)
            isEnd = true
          },
          onError: (error) => {
            if (isTimeout)
              return

            setResponsingFalse()
            onResponsingChange?.(false, taskId)
            onCompleted(getCompletionRes(), completionKey, false, error || '工作流请求失败')
            isEnd = true
          },
        },
      )
    }
    else {
      sendCompletionMessage(data, {
        onData: (data: string, _isFirstMessage: boolean, { messageId }) => {
          tempMessageId = messageId
          res.push(data)
          setCompletionRes(res.join(''))
        },
        onCompleted: () => {
          if (isTimeout)
            return

          setResponsingFalse()
          onResponsingChange?.(false, taskId)
          setMessageId(tempMessageId)
          onCompleted(getCompletionRes(), completionKey, true)
          isEnd = true
        },
        onError(error) {
          if (isTimeout)
            return

          setResponsingFalse()
          onResponsingChange?.(false, taskId)
          onCompleted(getCompletionRes(), completionKey, false, error || '流式请求失败')
          isEnd = true
        },
      })
    }
  }

  useEffect(() => {
    if (controlSend && lastControlSendRef.current !== controlSend) {
      lastControlSendRef.current = controlSend
      handleSend()
    }
  }, [controlSend])

  useEffect(() => {
    if (controlRetry && lastControlRetryRef.current !== controlRetry) {
      lastControlRetryRef.current = controlRetry
      handleSend()
    }
  }, [controlRetry])

  const renderTextGenerationRes = () => (
    <TextGenerationRes
      isWorkflow={isWorkflow}
      workflowProcessData={workflowProcessData}
      className='mt-3'
      embedded={isCallBatchAPI}
      isError={isError}
      onRetry={handleSend}
      content={completionRes}
      messageId={messageId}
      isInWebApp
      onFeedback={handleFeedback}
      feedback={feedback}
      isMobile={isMobile}
      // 任务列表模式下，工作流一旦开始就把节点进度显示出来，不要用 loading 把它挡住
      isLoading={isCallBatchAPI ? (!completionRes && isResponsing && !workflowProcessData) : false}
      taskId={isCallBatchAPI ? ((taskId as number) < 10 ? `0${taskId}` : `${taskId}`) : undefined}
    />
  )

  return (
    <div className={cn(isNoData && !isCallBatchAPI && 'h-full')}>
      {!isCallBatchAPI && (
        (isResponsing && !completionRes && !workflowProcessData)
          ? (
            <div className='flex h-full w-full justify-center items-center'>
              <Loading type='area' />
            </div>)
          : (
            <>
              {(isNoData && !workflowProcessData)
                ? <NoData />
                : renderTextGenerationRes()
              }
            </>
          )
      )}
      {isCallBatchAPI && (
        <div className='mt-2'>
          {renderTextGenerationRes()}
        </div>
      )}
    </div>
  )
}
export default React.memo(Result)
