import type { Metadata, Viewport } from 'next'
import './globals.css'
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar'

export const metadata: Metadata = {
  title: 'SHOMEE',
  description: 'Découvrez votre prochain appartement, en vidéo.',
  icons: {
    apple: '/Logo-shomee.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SHOMEE',
  },
}

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="h-full">
      <body className="h-full bg-black">
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  )
}
