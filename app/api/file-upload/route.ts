import { type NextRequest } from 'next/server'
import { client, getInfo } from '@/app/api/utils/common'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File))
      return Response.json({ message: 'Missing image file' }, { status: 400 })

    const { user } = getInfo(request)
    formData.append('user', user)
    const res = await client.fileUpload(formData)
    return new Response(res.data.id, { status: 200 })
  }
  catch (e: any) {
    console.error('Image upload failed:', e)
    return Response.json(
      { message: e?.message || 'Image upload failed' },
      { status: e?.status || e?.response?.status || 502 },
    )
  }
}
