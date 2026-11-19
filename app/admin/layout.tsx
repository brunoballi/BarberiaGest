'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import './admin-layout.css'
import HelpPanel from '../components/help-panel'
import { AdminNavRail, AdminNavStrip } from '../components/admin-nav-rail'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isRoot = pathname === '/admin'
  const isSelectBranch = pathname === '/admin/select-branch'

  return (
    <div className={isSelectBranch ? undefined : 'admin-shell'}>
      {/* Menú de íconos en todo /admin/* (menos el selector de sucursal, que es previo al panel) */}
      {!isSelectBranch && <AdminNavRail />}
      {!isRoot && (
        <div className="admin-back-bar">
          <Link href="/admin" className="admin-back-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}
              className="admin-back-icon" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Volver al panel
          </Link>
          {!isSelectBranch && <AdminNavStrip />}
        </div>
      )}
      {children}
      {/* FAB de ayuda en todo /admin/* excepto select-branch */}
      {!isSelectBranch && <HelpPanel role="admin" />}
    </div>
  )
}
