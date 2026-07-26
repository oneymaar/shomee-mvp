/**
 * Catalogues de l'onboarding — répliqués des composants WEB (`BienStep`,
 * `CriteriaStep`) qui les définissent hors de `@shomee/core`. Listes statiques
 * (labels + emojis), aucune logique. Le funnel manuel natif (S7) les consomme.
 */
import type { PropertyType } from '@shomee/core/stores/searchStore'

/** Types de bien proposés (miroir BienStep.PROPERTY_TYPES). */
export const PROPERTY_TYPES: { value: PropertyType; label: string; emoji: string }[] = [
  { value: 'appartement', label: 'Appartement', emoji: '🏢' },
  { value: 'maison', label: 'Maison', emoji: '🏡' },
]

/** Chips « Le bien » (miroir CriteriaStep.PROPERTY_TAGS). */
export const PROPERTY_TAGS: string[] = [
  'Extérieur',
  'Terrasse',
  'Balcon',
  'Dernier étage',
  'Traversant',
  'Lumineux',
  'Calme',
  'Vue dégagée',
  'Cuisine ouverte',
  'Charme / cachet',
]

/** Chips « L'immeuble » (miroir CriteriaStep.BUILDING_TAGS). */
export const BUILDING_TAGS: string[] = [
  'Ascenseur',
  'Gardien',
  'Parking',
  'Cave',
  'Local vélo',
  'Faibles charges',
  'Petite copropriété',
  'Immeuble récent',
  'Standing',
  'Parties communes rénovées',
]
