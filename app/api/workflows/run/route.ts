import { type NextRequest } from 'next/server'
import { getInfo } from '@/app/api/utils/common'
import { API_KEY, API_URL } from '@/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const {
    inputs,
    files,
  } = body
  const { user } = getInfo(request)
  const upstream = await fetch(`${API_URL.replace(/\/$/, '')}/workflows/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      inputs,
      user,
      response_mode: 'streaming',
      ...(files?.length ? { files } : {}),
    }),
    cache: 'no-store',
    signal: request.signal,
  })

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
