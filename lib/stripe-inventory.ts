import Stripe from 'stripe'
import { createAdminClient } from './supabase/admin'

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!)
}

// Create Stripe products from WMS products and store stripe_product_id on each
export async function syncWmsProductsToStripe(orgId: string): Promise<{
  created: number
  updated: number
  errors: string[]
}> {
  const stripe = getStripe()
  const admin = createAdminClient()

  const { data: products } = await admin
    .from('products')
    .select('id, name, sku, price, is_sub_product, stripe_product_id, inventory(qty_available)')
    .eq('org_id', orgId)
    .eq('is_sub_product', false)

  if (!products?.length) return { created: 0, updated: 0, errors: [] }

  let created = 0
  let updated = 0
  const errors: string[] = []

  for (const p of products) {
    const qty = (p.inventory as any)?.[0]?.qty_available ?? 0
    const priceInCents = Math.round((p.price || 0) * 100)

    try {
      if (p.stripe_product_id) {
        // Update existing Stripe product stock
        await stripe.products.update(p.stripe_product_id, {
          metadata: { wms_sku: p.sku, stock: String(qty) },
        })
        updated++
      } else {
        // Create new Stripe product + price
        const stripeProduct = await stripe.products.create({
          name: p.name,
          metadata: { wms_sku: p.sku, wms_id: p.id, stock: String(qty) },
        })

        if (priceInCents > 0) {
          await stripe.prices.create({
            product: stripeProduct.id,
            unit_amount: priceInCents,
            currency: 'usd',
          })
        }

        await admin.from('products').update({ stripe_product_id: stripeProduct.id }).eq('id', p.id)
        created++
      }
    } catch (e: any) {
      errors.push(`${p.name}: ${e.message}`)
    }
  }

  return { created, updated, errors }
}

// Push a single product's stock to Stripe
export async function pushStockToStripe(productId: string, qty: number): Promise<void> {
  const stripe = getStripe()
  const admin = createAdminClient()

  const { data: product } = await admin
    .from('products')
    .select('stripe_product_id, name, sku')
    .eq('id', productId)
    .single()

  if (!product?.stripe_product_id) return

  await stripe.products.update(product.stripe_product_id, {
    metadata: { wms_sku: product.sku, stock: String(qty) },
  })
}
