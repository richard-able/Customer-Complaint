import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const cookieName = 'workbench_session'
const sessionSeconds = 8 * 60 * 60
const encoder = new TextEncoder()

function loginPage(error = '') {
  return new NextResponse(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>登录客诉工作台</title>
  <style>
    body { margin: 0; padding: 24px; min-height: 100vh; box-sizing: border-box; display: grid; place-items: center; background: #f5f7fb; color: #172033; font: 16px system-ui, sans-serif; }
    main { width: min(100%, 360px); box-sizing: border-box; padding: 28px; border: 1px solid #dce2ec; border-radius: 12px; background: white; }
    h1 { margin: 0 0 24px; font-size: 22px; }
    label, input, button { display: block; width: 100%; box-sizing: border-box; }
    input, button { margin-top: 8px; padding: 10px; border-radius: 6px; font: inherit; }
    input { border: 1px solid #8994a8; }
    button { margin-top: 16px; border: 0; background: #304ac9; color: white; cursor: pointer; }
    p { margin: 8px 0 0; color: #a61b1b; }
  </style>
</head>
<body>
  <main>
    <h1>登录客诉工作台</h1>
    <form method="post">
      <label for="password">访问密码</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
      ${error ? `<p role="alert">${error}</p>` : ''}
      <button type="submit">登录</button>
    </form>
  </main>
</body>
</html>`, {
    status: error ? 401 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function signingKey(password: string) {
  return crypto.subtle.importKey('raw', encoder.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function middleware(request: NextRequest) {
  const password = process.env.APP_ACCESS_PASSWORD
  const isApi = request.nextUrl.pathname.startsWith('/api/')
  if (!password)
    return new NextResponse('访问密码尚未配置', { status: 503, headers: { 'Cache-Control': 'no-store' } })

  const key = await signingKey(password)
  const token = request.cookies.get(cookieName)?.value || ''
  const match = /^(\d{10})\.([a-f0-9]{64})$/.exec(token)
  const now = Math.floor(Date.now() / 1000)
  if (match && Number(match[1]) > now) {
    const signature = Uint8Array.from(match[2].match(/../g)!, byte => Number.parseInt(byte, 16))
    if (await crypto.subtle.verify('HMAC', key, signature, encoder.encode(`workbench-session:${match[1]}`)))
      return NextResponse.next()
  }

  if (isApi)
    return NextResponse.json({ message: '请先登录' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })

  if (request.method !== 'POST')
    return loginPage()

  const form = await request.formData().catch(() => null)
  const provided = form?.get('password')
  const challenge = encoder.encode('workbench-password-check')
  const expected = await crypto.subtle.sign('HMAC', key, challenge)
  if (typeof provided !== 'string' || !provided || !await crypto.subtle.verify('HMAC', await signingKey(provided), expected, challenge))
    return loginPage('密码不正确')

  const expires = now + sessionSeconds
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`workbench-session:${expires}`))
  const hex = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('')
  const response = NextResponse.redirect(request.nextUrl, 303)
  response.headers.set('Cache-Control', 'no-store')
  response.cookies.set(cookieName, `${expires}.${hex}`, {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https',
    sameSite: 'lax',
    path: request.nextUrl.basePath || '/',
    maxAge: sessionSeconds,
  })
  return response
}

export const config = {
  matcher: ['/((?!_next/static/|_next/image).*)'],
}
