import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import sql from '@/lib/db'

const SUB_PRODUCT_NAMES = [
  'Pacifier D/N',
  'Pacifier Regular',
  'Bottle Glass',
  'Bottle Handles',
  'Bottle Cleaner',
  'Bottle Cleaner (Home)',
  'Burp Cloth',
  'Bamboo Muslin Swaddle',
  'Pacifier Holder',
  'Smart Medicine Dispenser',
  'Hooded Bath Towel',
  'Nasal Aspirator',
  'Newborn Hats/Mitts/Footies',
  'Thermometer',
  '0-3 Books',
  '3-6 Books',
  '6-12 Books',
  'Nail Care',
  'Velcro Swaddle',
  'Butt Spatula (MINI)',
  'Butt Spatula (FULL)',
  'Baby Fruit Feeder',
  'Cloth Bibs',
  'Star Blanket',
  'Baby Brush Set',
  'Bamboo Cloth Wash',
  'Finger Toothbrush',
  'Teeth Spoon',
  'Hands Free Bottle',
  'Mirror Toy Active Cube',
  'Baby Carrier',
  'Cloth Books',
  'Teething Mitts',
  'Hands Mitts Bells',
  'Teether Long Oral',
  'Teether Mini Remote',
  'Round Silicone Baby Teether',
  'Teething Toy Remote (Big)',
  'Silicone Teether Round Ball',
  'Teethers Wearable Teether',
  'Baby Velcro 3-6 Zipper',
  'Feeding Bibs',
  'Feeding Cups',
  'Feeding Set',
  'Water Toys',
  'Bath Toy',
  'Bath Sponges',
  'Cloth Learning Book Lux',
  'Building Blocks',
  'Anti-Fall Backpack',
  'Bath Brush',
  'Toy Grasping',
  'Shower Cap',
  'Shampoo Rinse Cup',
  'Crawling Pads',
  'Twist Fruit Feeders',
  'BPA-Free Toothbrush',
  'Luxury Towel',
  'Changing Pad Upgrade',
  'Changing Pad (Cheap)',
  'Plush',
  'Baby Clip',
  'Wipes Holder',
]

function toSku(index: number): string {
  return `WMS-${String(index + 1).padStart(3, '0')}`
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminUser } = await admin.from('admin_users').select('org_id, warehouse_id').eq('id', user.id).single()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { org_id, warehouse_id } = adminUser

  const inserted: string[] = []
  const skipped: string[] = []
  const errors: string[] = []

  for (let i = 0; i < SUB_PRODUCT_NAMES.length; i++) {
    const name = SUB_PRODUCT_NAMES[i]
    const sku = toSku(i)
    try {
      // Check if already exists
      const existing = await sql`
        SELECT id FROM public.products WHERE org_id = ${org_id} AND name = ${name} LIMIT 1
      `
      if (existing.length > 0) {
        // Make sure is_sub_product is set
        await sql`UPDATE public.products SET is_sub_product = true WHERE id = ${existing[0].id}`
        skipped.push(name)
        continue
      }

      // Insert product
      const [product] = await sql`
        INSERT INTO public.products (name, sku, org_id, is_sub_product)
        VALUES (${name}, ${sku}, ${org_id}, true)
        RETURNING id
      `

      // Create inventory record
      await sql`
        INSERT INTO public.inventory (product_id, org_id, warehouse_id, qty_on_hand, qty_available, qty_reserved, qty_picked, qty_damaged)
        VALUES (${product.id}, ${org_id}, ${warehouse_id}, 0, 0, 0, 0, 0)
        ON CONFLICT DO NOTHING
      `

      inserted.push(name)
    } catch (e: any) {
      errors.push(`${name}: ${e.message}`)
    }
  }

  return NextResponse.json({ inserted: inserted.length, skipped: skipped.length, errors })
}
