import { type NextRequest } from 'next/server'
import { API_KEY, API_URL, APP_ID } from '@/config'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

const encoder = new TextEncoder()
const streamPadding = `: connected ${' '.repeat(2048)}\n\n`

export async function POST(request: NextRequest) {
  const body = await request.json()
  const {
    inputs,
    files,
  } = body
  const sessionId = request.cookies.get('session_id')?.value || crypto.randomUUID()
  const user = `user_${APP_ID}:${sessionId}`
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

  if (!upstream.ok || !upstream.body) {
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  }

  const reader = upstream.body.getReader()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(streamPadding))
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(': heartbeat\n\n'))
      }, 10_000)

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done)
            break
          controller.enqueue(value)
        }
        controller.close()
      }
      catch (error) {
        controller.error(error)
      }
      finally {
        clearInterval(heartbeat)
      }
    },
    cancel() {
      return reader.cancel()
    },
  })

  return new Response(stream, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Encoding': 'none',
      'X-Accel-Buffering': 'no',
    },
  })
}
