/** "PARIS 18e" → "Paris 18e" */
export function formatArrondissement(arr: string): string {
  return arr.charAt(0).toUpperCase() + arr.slice(1).toLowerCase()
}

/** "Paris 18e · Montmartre" */
export function formatLocation(arrondissement: string, district: string): string {
  return `${formatArrondissement(arrondissement)} · ${district}`
}
