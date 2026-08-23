import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import MaskedView from '@react-native-masked-view/masked-view'
import { Image } from 'expo-image'
import { Check, ChevronDown, MapPin } from 'lucide-react-native'
import type { Property } from '@shomee/core/types/domain'
import { formatLocation } from '@shomee/core/utils/format'
import { colors, fonts, radii, serifSizes } from '@/lib/theme'

/** Prix formaté avec séparateurs de milliers (espace, style fr) sans dépendre
 *  d'Intl (support Hermes inégal). Ex. 1350000 → "1 350 000 €". */
function formatPrice(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €'
}

interface Props {
  property: Property
  /** « Voir l'annonce » — ouvre la fiche complète. */
  onMore?: () => void
}

/**
 * Surcouche du feed — posée en absolu par-dessus la VideoCard.
 * `pointerEvents="box-none"` : les gestes passent à la vidéo SAUF sur les
 * éléments interactifs (bouton « Voir l'annonce »).
 *
 * REFONTE GRAPHIQUE (direction A, maquette validée le 21/08) — la hiérarchie a
 * changé, pas les données :
 *  - la LOCALISATION passe en tête, dans une capsule fumée : c'est l'info n°1 ;
 *  - le PRIX descend en serif 18 px, discret — « on vend du luxe, le prix ne
 *    doit pas sauter aux yeux » (Olivier, 20/08) ;
 *  - « Voir l'annonce » devient un bouton fantôme (pilule bordée) au lieu d'un
 *    lien souligné, et le chevron pointe vers le BAS (il ouvre en descendant) ;
 *  - dégradés en noir CHAUD (#140F0C) plutôt qu'en noir pur.
 */
export function PropertyOverlay({ property, onMore }: Props) {
  const insets = useSafeAreaInsets()
  const brandName = property.agencyName ?? property.agentName
  const brandLogo = property.agencyLogo ?? property.agentAvatar
  const initial = (brandName?.trim().charAt(0) ?? '?').toUpperCase()

  // Coches vertes = critères RÉELLEMENT satisfaits quand le moteur les fournit
  // (matchedCriteria est la source de vérité documentée), sinon les
  // caractéristiques du bien — comportement inchangé sur les biens sans score.
  const matched = property.matchedCriteria ?? []
  const tags = (matched.length > 0 ? matched : (property.features ?? [])).filter(
    (f) => f !== 'Cave',
  )

  // €/m² : fourni par l'API quand il existe, sinon déduit. Jamais affiché si la
  // surface est absente ou nulle (division impossible).
  const perSqm =
    property.pricePerSqm ?? (property.surface > 0 ? property.price / property.surface : null)

  const specs = [
    `T${property.rooms}`,
    property.bedrooms != null && property.bedrooms > 0
      ? `${property.bedrooms} chambre${property.bedrooms > 1 ? 's' : ''}`
      : null,
    `${property.surface} m²`,
    property.floor != null && property.floor > 0 ? `${property.floor}ᵉ étage` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Dégradés — lisibilité du texte crème sur n'importe quelle vidéo.
          Noir chaud (#140F0C) : un noir pur jurerait avec la palette. */}
      <LinearGradient
        colors={['rgba(20,15,12,0.55)', 'transparent']}
        style={styles.gradTop}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['transparent', 'rgba(20,15,12,0.38)', 'rgba(20,15,12,0.82)']}
        locations={[0, 0.45, 0.92]}
        style={styles.gradBottom}
        pointerEvents="none"
      />

      {/* Haut — agence. Le logo reste ROND (consigne d'Olivier, 20/08). */}
      <View style={[styles.top, { paddingTop: insets.top + 12 }]} pointerEvents="box-none">
        <View style={styles.agencyRow}>
          <View style={styles.logo}>
            {brandLogo ? (
              <Image source={{ uri: brandLogo }} style={styles.logoImg} contentFit="contain" />
            ) : (
              <Text style={styles.logoInitial}>{initial}</Text>
            )}
          </View>
          <Text style={styles.agencyName} numberOfLines={1}>
            {brandName}
          </Text>
        </View>
      </View>

      {/* Bas — la colonne d'infos. `right: 74` dégage la colonne d'actions. */}
      <View style={styles.bottom} pointerEvents="box-none">
        {/* 1. La localisation, en capsule — l'info n°1 */}
        <View style={styles.locPill}>
          <MapPin size={11} color={colors.creamOnDark} strokeWidth={2.2} />
          <Text style={styles.locTxt} numberOfLines={1}>
            {formatLocation(property.arrondissement, property.district).toUpperCase()}
          </Text>
        </View>

        {/* 2. Le prix, en serif discrète, avec le €/m² en retrait */}
        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatPrice(property.price)}</Text>
          {perSqm != null && (
            <Text style={styles.perSqm}>{formatPrice(perSqm).replace(' €', ' €/m²')}</Text>
          )}
        </View>

        {/* 3. Les caractéristiques essentielles */}
        <Text style={styles.specs} numberOfLines={1}>
          {specs}
        </Text>

        {/* 4. Les critères satisfaits — coche verte, fondu au bord droit */}
        {tags.length > 0 && (
          // MaskedView : le masque (alpha) fait baisser l'opacité du TEXTE
          // lui-même jusqu'à 0 sur les 30px droits → la vidéo se voit à
          // travers (vrai fondu, pas un calque sombre). Équivalent maskImage web.
          <MaskedView
            style={styles.tagsMask}
            maskElement={
              <View style={styles.maskRow}>
                <View style={styles.maskSolid} />
                <LinearGradient
                  colors={['#000', 'transparent']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.maskFade}
                />
              </View>
            }
          >
            <View style={styles.tags}>
              {tags.map((f) => (
                <View key={f} style={styles.tag}>
                  <Check size={12} color={colors.greenOnDark} strokeWidth={2.4} />
                  <Text style={styles.tagTxt}>{f}</Text>
                </View>
              ))}
            </View>
          </MaskedView>
        )}

        {/* 5. Le bouton fantôme — chevron vers le BAS : la fiche s'ouvre en
            descendant (le chevron vers le haut était une erreur, cf. 20/08). */}
        <Pressable onPress={onMore} style={styles.cta} hitSlop={8}>
          <Text style={styles.ctaTxt}>{"Voir l'annonce"}</Text>
          <ChevronDown size={15} color={colors.creamOnDark} strokeWidth={2.2} />
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  gradTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 150 },
  gradBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 280 },

  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16 },
  agencyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: colors.creamOnDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImg: { width: '100%', height: '100%' },
  logoInitial: { color: colors.ink, fontFamily: fonts.serifStrong, fontSize: serifSizes.avatar },
  agencyName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 1 },
  },

  // Pleine largeur : la colonne d'actions est ENTIÈREMENT au-dessus de ce
  // bloc (son bas est à 216), donc rien ne justifie de réserver 74 px à
  // droite — les critères couraient jusqu'aux deux tiers de l'écran pour
  // rien. `bottom: 40` dégage la zone tactile du scrub (24 px) : à 16 px, le
  // bouton « Voir l'annonce » chevauchait la barre de lecture.
  bottom: { position: 'absolute', left: 16, right: 16, bottom: 40 },

  locPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: '100%',
    backgroundColor: colors.smoke,
    borderRadius: radii.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  locTxt: {
    color: colors.creamOnDark,
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.5,
    flexShrink: 1,
  },

  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 8, marginBottom: 1 },
  price: {
    color: '#fff',
    fontFamily: fonts.serif,
    fontSize: serifSizes.priceFeed,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 1 },
  },
  perSqm: { color: 'rgba(246,237,230,0.7)', fontSize: 12.5, fontWeight: '500' },

  specs: {
    color: 'rgba(246,237,230,0.88)',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 6,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 1 },
  },

  // Une seule ligne ; le MaskedView (alpha) fond le texte vers la transparence
  // sur les 30px droits. `alignSelf: stretch` → le cadre = largeur de la colonne
  // (le fondu tombe donc au bord droit, pas au bout du texte).
  tagsMask: { alignSelf: 'stretch', height: 18, marginBottom: 10 },
  maskRow: { flex: 1, flexDirection: 'row' },
  maskSolid: { flex: 1, backgroundColor: '#000' },
  maskFade: { width: 30 },
  tags: { flexDirection: 'row', gap: 11, alignItems: 'center', height: 18 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  tagTxt: { color: 'rgba(246,237,230,0.85)', fontSize: 11.5, fontWeight: '500' },

  cta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.ghostBorder,
    backgroundColor: colors.smokeLight,
  },
  ctaTxt: { color: colors.creamOnDark, fontSize: 12.5, fontWeight: '600' },
})
