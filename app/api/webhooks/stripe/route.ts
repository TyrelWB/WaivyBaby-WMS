import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncBundlesUsingSubProduct } from '@/lib/wix-inventory'
import { pushStockToStripe } from '@/lib/stripe-inventory'

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature')
  const body = await req.text()

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig!, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (e: any) {
    return NextResponse.json({ error: `Webhook signature failed: ${e.message}` }, { status: 400 })
  }

  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ received: true })
  }

  const session = event.data.object as Stripe.Checkout.Session
  const admin = createAdminClient()

  // Get org
  const { data: org } = await admin.from('admin_users').select('org_id').limit(1).single()
  if (!org) return NextResponse.json({ error: 'No org found' }, { status: 500 })

  // Fetch line items from the session
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { expand: ['data.price.product'] })

  for (const item of lineItems.data) {
    const stripeProduct = item.price?.product as Stripe.Product | null
    if (!stripeProduct || typeof stripeProduct === 'string') continue

    const qty = item.quantity || 1
    const stripeProductId = stripeProduct.id

    // Find matching WMS product
    const { data: product } = await admin
      .from('products')
      .select('id, sku, name')
      .eq('org_id', org.org_id)
      .eq('stripe_product_id', stripeProductId)
      .single()

    if (!product) continue

    // Deduct inventory
    const { data: inv } = await admin
      .from('inventory')
      .select('qty_on_hand, qty_available')
      .eq('product_id', product.id)
      .single()

    const newQty = Math.max(0, (inv?.qty_on_hand ?? 0) - qty)
    const newAvailable = Math.max(0, (inv?.qty_available ?? 0) - qty)

    await admin
      .from('inventory')
      .update({ qty_on_hand: newQty, qty_available: newAvailable, updated_at: new Date().toISOString() })
      .eq('product_id', product.id)

    // Push updated stock back to Stripe metadata
    await pushStockToStripe(product.id, newAvailable).catch(() => {})

    // Cascade to parent bundles if this is a sub-product
    syncBundlesUsingSubProduct(product.id, org.org_id).catch(() => {})

    await admin.from('sync_logs').insert({
      org_id: org.org_id,
      provider: 'stripe',
      event_type: 'inventory_update',
      status: 'success',
      reference_type: 'product',
      reference_id: product.id,
      payload: { stripeProductId, sku: product.sku, qty_deducted: qty, new_qty: newAvailable },
    })
  }

  return NextResponse.json({ received: true })
}
