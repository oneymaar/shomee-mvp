'use client'

/**
 * Loader animé SHOMEE — le monogramme « maison » se dessine en boucle (tracé du
 * haut, puis tracé du bas). Jumeau web du composant natif
 * `apps/mobile/src/components/onboarding/ShomeeLoader.tsx`, lui-même réplique
 * exacte de l'asset de marque `shomeeloader.html`.
 *
 * Ici on est REVENU à la version d'origine : l'asset de marque est du CSS, le
 * web peut donc l'exécuter tel quel — mêmes `d`, même cycle (2,2 s), mêmes
 * keyframes, `pathLength="100"` supporté nativement par les navigateurs. C'est
 * le natif qui doit ruser (react-native-svg ignore `pathLength`, d'où le
 * ré-échelonnage à 164 et l'easing échantillonné à la main).
 *
 * Les keyframes sont posées dans un <style> local plutôt que dans globals.css :
 * le composant reste autonome, et deux définitions identiques de la même
 * @keyframes sont sans effet de bord en CSS.
 */

import { memo } from 'react'

const STROKE = '#C17A6F'
const VB_W = 120
const VB_H = 150

const D_TOP = 'M12,42 V36 A28,28 0 0 1 40,8 H80 A28,28 0 0 1 108,36 V66'
const D_BOT = 'M108,108 V114 A28,28 0 0 1 80,142 H40 A28,28 0 0 1 12,114 V84'

const CSS = `
@keyframes shomeeLoaderTop {
  0%   { stroke-dashoffset: 100; }
  18%  { stroke-dashoffset: 0; }
  50%  { stroke-dashoffset: 0; }
  68%  { stroke-dashoffset: -100; }
  100% { stroke-dashoffset: -100; }
}
@keyframes shomeeLoaderBot {
  0%   { stroke-dashoffset: 100; }
  18%  { stroke-dashoffset: 100; }
  36%  { stroke-dashoffset: 0; }
  68%  { stroke-dashoffset: 0; }
  86%  { stroke-dashoffset: -100; }
  100% { stroke-dashoffset: -100; }
}
.shomee-loader-path {
  animation-duration: 2.2s;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
}
@media (prefers-reduced-motion: reduce) {
  .shomee-loader-path { animation: none; stroke-dashoffset: 0; }
}
`

function ShomeeLoader({ size = 26 }: { size?: number }) {
  const width = (size * VB_W) / VB_H
  return (
    <span
      className="inline-flex flex-shrink-0 items-center justify-center"
      style={{ width, height: size }}
      aria-hidden
    >
      <style>{CSS}</style>
      <svg width={width} height={size} viewBox={`0 0 ${VB_W} ${VB_H}`} fill="none">
        <path
          className="shomee-loader-path"
          d={D_TOP}
          pathLength={100}
          stroke={STROKE}
          strokeWidth={14}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="100 100"
          style={{ animationName: 'shomeeLoaderTop' }}
        />
        <path
          className="shomee-loader-path"
          d={D_BOT}
          pathLength={100}
          stroke={STROKE}
          strokeWidth={14}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="100 100"
          style={{ animationName: 'shomeeLoaderBot' }}
        />
      </svg>
    </span>
  )
}

export default memo(ShomeeLoader)
