import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'

async function getOrgId(): Promise<string | null> {
  const admin = createAdminClient()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data } = await admin.from('admin_users').select('org_id').eq('id', user.id).single()
    return data?.org_id || null
  }
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get('wms_worker_session')?.value
  if (sessionToken) {
    const { data } = await admin.from('worker_sessions').select('org_id').eq('token', sessionToken).eq('is_active', true).single()
    return data?.org_id || null
  }
  return null
}

export async function GET() {
  const orgId = await getOrgId()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Get all tasks
  const { data: tasks, error } = await admin
    .from('cleaning_tasks')
    .select('*')
    .eq('org_id', orgId)
    .order('frequency')
    .order('area')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Get today's completions
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - today.getDay())
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

  const { data: completions } = await admin
    .from('cleaning_completions')
    .select('task_id, completed_by, completed_at')
    .eq('org_id', orgId)
    .gte('completed_at', monthStart.toISOString())

  const taskList = (tasks || []).map(task => {
    const taskCompletions = (completions || []).filter(c => c.task_id === task.id)
    let isDone = false
    let lastCompletion = null

    if (task.frequency === 'daily') {
      const todayCompletion = taskCompletions.find(c => new Date(c.completed_at) >= today)
      isDone = !!todayCompletion
      lastCompletion = todayCompletion
    } else if (task.frequency === 'weekly') {
      const weekCompletion = taskCompletions.find(c => new Date(c.completed_at) >= weekStart)
      isDone = !!weekCompletion
      lastCompletion = weekCompletion
    } else if (task.frequency === 'monthly') {
      const monthCompletion = taskCompletions.find(c => new Date(c.completed_at) >= monthStart)
      isDone = !!monthCompletion
      lastCompletion = monthCompletion
    }

    return { ...task, is_done: isDone, last_completion: lastCompletion }
  })

  return NextResponse.json(taskList)
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action, task_id, title, description, frequency, area, completed_by, notes } = body

  const admin = createAdminClient()

  // Complete a task
  if (action === 'complete') {
    const { data, error } = await admin.from('cleaning_completions').insert({
      org_id: orgId,
      task_id,
      completed_by: completed_by?.trim() || null,
      notes: notes?.trim() || null,
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // Create a new task
  if (!title?.trim()) return NextResponse.json({ error: 'Title required' }, { status: 400 })
  const { data, error } = await admin.from('cleaning_tasks').insert({
    org_id: orgId,
    title: title.trim(),
    description: description?.trim() || null,
    frequency: frequency || 'daily',
    area: area?.trim() || null,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
