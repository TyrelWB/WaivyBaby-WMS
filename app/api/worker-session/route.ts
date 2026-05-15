import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function GET() {
  const cookieStore = await cookies()
  const raw = cookieStore.get('wms_worker_session')
  if (!raw) return NextResponse.json(null, { status: 401 })
  try {
    return NextResponse.json(JSON.parse(raw.value))
  } catch {
    return NextResponse.json(null, { status: 401 })
  }
}
