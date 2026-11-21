import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Resend } from 'resend'

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const querySecret = new URL(req.url).searchParams.get('secret')
  const ok = auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.WMS_CRON_SECRET
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const resendKey = process.env.RESEND_API_KEY
  const alertEmail = process.env.ALERT_EMAIL
  if (!resendKey || !alertEmail) {
    return NextResponse.json({ error: 'RESEND_API_KEY and ALERT_EMAIL env vars required' }, { status: 500 })
  }

  const admin = createAdminClient()
  const { data: orgs } = await admin.from('organizations').select('id, name')
  if (!orgs || orgs.length === 0) return NextResponse.json({ ok: true, message: 'No orgs' })

  const resend = new Resend(resendKey)

  // Start of today in UTC
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const since = todayStart.toISOString()

  for (const org of orgs) {
    const [shippedRes, pickedRes, packedRes, exceptionsRes, inProgressRes, workersRes] = await Promise.all([
      admin.from('orders').select('id, order_number, customer_name, assigned_shipper_id, workers!orders_assigned_shipper_id_fkey(name)')
        .eq('org_id', org.id).eq('status', 'shipped').gte('shipped_at', since),
      admin.from('orders').select('id', { count: 'exact', head: true })
        .eq('org_id', org.id).gte('pick_completed_at', since),
      admin.from('orders').select('id', { count: 'exact', head: true })
        .eq('org_id', org.id).gte('packed_at', since),
      admin.from('order_items').select('id', { count: 'exact', head: true })
        .eq('org_id', org.id).eq('status', 'short').gte('updated_at', since),
      admin.from('orders').select('id, order_number, customer_name, status')
        .eq('org_id', org.id).in('status', ['assigned', 'picking', 'packing', 'shipping']),
      admin.from('workers').select('id, name, role')
        .eq('org_id', org.id).eq('is_active', true),
    ])

    const shipped = shippedRes.data || []
    const pickedCount = pickedRes.count ?? 0
    const packedCount = packedRes.count ?? 0
    const exceptionsCount = exceptionsRes.count ?? 0
    const inProgress = inProgressRes.data || []

    // Worker productivity for today
    const [pickerStatsRes, packerStatsRes, shipperStatsRes] = await Promise.all([
      admin.from('orders').select('assigned_picker_id, pick_started_at, pick_completed_at')
        .eq('org_id', org.id).gte('pick_completed_at', since).not('assigned_picker_id', 'is', null),
      admin.from('orders').select('assigned_packer_id')
        .eq('org_id', org.id).gte('packed_at', since).not('assigned_packer_id', 'is', null),
      admin.from('orders').select('assigned_shipper_id')
        .eq('org_id', org.id).gte('shipped_at', since).not('assigned_shipper_id', 'is', null),
    ])

    const workers = (workersRes.data || []) as { id: string; name: string; role: string }[]
    const pickerStats = pickerStatsRes.data || []
    const packerStats = packerStatsRes.data || []
    const shipperStats = shipperStatsRes.data || []

    const workerRows = workers
      .map(w => {
        const picks = pickerStats.filter((o: any) => o.assigned_picker_id === w.id)
        const packs = packerStats.filter((o: any) => o.assigned_packer_id === w.id)
        const ships = shipperStats.filter((o: any) => o.assigned_shipper_id === w.id)
        const total = picks.length + packs.length + ships.length
        return { ...w, picks: picks.length, packs: packs.length, ships: ships.length, total }
      })
      .filter(w => w.total > 0)
      .sort((a, b) => b.total - a.total)

    const roleColor: Record<string, string> = {
      picker: '#2563eb', packer: '#7c3aed', shipper: '#ea580c', inventory: '#16a34a', all: '#374151',
    }

    const shippedRows = shipped.slice(0, 20).map((o: any) => `
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 8px 16px; font-family: monospace; color: #6b7280; font-size: 12px;">#${o.order_number}</td>
        <td style="padding: 8px 16px; color: #111827; font-size: 13px;">${o.customer_name || '—'}</td>
        <td style="padding: 8px 16px; color: #6b7280; font-size: 12px;">${(o.workers as any)?.name ?? '—'}</td>
      </tr>
    `).join('')

    const workerTableRows = workerRows.map(w => `
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 8px 16px; font-weight: 500; color: #111827; font-size: 13px;">${w.name}</td>
        <td style="padding: 8px 16px; font-size: 11px;">
          <span style="background: #eff6ff; color: #2563eb; padding: 2px 8px; border-radius: 9999px; font-weight: 600; text-transform: capitalize;">${w.role}</span>
        </td>
        <td style="padding: 8px 16px; text-align: center; font-weight: bold; color: ${w.picks > 0 ? '#2563eb' : '#d1d5db'};">${w.picks}</td>
        <td style="padding: 8px 16px; text-align: center; font-weight: bold; color: ${w.packs > 0 ? '#7c3aed' : '#d1d5db'};">${w.packs}</td>
        <td style="padding: 8px 16px; text-align: center; font-weight: bold; color: ${w.ships > 0 ? '#ea580c' : '#d1d5db'};">${w.ships}</td>
      </tr>
    `).join('')

    const inProgressSection = inProgress.length > 0 ? `
      <div style="padding: 16px 32px; background: #fffbeb; border-top: 1px solid #fde68a;">
        <p style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #92400e;">⚠️ ${inProgress.length} order${inProgress.length !== 1 ? 's' : ''} still in progress</p>
        <p style="margin: 0; font-size: 12px; color: #b45309;">${inProgress.map((o: any) => `#${o.order_number} (${o.status})`).join(' · ')}</p>
      </div>
    ` : ''

    const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8" /></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 32px 16px;">
        <div style="max-width: 620px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">

          <!-- Header -->
          <div style="background: #0f172a; padding: 24px 32px;">
            <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 700;">📦 Daily Summary</h1>
            <p style="color: #94a3b8; margin: 4px 0 0; font-size: 14px;">${org.name} · ${date}</p>
          </div>

          <!-- Stats strip -->
          <div style="display: flex; border-bottom: 1px solid #e5e7eb;">
            <div style="flex: 1; padding: 20px 24px; text-align: center; border-right: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 32px; font-weight: 800; color: #ea580c;">${shipped.length}</p>
              <p style="margin: 4px 0 0; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em;">Shipped</p>
            </div>
            <div style="flex: 1; padding: 20px 24px; text-align: center; border-right: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 32px; font-weight: 800; color: #7c3aed;">${packedCount}</p>
              <p style="margin: 4px 0 0; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em;">Packed</p>
            </div>
            <div style="flex: 1; padding: 20px 24px; text-align: center; border-right: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 32px; font-weight: 800; color: #2563eb;">${pickedCount}</p>
              <p style="margin: 4px 0 0; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em;">Picked</p>
            </div>
            <div style="flex: 1; padding: 20px 24px; text-align: center;">
              <p style="margin: 0; font-size: 32px; font-weight: 800; color: ${exceptionsCount > 0 ? '#dc2626' : '#d1d5db'};">${exceptionsCount}</p>
              <p style="margin: 4px 0 0; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em;">Exceptions</p>
            </div>
          </div>

          ${workerRows.length > 0 ? `
          <!-- Worker productivity -->
          <div style="padding: 24px 32px; border-bottom: 1px solid #e5e7eb;">
            <h2 style="margin: 0 0 16px; font-size: 14px; font-weight: 700; color: #111827; text-transform: uppercase; letter-spacing: 0.05em;">Worker Productivity</h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
              <thead>
                <tr style="background: #f9fafb;">
                  <th style="padding: 8px 16px; text-align: left; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase;">Worker</th>
                  <th style="padding: 8px 16px; text-align: left; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase;">Role</th>
                  <th style="padding: 8px 16px; text-align: center; font-size: 11px; font-weight: 600; color: #2563eb; text-transform: uppercase;">Picked</th>
                  <th style="padding: 8px 16px; text-align: center; font-size: 11px; font-weight: 600; color: #7c3aed; text-transform: uppercase;">Packed</th>
                  <th style="padding: 8px 16px; text-align: center; font-size: 11px; font-weight: 600; color: #ea580c; text-transform: uppercase;">Shipped</th>
                </tr>
              </thead>
              <tbody>${workerTableRows}</tbody>
            </table>
          </div>
          ` : ''}

          ${shipped.length > 0 ? `
          <!-- Shipped orders -->
          <div style="padding: 24px 32px; border-bottom: 1px solid #e5e7eb;">
            <h2 style="margin: 0 0 16px; font-size: 14px; font-weight: 700; color: #111827; text-transform: uppercase; letter-spacing: 0.05em;">Shipped Orders${shipped.length > 20 ? ` (first 20 of ${shipped.length})` : ''}</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="background: #f9fafb;">
                  <th style="padding: 8px 16px; text-align: left; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase;">Order</th>
                  <th style="padding: 8px 16px; text-align: left; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase;">Customer</th>
                  <th style="padding: 8px 16px; text-align: left; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase;">Shipped by</th>
                </tr>
              </thead>
              <tbody>${shippedRows}</tbody>
            </table>
          </div>
          ` : ''}

          ${inProgressSection}

          <!-- Footer -->
          <div style="padding: 16px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">
              Sent by Waivy WMS ·
              <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="color: #3b82f6;">Open dashboard</a>
              &nbsp;·&nbsp;
              <a href="${process.env.NEXT_PUBLIC_APP_URL}/orders" style="color: #3b82f6;">View orders</a>
            </p>
          </div>

        </div>
      </body>
      </html>
    `

    await resend.emails.send({
      from: 'WMS Reports <reports@waivybaby.com>',
      to: alertEmail,
      subject: `📦 Daily Summary: ${shipped.length} shipped · ${org.name} · ${date}`,
      html,
    })
  }

  return NextResponse.json({ ok: true })
}
