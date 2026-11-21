'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAdminContext } from '../../../admin-context'
import JsBarcode from 'jsbarcode'
import { Printer } from 'lucide-react'

type Bin = {
  id: string
  location_code: string
  zone_id: string | null
  is_active: boolean
  zones: { name: string; code: string } | null
}

type GroupedBins = {
  zoneName: string
  zoneCode: string
  bins: Bin[]
}

function Barcode({ value }: { value: string }) {
  const svgRef = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!svgRef.current || !value) return
    try {
      JsBarcode(svgRef.current, value, {
        format: 'CODE128',
        width: 2,
        height: 60,
        displayValue: true,
        fontSize: 12,
        margin: 6,
      })
    } catch {}
  }, [value])
  return <svg ref={svgRef} />
}

export default function PrintLocationLabelsPage() {
  const supabase = createClient()
  const { orgId } = useAdminContext()
  const [bins, setBins] = useState<Bin[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return
    supabase
      .from('bins')
      .select('id, location_code, zone_id, is_active, zones(name, code)')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('location_code')
      .then(({ data }) => {
        setBins((data as unknown as Bin[]) || [])
        setLoading(false)
      })
  }, [orgId])

  const grouped: GroupedBins[] = bins.reduce<GroupedBins[]>((acc, bin) => {
    const zoneName = bin.zones?.name ?? 'No Overstock Location'
    const zoneCode = bin.zones?.code ?? ''
    const existing = acc.find(g => g.zoneName === zoneName)
    if (existing) {
      existing.bins.push(bin)
    } else {
      acc.push({ zoneName, zoneCode, bins: [bin] })
    }
    return acc
  }, [])

  grouped.sort((a, b) => a.zoneName.localeCompare(b.zoneName))

  function toggleBin(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(bins.map(b => b.id)))
  }

  function deselectAll() {
    setSelected(new Set())
  }

  const selectedBins = bins.filter(b => selected.has(b.id))

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <style>{`
        @media print {
          .print-controls { display: none !important; }
          .print-label-grid {
            display: grid !important;
            grid-template-columns: repeat(4, 1fr) !important;
            gap: 8px !important;
          }
          .print-zone-header { display: none !important; }
          .screen-only { display: none !important; }
        }
      `}</style>

      <div className="print-controls flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Print Location Labels</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {selected.size} of {bins.length} location{bins.length !== 1 ? 's' : ''} selected
          </p>
        </div>
        <button
          onClick={() => window.print()}
          disabled={selected.size === 0}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
        >
          <Printer size={16} />
          Print {selected.size > 0 ? `${selected.size} Label${selected.size !== 1 ? 's' : ''}` : 'Labels'}
        </button>
      </div>

      <div className="print-controls flex gap-2 mb-4">
        <button
          onClick={selectAll}
          className="text-sm text-blue-600 hover:text-blue-700 font-medium px-3 py-1.5 bg-white border border-gray-200 rounded-lg transition-colors"
        >
          Select All
        </button>
        <button
          onClick={deselectAll}
          disabled={selected.size === 0}
          className="text-sm text-gray-600 hover:text-gray-700 font-medium px-3 py-1.5 bg-white border border-gray-200 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Deselect All
        </button>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-16 print-controls">Loading bins...</div>
      ) : bins.length === 0 ? (
        <div className="text-center text-gray-400 py-16 print-controls">No active bins found</div>
      ) : (
        <div>
          {grouped.map(group => (
            <div key={group.zoneName} className="mb-8">
              <div className="print-zone-header screen-only flex items-center gap-3 mb-3">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                  {group.zoneName}
                  {group.zoneCode ? ` (${group.zoneCode})` : ''}
                </h2>
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400">{group.bins.length} location{group.bins.length !== 1 ? 's' : ''}</span>
              </div>

              <div
                className="print-label-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '12px',
                }}
              >
                {group.bins.map(bin => {
                  const isSelected = selected.has(bin.id)
                  return (
                    <div
                      key={bin.id}
                      style={!isSelected ? { display: 'none' } : undefined}
                      className={!isSelected ? 'print:hidden screen-label' : 'screen-label'}
                    >
                      {isSelected && (
                        <div
                          className="print:break-inside-avoid bg-white border border-gray-200 rounded-xl p-4 flex flex-col items-center cursor-pointer hover:border-blue-300 transition-colors"
                          onClick={() => toggleBin(bin.id)}
                          style={{ breakInside: 'avoid' }}
                        >
                          <Barcode value={bin.location_code} />
                          <p className="text-base font-bold font-mono text-gray-900 mt-1 tracking-wide">
                            {bin.location_code}
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="print-controls mt-8">
            <div className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
              All Locations — Click to Toggle
            </div>
            {grouped.map(group => (
              <div key={group.zoneName} className="mb-6">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-sm font-medium text-gray-600">
                    {group.zoneName}
                    {group.zoneCode ? ` (${group.zoneCode})` : ''}
                  </h3>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.bins.map(bin => {
                    const isSelected = selected.has(bin.id)
                    return (
                      <button
                        key={bin.id}
                        onClick={() => toggleBin(bin.id)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-mono font-medium border transition-colors ${
                          isSelected
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
                        }`}
                      >
                        {bin.location_code}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
