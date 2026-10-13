import type { AppInfo } from '@/types/app'
export const APP_ID = `${process.env.NEXT_PUBLIC_APP_ID}`
// Keep the Dify API key server-side. Never expose it through a NEXT_PUBLIC_* variable.
export const API_KEY = `${process.env.DIFY_API_KEY}`
export const API_URL = `${process.env.NEXT_PUBLIC_API_URL}`
export const IS_WORKFLOW = `${process.env.NEXT_PUBLIC_APP_TYPE_WORKFLOW}` === 'true'
export const APP_INFO: AppInfo = {
  title: '客户投诉分析',
  description: '上传客户聊天截图，获取投诉分析结果。',
  copyright: '',
  privacy_policy: '',
  default_language: 'zh-Hans',
}

export const API_PREFIX = `${process.env.NEXT_PUBLIC_API_PREFIX || '/api'}`

export const LOCALE_COOKIE_NAME = 'locale'

export const DEFAULT_VALUE_MAX_LEN = 48
