'use client'

import { useState } from 'react'
import HelpPanel from '../components/help-panel'
import { BarberNav } from '../components/barber-nav'

export default function BarberLayout({ children }: { children: React.ReactNode }) {
  // Menú desplegado (con nombres) o solo íconos. Es el mismo menú que el del admin.
  const [navOpen, setNavOpen] = useState(false)

  return (
    <div className="admin-shell">
      <BarberNav open={navOpen} onOpenChange={setNavOpen} />
      {children}
      <HelpPanel role="barber" />
    </div>
  )
}
