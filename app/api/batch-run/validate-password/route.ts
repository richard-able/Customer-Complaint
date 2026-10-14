import { timingSafeEqual } from 'node:crypto'

const DEFAULT_BATCH_RUN_PASSWORD = 'Mate2077'

export async function POST(request: Request) {
  let password: unknown
  try {
    const body = await request.json()
    password = body?.password
  }
  catch {
    return Response.json({ message: 'Invalid request' }, { status: 400 })
  }

  const expectedPassword = process.env.BATCH_RUN_PASSWORD || DEFAULT_BATCH_RUN_PASSWORD
  if (typeof password !== 'string')
    return Response.json({ message: 'Invalid password' }, { status: 401 })

  const provided = Buffer.from(password)
  const expected = Buffer.from(expectedPassword)
  const isValid = provided.length === expected.length && timingSafeEqual(provided, expected)
  if (!isValid)
    return Response.json({ message: 'Invalid password' }, { status: 401 })

  return Response.json({ valid: true })
}
