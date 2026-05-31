'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentProfile } from '@/lib/supabase/supabase.client'
import { getMyBranchesCached } from '@/lib/hooks/use-catalogs'
import { setStoredBranch } from '@/lib/hooks/usePersistedBranch'
import type { Branch } from '@/lib/supabase/database.types'
import './select-branch.css'

export default function SelectBranchView() {
  const router = useRouter()
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [adminName, setAdminName] = useState<string>('')

  useEffect(() => {
    async function load() {
      try {
        const profile = await getCurrentProfile()
        if (!profile) { router.replace('/login'); return }
        if (profile.role !== 'admin') { router.replace('/barber'); return }
        setAdminName(profile.full_name ?? '')

        const list = await getMyBranchesCached()
        if (list.length === 0) {
          setError('No tenés sucursales asignadas. Contactá al administrador.')
          return
        }
        // Si solo tiene 1, saltar directamente
        if (list.length === 1) {
          setStoredBranch(list[0].id)
          router.replace('/admin')
          return
        }
        setBranches(list)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error inesperado')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [router])

  function handleSelect(branchId: string) {
    setStoredBranch(branchId)
    router.replace('/admin')
  }

  if (loading) {
    return (
      <div className="select-branch-app">
        <div className="select-branch-loader" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="select-branch-app">
        <p className="select-branch-error">{error}</p>
      </div>
    )
  }

  return (
    <div className="select-branch-app">
      <div className="select-branch-card">
        <h1 className="select-branch-logo">VALHALLA</h1>
        <p className="select-branch-greeting">Hola{adminName ? `, ${adminName}` : ''} 👋</p>
        <p className="select-branch-question">Elegí con qué sucursal vas a trabajar</p>

        <div className="select-branch-list">
          {branches.map((b) => (
            <button
              key={b.id}
              onClick={() => handleSelect(b.id)}
              className="select-branch-item"
            >
              <span className="select-branch-name">{b.name}</span>
              <span className="select-branch-arrow">→</span>
            </button>
          ))}
        </div>

        <p className="select-branch-hint">
          Podés cambiarla en cualquier momento desde el panel.
        </p>
      </div>
    </div>
  )
}
