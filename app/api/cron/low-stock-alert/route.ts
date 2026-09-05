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

  // Get all orgs with low stock
  const { data: orgs } = await admin.from('organizations').select('id, name')
  if (!orgs || orgs.length === 0) return NextResponse.json({ ok: true, message: 'No orgs' })

  const resend = new Resend(resendKey)
  const results: { org: string; sent: boolean; lowCount: number }[] = []

  for (const org of orgs) {
    const { data: inventory } = await admin
      .from('inventory')
      .select('qty_available, products(name, sku, reorder_point)')
      .eq('org_id', org.id)

    const lowItems = (inventory || []).filter((i: any) => {
      const rp = i.products?.reorder_point ?? 0
      return rp > 0 && i.qty_available <= rp
    }) as any[]

    if (lowItems.length === 0) {
      results.push({ org: org.name, sent: false, lowCount: 0 })
      continue
    }

    const tableRows = lowItems
      .sort((a: any, b: any) => a.qty_available - b.qty_available)
      .map((i: any) => `
        <tr style="border-bottom: 1px solid #f3f4f6;">
          <td style="padding: 10px 16px; font-weight: 500; color: #111827;">${i.products?.name ?? '—'}</td>
          <td style="padding: 10px 16px; font-family: monospace; color: #6b7280;">${i.products?.sku ?? '—'}</td>
          <td style="padding: 10px 16px; text-align: right; font-weight: bold; color: ${i.qty_available <= 0 ? '#dc2626' : '#ea580c'};">${i.qty_available}</td>
          <td style="padding: 10px 16px; text-align: right; color: #6b7280;">${i.products?.reorder_point ?? 0}</td>
        </tr>
      `).join('')

    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8" /></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 32px 16px;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
          <div style="background: #1e293b; padding: 24px 32px;">
            <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 700;">⚠️ Low Stock Alert</h1>
            <p style="color: #94a3b8; margin: 4px 0 0; font-size: 14px;">${org.name} · ${lowItems.length} SKU${lowItems.length !== 1 ? 's' : ''} need restocking</p>
          </div>
          <div style="padding: 24px 32px;">
            <p style="color: #374151; font-size: 14px; margin: 0 0 20px;">The following products are at or below their reorder point:</p>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <thead>
                <tr style="background: #f9fafb;">
                  <th style="padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">Product</th>
                  <th style="padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">SKU</th>
                  <th style="padding: 10px 16px; text-align: right; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">Available</th>
                  <th style="padding: 10px 16px; text-align: right; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">Reorder @</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
          <div style="padding: 20px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">
              Sent by Waivy WMS · <a href="${process.env.NEXT_PUBLIC_APP_URL}/inventory" style="color: #3b82f6;">View inventory</a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `

    const { error } = await resend.emails.send({
      from: 'WMS Alerts <alerts@waivybaby.com>',
      to: alertEmail,
      subject: `⚠️ Low Stock: ${lowItems.length} SKU${lowItems.length !== 1 ? 's' : ''} need restocking`,
      html,
    })

    results.push({ org: org.name, sent: !error, lowCount: lowItems.length })
  }

  return NextResponse.json({ ok: true, results })
}
