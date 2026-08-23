import type { Metadata, Viewport } from 'next'
import { Frank_Ruhl_Libre } from 'next/font/google'
import './globals.css'
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar'

/**
 * Frank Ruhl Libre — la serif de marque (direction A, validée le 20/08).
 * Exposée en variable CSS `--font-serif` : le proto Quartiers, affiché en
 * WebView dans l'app mobile, doit rendre EXACTEMENT la même typographie que les
 * écrans natifs, sinon la couture se voit au passage de l'un à l'autre.
 * `display: 'swap'` → le texte s'affiche tout de suite en police système et
 * bascule à l'arrivée de la serif : jamais d'écran vide en attendant.
 */
const frankRuhl = Frank_Ruhl_Libre({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-serif',
  display: 'swap',
})

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
    <html lang="fr" className={`h-full ${frankRuhl.variable}`}>
      <body className="h-full" style={{ backgroundColor: '#FAF3EE' }}>
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  )
}
