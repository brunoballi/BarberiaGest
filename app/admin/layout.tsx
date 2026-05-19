'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import './admin-layout.css'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isRoot = pathname === '/admin'

  return (
    <>
      {!isRoot && (
        <div className="admin-back-bar">
          <Link href="/admin" className="admin-back-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}
              className="admin-back-icon" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Volver al panel
          </Link>
        </div>
      )}
      {children}
    </>
  )
}
