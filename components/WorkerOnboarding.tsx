'use client'

import { useEffect } from 'react'

type Props = {
  workerId: string
  role: 'picker' | 'packer' | 'shipper' | 'receiver' | 'all'
  focusTask?: string | null
  onDismiss: () => void
}

type RoleConfig = {
  title: string
  steps: string[]
  numberColor: string
  buttonColor: string
  badgeColor: string
}

const ROLE_CONFIG: Record<Props['role'], RoleConfig> = {
  picker: {
    title: 'Welcome, Picker! Here\'s how it works.',
    steps: [
      '🎯 Get an order — Tap one from the Incoming Orders list, or your manager can assign one to you directly.',
      '📦 Scan each item — The app shows you what to pick and where. Grab a basket/tote and scan each item barcode as you pick it.',
      '📍 Scan to rack — When done, scan a rack barcode to record where you\'re placing the basket.',
      '🤝 Automatic handoff — It goes straight to an available packer, or if nobody else is packing right now, you\'ll go straight into packing it yourself.',
    ],
    numberColor: 'bg-blue-600 text-white',
    buttonColor: 'bg-blue-600 hover:bg-blue-700',
    badgeColor: 'bg-blue-100 text-blue-700',
  },
  packer: {
    title: 'Welcome, Packer! Here\'s how it works.',
    steps: [
      '🎯 Get an order — Tap one from the Incoming Orders list once it\'s picked, or it\'ll be routed to you automatically.',
      '📍 Find the order — The screen shows the rack location where the picker left it. Box 1 opens automatically.',
      '📦 Verify and pack items — Scan each item as you pack it into boxes.',
      '📍 Scan to rack — When done, scan a rack to record where the packed boxes are.',
      '🤝 Hand off to shipping — The shipping team claims it from their own Incoming Orders list.',
    ],
    numberColor: 'bg-purple-600 text-white',
    buttonColor: 'bg-purple-600 hover:bg-purple-700',
    badgeColor: 'bg-purple-100 text-purple-700',
  },
  shipper: {
    title: 'Welcome, Shipper! Here\'s how it works.',
    steps: [
      '🎯 Get an order — Tap one from the Incoming Orders list once it\'s packed.',
      '📍 Find the boxes — The screen shows the rack where the packed boxes are waiting.',
      '🏷️ Print the shipping label — Use the label panel to get rates and create a label via ShipStation.',
      '✅ Confirm shipped — Once the label is on and the package is with the carrier, tap Confirm Shipped.',
    ],
    numberColor: 'bg-orange-600 text-white',
    buttonColor: 'bg-orange-600 hover:bg-orange-700',
    badgeColor: 'bg-orange-100 text-orange-700',
  },
  receiver: {
    title: 'Welcome, Receiver! Here\'s how it works.',
    steps: [
      '📋 Select a receiving record — Choose the incoming shipment you\'re checking in.',
      '🔍 Scan each item — Scan item barcodes as you count them. The app tracks expected vs received.',
      '🏷️ Print labels if needed — You can print bin labels for new inventory directly from the app.',
      '✅ Inventory updates automatically — Received quantities are added to stock in real time.',
    ],
    numberColor: 'bg-green-600 text-white',
    buttonColor: 'bg-green-600 hover:bg-green-700',
    badgeColor: 'bg-green-100 text-green-700',
  },
  all: {
    title: 'Welcome! You have access to everything.',
    steps: [
      '🎯 Pick your daily focus — Each morning, choose which task you\'re doing from the hub.',
      '📋 Orders flow automatically — Each stage (picking → packing → shipping) has its own Incoming Orders list to tap and claim, plus auto-routing when you\'re the only one online.',
      '🔄 You can switch tasks anytime — Use "Switch task" on the hub if you need to change roles mid-day.',
      '📊 Your manager can see progress — The dashboard shows live order counts at every stage.',
    ],
    numberColor: 'bg-gray-700 text-white',
    buttonColor: 'bg-gray-700 hover:bg-gray-800',
    badgeColor: 'bg-gray-100 text-gray-700',
  },
}

export default function WorkerOnboarding({ workerId, role, focusTask, onDismiss }: Props) {
  const config = ROLE_CONFIG[role]

  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('wms_skip_onboarding')) {
      onDismiss()
      return
    }
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <div className="fixed inset-0 z-50 bg-gray-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-lg relative">
        <span className={`absolute top-6 right-6 text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${config.badgeColor}`}>
          {role === 'all' ? 'All roles' : role}
        </span>

        <h2 className="text-xl font-bold text-gray-900 pr-24 mb-6 leading-snug">
          {config.title}
        </h2>

        <ol className="space-y-4 mb-8">
          {config.steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${config.numberColor}`}>
                {i + 1}
              </span>
              <p className="text-sm text-gray-700 leading-relaxed">{step}</p>
            </li>
          ))}
        </ol>

        <button
          onClick={onDismiss}
          className={`w-full py-3.5 rounded-xl font-bold text-white text-base transition-colors ${config.buttonColor}`}
        >
          Got it, let&apos;s go!
        </button>
      </div>
    </div>
  )
}
