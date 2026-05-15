import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function WorkerLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const session = cookieStore.get('wms_worker_session')
  if (!session) redirect('/worker')

  return (
    <div className="min-h-screen bg-gray-950">
      {children}
    </div>
  )
}
