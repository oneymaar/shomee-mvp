import { forwardRef, useCallback, useMemo } from 'react'
import { Alert, Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native'
import {
  BottomSheetBackdrop,
  BottomSheetFooter,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
  type BottomSheetFooterProps,
} from '@gorhom/bottom-sheet'
import { Image } from 'expo-image'
import { CalendarPlus, Heart, MessageCircle, Phone, Send } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Property } from '@shomee/core/types/domain'
import { DEFAULT_FALLBACK_IMAGE } from '@shomee/core/constants'
import { useShomeeStore } from '@/lib/stores'

// TODO: numéro de test — remplacer par le téléphone de l'agence (feed live).
const TEST_PHONE = '0670744935'
const ACCENT = '#A64B27'

// Formatage FR sans Intl (Hermes) : espace fine tous les 3 chiffres — même
// approche que l'ActionRail, pour rester cohérent et éviter tout souci Intl.
function groupThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}
const euro = (n: number) => `${groupThousands(n)} €`
const perSqm = (n: number) => `${groupThousands(n)} €/m²`

/* ── Helpers de mise en page (miroir du sheet web : SectionTitle/GreyBox/Row) ── */
function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>
}

function GreyBox({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.greyBox, style]}>{children}</View>
}

/** Ligne label/valeur. Ne rend rien si la valeur est absente (parité PreviewRow,
 *  previewMode=false côté acquéreur → pas de tiret « — »). */
function Row({ label, value }: { label: string; value?: string | null }) {
  if (value == null || value === '') return null
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

/* ── Composant ─────────────────────────────────────────────────────────────── */
interface Props {
  property: Property | null
}

/**
 * PropertyDetailSheet mobile — Pass 1 (S4b-v2b).
 *
 * Ossature `@gorhom/bottom-sheet` (modal présenté impérativement par le feed) +
 * image principale (poster, galerie différée) + sections texte/données mirrorées
 * du sheet web : Description, Caractéristiques, Composition, Marché.
 * Diagnostics (DPE/GES) et Quartier (carte) → Pass 2. Galerie → passe média.
 */
export const PropertyDetailSheet = forwardRef<BottomSheetModal, Props>(
  function PropertyDetailSheet({ property }, ref) {
    const insets = useSafeAreaInsets()
    const snapPoints = useMemo(() => ['92%'], [])

    // Favori abonné à CE bien (toggle + compteur des pills bas).
    const isFavorite = useShomeeStore((s) =>
      property ? s.favorites.some((f) => f.id === property.id) : false,
    )
    const toggleFavorite = useShomeeStore((s) => s.toggleFavorite)

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.4} />
      ),
      [],
    )

    const handleCall = useCallback(() => {
      const phone = (property as { agencyPhone?: string } | null)?.agencyPhone ?? TEST_PHONE
      Linking.openURL(`tel:${phone}`).catch(() => Alert.alert("Appeler l'agence", phone))
    }, [property])

    const handleShare = useCallback(() => {
      if (!property) return
      Share.share({
        message: `${property.title}\n${property.arrondissement} · ${property.surface} m² · ${euro(property.price)}`,
      }).catch(() => {})
    }, [property])

    // Barre CTA collée en bas (miroir des pills web) — sticky via footerComponent.
    const renderFooter = useCallback(
      (props: BottomSheetFooterProps) => {
        if (!property) return null
        const likeCount = (property.likeCount ?? 0) + (isFavorite ? 1 : 0)
        return (
          <BottomSheetFooter {...props} bottomInset={insets.bottom}>
            <View style={styles.footer}>
              {/* Pill gauche — 3 CTA à parts égales (flex:1 chacun) */}
              <View style={[styles.pill, styles.pillLeft]}>
                <CtaButton icon={MessageCircle} label="Message" onPress={() => {}} grow />
                <Divider />
                <CtaButton icon={Phone} label="Appeler" onPress={handleCall} grow />
                <Divider />
                <CtaButton icon={CalendarPlus} label="Visiter" onPress={() => {}} grow />
              </View>
              {/* Pill droite — Like + Share */}
              <View style={[styles.pill, styles.pillRight]}>
                <CtaButton
                  icon={Heart}
                  label={String(likeCount)}
                  active={isFavorite}
                  onPress={() => toggleFavorite(property)}
                />
                <Divider />
                <CtaButton icon={Send} label={String(property.shareCount ?? 0)} onPress={handleShare} />
              </View>
            </View>
          </BottomSheetFooter>
        )
      },
      [property, isFavorite, insets.bottom, handleCall, handleShare, toggleFavorite],
    )

    return (
      <BottomSheetModal
        ref={ref}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
        backdropComponent={renderBackdrop}
        footerComponent={renderFooter}
        handleIndicatorStyle={styles.handle}
        backgroundStyle={styles.sheetBg}
      >
        {property && (
          <BottomSheetScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {/* Image principale (galerie différée → un seul poster pour l'instant) */}
            <Image
              source={{ uri: property.imageUrlFallback || DEFAULT_FALLBACK_IMAGE }}
              style={styles.hero}
              contentFit="cover"
              transition={150}
            />

            {/* En-tête texte */}
            <View style={styles.header}>
              <Text style={styles.title}>{property.title}</Text>
              <Text style={styles.subtitle}>
                {property.arrondissement} · {property.surface} m² · {property.rooms} pièces
              </Text>
              <Text style={styles.price}>{euro(property.price)}</Text>
            </View>

            <View style={styles.sections}>
              {/* Description */}
              <View>
                <SectionTitle>Description</SectionTitle>
                <GreyBox style={styles.boxPadded}>
                  <Text style={styles.description}>{property.description}</Text>
                </GreyBox>
              </View>

              {/* Caractéristiques */}
              <View>
                <SectionTitle>Caractéristiques</SectionTitle>
                <GreyBox style={styles.boxRows}>
                  <Row label="Type de bien" value="Appartement" />
                  <Row label="Surface Carrez" value={`${property.surface} m²`} />
                  <Row label="Pièces" value={String(property.rooms)} />
                  <Row label="Chambres" value={property.bedrooms != null ? String(property.bedrooms) : undefined} />
                  <Row
                    label="Étage"
                    value={
                      property.floor != null
                        ? property.totalFloors
                          ? `${property.floor} / ${property.totalFloors}`
                          : String(property.floor)
                        : undefined
                    }
                  />
                  <Row label="Orientation" value={property.orientation} />
                  <Row label="Extérieur" value={property.exteriorType} />
                  <Row label="Ascenseur" value={property.features?.includes('Ascenseur') ? 'Oui' : undefined} />
                  <Row label="Gardien" value={property.features?.includes('Gardien') ? 'Oui' : undefined} />
                  <Row label="Cave" value={property.features?.includes('Cave') ? 'Oui' : undefined} />
                  <Row label="Chauffage" value={property.heatingType} />
                  <Row label="Eau chaude" value={property.hotWaterType} />
                  <Row label="Année de construction" value={property.yearBuilt ? String(property.yearBuilt) : undefined} />
                  <Row label="Nombre de lots" value={property.lotCount != null ? String(property.lotCount) : undefined} />
                  <Row
                    label="Procédures en cours"
                    value={property.proceduresEnCours != null ? (property.proceduresEnCours ? 'Oui' : 'Non') : undefined}
                  />
                  <Row label="Charges mensuelles" value={property.monthlyCharges != null ? euro(property.monthlyCharges) : undefined} />
                  <Row label="Taxe foncière" value={property.propertyTax != null ? euro(property.propertyTax) : undefined} />
                </GreyBox>
              </View>

              {/* Composition */}
              {property.composition && property.composition.length > 0 && (
                <View>
                  <SectionTitle>Composition</SectionTitle>
                  <GreyBox style={styles.boxRows}>
                    {property.composition.map(({ label, surface }) => (
                      <View key={label} style={styles.row}>
                        <Text style={styles.rowLabel}>{label}</Text>
                        <Text style={styles.rowValue}>{surface} m²</Text>
                      </View>
                    ))}
                  </GreyBox>
                </View>
              )}

              {/* Marché immobilier */}
              {property.marketAvgPricePerSqm != null && (
                <View>
                  <SectionTitle>Marché immobilier</SectionTitle>
                  <GreyBox style={styles.boxPadded}>
                    <View style={styles.marketHead}>
                      <Text style={styles.marketPrice}>{euro(property.price)}</Text>
                      {property.pricePerSqm != null && (
                        <Text style={styles.marketPpm}>{perSqm(property.pricePerSqm)}</Text>
                      )}
                    </View>
                    <View style={styles.divider} />
                    <Row label="Prix moyen secteur" value={perSqm(property.marketAvgPricePerSqm)} />
                    {property.marketEvolution10y && (
                      <View style={styles.row}>
                        <Text style={styles.rowLabel}>Évolution 10 ans</Text>
                        <Text
                          style={[
                            styles.rowValue,
                            { color: property.marketEvolution10y.startsWith('+') ? '#059669' : '#ef4444', fontWeight: '700' },
                          ]}
                        >
                          {property.marketEvolution10y}
                        </Text>
                      </View>
                    )}
                    <Row label="Prix haut" value={property.marketHighPrice != null ? perSqm(property.marketHighPrice) : undefined} />
                    <Row label="Prix bas" value={property.marketLowPrice != null ? perSqm(property.marketLowPrice) : undefined} />
                  </GreyBox>
                </View>
              )}
            </View>
          </BottomSheetScrollView>
        )}
      </BottomSheetModal>
    )
  },
)

/* ── Sous-composants CTA ───────────────────────────────────────────────────── */
function CtaButton({
  icon: Icon,
  label,
  onPress,
  active,
  grow,
}: {
  icon: typeof Phone
  label: string
  onPress: () => void
  active?: boolean
  /** flex:1 → utilisé seulement dans la pill gauche (3 boutons à parts égales).
   *  La pill droite (Like/Share) reste dimensionnée par son contenu. */
  grow?: boolean
}) {
  return (
    <Pressable onPress={onPress} style={[styles.cta, grow && styles.ctaGrow]} hitSlop={6}>
      <Icon size={18} strokeWidth={1.8} color={active ? '#ef4444' : '#fff'} fill={active ? '#ef4444' : 'transparent'} />
      <Text style={styles.ctaLabel}>{label}</Text>
    </Pressable>
  )
}

function Divider() {
  return <View style={styles.ctaDivider} />
}

const styles = StyleSheet.create({
  sheetBg: { backgroundColor: '#FAFAF9' },
  handle: { backgroundColor: '#D6D3D1', width: 40 },
  content: { paddingBottom: 120 },

  hero: { width: '100%', height: 220, backgroundColor: '#E7E5E4' },

  header: { paddingHorizontal: 16, paddingTop: 16 },
  title: { color: '#1C1917', fontSize: 20, fontWeight: '800' },
  subtitle: { color: '#78716C', fontSize: 13, marginTop: 4 },
  price: { color: '#1C1917', fontSize: 22, fontWeight: '900', marginTop: 8 },

  sections: { paddingHorizontal: 16, paddingTop: 24, gap: 28 },

  sectionTitle: {
    color: '#A8A29E',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 12,
  },

  greyBox: { backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', borderRadius: 16 },
  boxPadded: { paddingHorizontal: 16, paddingVertical: 16 },
  boxRows: { paddingHorizontal: 16, paddingVertical: 4 },

  description: { color: '#57534E', fontSize: 14, lineHeight: 21 },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  rowLabel: { color: '#78716C', fontSize: 14, flexShrink: 0 },
  rowValue: { color: '#1C1917', fontSize: 14, fontWeight: '500', textAlign: 'right', flexShrink: 1 },

  marketHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 4 },
  marketPrice: { color: '#1C1917', fontSize: 20, fontWeight: '900' },
  marketPpm: { color: '#78716C', fontSize: 12 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(0,0,0,0.08)', marginVertical: 12 },

  footer: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  pill: { backgroundColor: ACCENT, borderRadius: 9999, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  pillLeft: { flex: 1 },
  pillRight: { paddingHorizontal: 4 },
  cta: { alignItems: 'center', gap: 2, paddingVertical: 10, paddingHorizontal: 12 },
  ctaGrow: { flex: 1 },
  ctaLabel: { color: '#fff', fontSize: 10, fontWeight: '600' },
  ctaDivider: { width: StyleSheet.hairlineWidth, height: 24, backgroundColor: 'rgba(255,255,255,0.2)' },
})
