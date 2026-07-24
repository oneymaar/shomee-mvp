import { z } from 'zod'

/**
 * Schéma du brief acquéreur généré par un LLM — extrait de
 * app/api/buyer/onboarding-prefill/route.ts (S6) pour être partagé entre
 * l'ancien contrat PWA (onboarding-prefill) et le nouveau contrat natif
 * (/api/handoff/*, S9). Comportement STRICTEMENT identique.
 *
 * ChipState : 1 = souhaité, 2 = obligatoire, 3 = rédhibitoire
 * (miroir de @shomee/core searchStore — 0 « non sélectionné » n'est
 * jamais transmis dans un brief).
 */

const ChipStateSchema = z.union([z.literal(1), z.literal(2), z.literal(3)])

export const AIOnboardingBriefSchema = z.object({
  locationQuery: z.string().min(2, 'locationQuery doit contenir au moins 2 caractères'),
  propertyTypes: z
    .array(z.enum(['appartement', 'maison', 'loft', 'atelier']))
    .optional()
    .default([]),
  minRooms: z.number().nullable().optional().default(null),
  maxRooms: z.number().nullable().optional().default(null),
  minBedrooms: z.number().nullable().optional().default(null),
  maxBedrooms: z.number().nullable().optional().default(null),
  minSurface: z.number().positive('minSurface doit être un nombre positif'),
  maxSurface: z.number().nullable().optional().default(null),
  budgetMin: z.number().nullable().optional().default(null),
  budgetMax: z.number().positive('budgetMax doit être un nombre positif'),
  chipStates: z.record(z.string(), ChipStateSchema).optional().default({}),
  customCriteria: z
    .array(
      z.object({
        label: z.string().min(1),
        state: ChipStateSchema,
      }),
    )
    .optional()
    .default([]),
})

export type AIOnboardingBrief = z.infer<typeof AIOnboardingBriefSchema>

// ─── Messages d'erreur (français, par champ) ────────────────────────────────

const REQUIRED_FIELD_MESSAGES: Record<string, string> = {
  locationQuery: 'Le champ "locationQuery" est obligatoire (zone de recherche).',
  minSurface: 'Le champ "minSurface" est obligatoire (surface minimum en m²).',
  budgetMax: 'Le champ "budgetMax" est obligatoire (budget maximum en €).',
}

export function zodErrorMessage(err: z.ZodError): string {
  const issue = err.issues[0]
  if (!issue) return 'Brief invalide.'
  const path = issue.path.join('.')
  const required = REQUIRED_FIELD_MESSAGES[path]
  if (required) return required
  if (issue.code === 'invalid_type' && (issue as { received?: unknown }).received === 'undefined') {
    return `Champ requis manquant : "${path}".`
  }
  return `Champ "${path}" invalide : ${issue.message}`
}
