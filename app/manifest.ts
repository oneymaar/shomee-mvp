import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SHOMEE',
    short_name: 'SHOMEE',
    description: 'Découvrez votre prochain appartement, en vidéo.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      // Acquéreur : logo blanc sur fond terracotta (distinct de l'app agent,
      // qui reste blanc sur noir via /manifest-agent.json).
      { src: '/icons/icon-buyer-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-buyer-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
