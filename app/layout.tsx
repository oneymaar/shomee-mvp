import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SHOMEE',
  description: 'Découvrez votre prochain appartement, en vidéo.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="h-full">
      <body className="h-full bg-black">{children}</body>
    </html>
  )
}
