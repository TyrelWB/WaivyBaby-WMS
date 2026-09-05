'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

export type WorkerTask = 'pick' | 'pack' | 'ship' | 'receive'

const HEARTBEAT_INTERVAL_MS = 25_000

// A worker counts as "online" for a task if their heartbeat landed within this window.
export const ONLINE_WINDOW_MS = 2 * 60 * 1000

// Marks a worker as actively on a given task page while mounted, via a periodic
// heartbeat. Other workers can then query `workers.active_task` / `last_active_at`
// to decide routing (e.g. "is anyone online as a packer right now?").
export function useWorkerHeartbeat(workerId: string | undefined, task: WorkerTask) {
  const taskRef = useRef(task)
  taskRef.current = task

  useEffect(() => {
    if (!workerId) return
    const supabase = createClient()
    let cancelled = false

    async function beat() {
      if (cancelled) return
      await supabase.from('workers').update({
        active_task: taskRef.current,
        last_active_at: new Date().toISOString(),
      }).eq('id', workerId)
    }

    beat()
    const interval = setInterval(beat, HEARTBEAT_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
      supabase.from('workers').update({ active_task: null }).eq('id', workerId).then(() => {})
    }
  }, [workerId])
}
