'use client'

import { createContext, useContext } from 'react'

type AdminContext = { orgId: string; warehouseId: string }
const Ctx = createContext<AdminContext>({ orgId: '', warehouseId: '' })

export function AdminContextProvider({ orgId, warehouseId, children }: { orgId: string; warehouseId: string; children: React.ReactNode }) {
  return <Ctx.Provider value={{ orgId, warehouseId }}>{children}</Ctx.Provider>
}

export function useAdminContext() {
  return useContext(Ctx)
}
