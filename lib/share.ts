import type { Property } from './types'

export function shareProperty(property: Property) {
  const url = `${window.location.origin}/share/${property.id}`
  const price = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(property.price)
  const text = `✨ Regarde ce bien que j'ai découvert sur SHOMEE, l'app immo en vidéo 📱 :\n${url}\n\n📍 ${property.district} - ${property.location}\n🏡 T${property.rooms} · ${property.surface} m² · ${price} €`

  if (navigator.share) {
    navigator.share({ title: property.title, text }).catch(() => {})
  } else {
    navigator.clipboard?.writeText(text).catch(() => {})
  }
}
