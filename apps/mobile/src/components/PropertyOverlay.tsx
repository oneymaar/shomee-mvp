import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import MaskedView from '@react-native-masked-view/masked-view'
import { Image } from 'expo-image'
import { Check, ChevronDown, Home, MapPin } from 'lucide-react-native'
import type { Property } from '@shomee/core/types/domain'
import { formatLocation } from '@shomee/core/utils/format'

/** Prix formaté avec séparateurs de milliers (espace, style fr) sans dépendre
 *  d'Intl (support Hermes inégal). Ex. 1350000 → "1 350 000 €". */
function formatPrice(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €'
}

interface Props {
  property: Property
  /** « Voir l'annonce » — no-op en v2a (PropertyDetailSheet = v2b). */
  onMore?: () => void
}

/**
 * Surcouche du feed (S4b-v2a) — posée en absolu par-dessus la VideoCard.
 * `pointerEvents="box-none"` : les gestes passent à la vidéo SAUF sur les
 * éléments interactifs (bouton « Voir l'annonce »).
 */
export function PropertyOverlay({ property, onMore }: Props) {
  const insets = useSafeAreaInsets()
  const brandName = property.agencyName ?? property.agentName
  const brandLogo = property.agencyLogo ?? property.agentAvatar
  const initial = (brandName?.trim().charAt(0) ?? '?').toUpperCase()
  const features = (property.features ?? []).filter((f) => f !== 'Cave')

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Dégradés — lisibilité du texte blanc sur n'importe quelle vidéo */}
      <LinearGradient
        colors={['rgba(0,0,0,0.55)', 'transparent']}
        style={styles.gradTop}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.85)']}
        style={styles.gradBottom}
        pointerEvents="none"
      />

      {/* Haut — agence */}
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

      {/* Bas — infos bien + (match si score réel) */}
      <View style={styles.bottom} pointerEvents="box-none">
        <View style={styles.bottomRow}>
          <View style={styles.infoCol}>
            <View style={styles.row}>
              <MapPin size={14} color="#fff" />
              <Text style={styles.addr} numberOfLines={1}>
                {formatLocation(property.arrondissement, property.district)}
              </Text>
            </View>

            <View style={styles.row}>
              <Home size={14} color="#fff" strokeWidth={1.8} />
              {/* Le type de bien (appartement/maison) n'apparaît plus ici — il
                  vit dans la fiche ouverte. À la place : les CHAMBRES, l'info
                  essentielle au premier coup d'œil (arbitrage du 29/07 — et le
                  libellé d'avant disait « Appartement » en dur, même pour une
                  maison). Omises proprement quand la donnée manque. */}
              <Text style={styles.spec} numberOfLines={1}>
                T{property.rooms}
                {property.bedrooms != null && property.bedrooms > 0
                  ? ` · ${property.bedrooms} ch.`
                  : ''}
                {' · '}
                {property.surface} m² · {formatPrice(property.price)}
              </Text>
            </View>

            {features.length > 0 && (
              // MaskedView : le masque (alpha) fait baisser l'opacité du TEXTE
              // lui-même jusqu'à 0 sur les 30px droits → la vidéo se voit à
              // travers (vrai fondu, pas un calque sombre). Équivalent maskImage web.
              <MaskedView
                style={styles.featuresMask}
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
                <View style={styles.features}>
                  {features.map((f) => (
                    <View key={f} style={styles.feature}>
                      <Check size={11} color="#34d399" />
                      <Text style={styles.featureTxt}>{f}</Text>
                    </View>
                  ))}
                </View>
              </MaskedView>
            )}

            <Pressable onPress={onMore} style={styles.more} hitSlop={8}>
              <Text style={styles.moreTxt}>{"Voir l'annonce"}</Text>
              <ChevronDown size={14} color="#fff" />
            </Pressable>
          </View>

          {/* MatchBadge (le % en bas à droite) — MASQUÉ pour l'instant, décision
              du 29/07 : « c'est juste un chiffre et je préfère que les
              utilisateurs soient focus sur ce qui est essentiel, à savoir la
              vidéo ». Le score continue d'exister (matching, découverte,
              plancher 60 %) — seul l'AFFICHAGE est retiré, partout : dans le
              feed comme au-dessus de la fiche ouverte (c'est le même overlay).
              Pour le réactiver : réimporter MatchBadge et rétablir
              `{property.matchScore != null && <MatchBadge score={property.matchScore} />}`. */}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  gradTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 140 },
  gradBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 280 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12 },
  agencyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: {
    width: 36, height: 36, borderRadius: 18, overflow: 'hidden',
    backgroundColor: '#171717', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  logoImg: { width: '100%', height: '100%' },
  logoInitial: { color: '#fff', fontSize: 13, fontWeight: '700' },
  agencyName: { color: '#fff', fontSize: 15, fontWeight: '600', flexShrink: 1 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 16, paddingHorizontal: 12 },
  bottomRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  infoCol: { flex: 1, minWidth: 0, gap: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addr: { color: '#fff', fontSize: 15, fontWeight: '700', lineHeight: 19, flexShrink: 1 },
  spec: { color: '#fff', fontSize: 15, lineHeight: 19, flexShrink: 1 },
  // Une seule ligne ; le MaskedView (alpha) fond le texte vers la transparence
  // sur les 30px droits. `alignSelf: stretch` → le cadre = largeur de la colonne
  // (le fondu tombe donc au bord droit, pas au bout du texte).
  featuresMask: { alignSelf: 'stretch', height: 20, marginTop: 1 },
  maskRow: { flex: 1, flexDirection: 'row' },
  maskSolid: { flex: 1, backgroundColor: '#000' },
  maskFade: { width: 30 },
  features: { flexDirection: 'row', gap: 12, alignItems: 'center', height: 20 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  featureTxt: { color: '#fff', fontSize: 13 },
  more: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4 },
  moreTxt: { color: '#fff', fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
})
