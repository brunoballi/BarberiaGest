'use client'

import HelpPanel from '../components/help-panel'

export default function BarberLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <HelpPanel role="barber" />
    </>
  )
}
