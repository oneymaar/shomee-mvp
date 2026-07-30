import { forwardRef, useCallback, useMemo, useState } from 'react'
import { Alert, Linking, Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native'
import {
  BottomSheetBackdrop,
  BottomSheetFooter,
  BottomSheetModal,
  BottomSheetScrollView,
  useBottomSheetModal,
  type BottomSheetBackdropProps,
  type BottomSheetFooterProps,
} from '@gorhom/bottom-sheet'
import { useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { CalendarPlus, Check, Footprints, Heart, HelpCircle, Map, MapPin, Maximize2, MessageCircle, Phone, Send, X } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Path, Text as SvgText } from 'react-native-svg'
import type { Property } from '@shomee/core/types/domain'
import { DEFAULT_FALLBACK_IMAGE } from '@shomee/core/constants'
import { useShomeeStore } from '@/lib/stores'
import { PropertyMediaTabs } from '@/components/property/PropertyMediaTabs'
import {
  MapZone,
  MOBILE_MAP_AVAILABLE,
  POI_COLORS,
  POI_LABELS,
} from '@/components/property/MapZone'
import { useNearbyPois, type PoiCat } from '@/lib/useNearbyPois'

// TODO: numéro de test — remplacer par le téléphone de l'agence (feed live).
const TEST_PHONE = '0670744935'
const ACCENT = '#A64B27'

// TEMP démo média — appliqués à tous les biens tant que la base n'a ni galerie
// ni plan ni visite (0% aujourd'hui). À REMPLACER par les vrais médias fournis
// (photos réelles + plan + lien de visite virtuelle d'Olivier).
const DEMO_PHOTOS = [
  'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=1000&q=80',
  'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=1000&q=80',
  'https://images.unsplash.com/photo-1615874959474-d609969a20ed?w=1000&q=80',
]
// Plan = carrousel (plusieurs images). Plan démo réel bundlé ; ajouter d'autres
// images (URL ou require) ici pour faire boucler le carrousel Plan.
const DEMO_PLAN_URLS = [
  require('../../assets/plans/plan-demo.png'),
]
// Visite virtuelle réelle fournie par Olivier (Giraffe360).
const DEMO_TOUR_URL = 'https://tour.giraffe360.com/4da4e76c9e9a4af5b95cc2afe33a1a22'

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

/* ── Diagnostics DPE/GES — formes SVG + couleurs ADEME (miroir web) ────────── */
type Grade = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
const DPE_COLORS: Record<Grade, string> = {
  A: '#309630', B: '#59B340', C: '#C3D635', D: '#F2CA00', E: '#F49B14', F: '#E8601A', G: '#C82020',
}
const GES_COLORS: Record<Grade, string> = {
  A: '#C0D5E8', B: '#92B7D3', C: '#6495BE', D: '#4D7DA8', E: '#366592', F: '#214D7C', G: '#0F3566',
}

/** Badge diagnostic : flèche (DPE) ou pilule arrondie à droite (GES), lettre
 *  blanche contourée noir — tout en SVG pour reproduire le WebkitTextStroke web. */
function DiagBadge({ kind, grade, label }: { kind: 'dpe' | 'ges'; grade: Grade; label: string }) {
  const W = 76
  const H = 36
  const R = H / 2
  const color = (kind === 'dpe' ? DPE_COLORS : GES_COLORS)[grade]
  const shape =
    kind === 'dpe'
      ? `M0 0 H${W - 11} L${W} ${R} L${W - 11} ${H} H0 Z` // flèche pointant à droite
      : `M0 0 H${W - R} A${R} ${R} 0 0 1 ${W - R} ${H} H0 Z` // pilule arrondie à droite
  return (
    <View style={styles.diag}>
      <Text style={styles.diagLabel}>{label}</Text>
      <Svg width={W} height={H}>
        <Path d={shape} fill={color} />
        {/* Lettre contourée en DEUX passes : stroke noir derrière, fill blanc
            devant → émule le paintOrder:'stroke fill' du web et évite le double
            tracé d'un stroke+fill sur un seul <SvgText> (contour centré sur le
            glyphe, donc visible des deux côtés). */}
        <SvgText x={12} y={R + 7} fontSize={20} fontWeight="900" textAnchor="start" fill="#000" stroke="#000" strokeWidth={2.4}>
          {grade}
        </SvgText>
        <SvgText x={12} y={R + 7} fontSize={20} fontWeight="900" textAnchor="start" fill="#fff">
          {grade}
        </SvgText>
      </Svg>
    </View>
  )
}

/* ── Transports — parsing + couleurs lignes (miroir web) ───────────────────── */
const METRO_COLORS: Record<string, string> = {
  '1': '#FFCD00', '2': '#003CA6', '3': '#837902', '3b': '#6EC4E8', '4': '#CF009E',
  '5': '#FF7E2E', '6': '#6ECA97', '7': '#FA9ABA', '7b': '#6ECA97', '8': '#E19BDF',
  '9': '#B6BD00', '10': '#C9910D', '11': '#704B1C', '12': '#007852', '13': '#98D4E2', '14': '#62259D',
}
const RER_COLORS: Record<string, string> = {
  A: '#FF2442', B: '#4DA4DC', C: '#FFD200', D: '#00814F', E: '#C25BAA',
}
function parseLine(str: string): { number: string; name: string; color: string; darkText: boolean } {
  // Tokens émis par le backfill : « M1 », « M7bis », « M3bis », « RER A », « TN H ».
  const metro = str.match(/^M(\d{1,2})(bis)?\s+(.+)$/)
  if (metro) {
    const base = metro[1]
    return {
      number: metro[2] ? `${base}b` : base,
      name: metro[3],
      color: METRO_COLORS[base] || '#999',
      darkText: base === '1' || base === '9' || base === '13',
    }
  }
  const rer = str.match(/^RER\s+([A-E])\s+(.+)$/)
  if (rer) {
    const l = rer[1]
    return { number: l, name: rer[2], color: RER_COLORS[l] || '#999', darkText: l === 'C' }
  }
  const tn = str.match(/^TN\s+([A-Z]{1,2})\s+(.+)$/)
  if (tn) return { number: tn[1], name: tn[2], color: '#8D5BA6', darkText: false }
  return { number: str, name: str, color: '#666', darkText: false }
}
function getTransportType(str: string): 'metro' | 'rer' | 'transilien' {
  if (str.match(/^M\d/)) return 'metro'
  if (str.match(/^RER/)) return 'rer'
  if (str.match(/^TN/)) return 'transilien'
  return 'metro'
}
const TRANSPORT_ORDER = ['metro', 'rer', 'transilien'] as const
const TRANSPORT_LABELS: Record<string, string> = { metro: 'Métro', rer: 'RER', transilien: 'Transilien' }

type Badge = { number: string; color: string; darkText: boolean }

/** Regroupe les lignes par station (ordre de proximité conservé, lignes dédupliquées). */
function groupStations(strs: string[]): Array<{ name: string; badges: Badge[] }> {
  // NB : `Map` global est shadowé par l'icône lucide `Map` → on utilise un objet.
  const order: string[] = []
  const byStation: Record<string, Badge[]> = {}
  for (const s of strs) {
    const p = parseLine(s)
    let badges = byStation[p.name]
    if (!badges) {
      badges = []
      byStation[p.name] = badges
      order.push(p.name)
    }
    if (!badges.some((b) => b.number === p.number)) {
      badges.push({ number: p.number, color: p.color, darkText: p.darkText })
    }
  }
  return order.map((name) => ({ name, badges: byStation[name] ?? [] }))
}

function StationRow({ name, badges, walk }: { name: string; badges: Badge[]; walk?: number }) {
  return (
    <View style={styles.transportItem}>
      <View style={styles.badgeRow}>
        {badges.map((b) => (
          <View key={b.number} style={[styles.lineBadge, { backgroundColor: b.color }]}>
            <Text style={[styles.lineNumber, { color: b.darkText ? '#000' : '#fff' }]}>{b.number}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.transportName} numberOfLines={1}>
        {name}
      </Text>
      {walk != null && (
        <View style={styles.walkRow}>
          <Footprints size={11} color="#A8A29E" />
          <Text style={styles.walkTime}>{walk} min</Text>
        </View>
      )}
    </View>
  )
}

/* ── Composant ─────────────────────────────────────────────────────────────── */
interface Props {
  property: Property | null
}

/**
 * PropertyDetailSheet mobile — Pass 1+2 (S4b-v2b).
 *
 * Ossature `@gorhom/bottom-sheet` (modal présenté impérativement par le feed) +
 * image principale (poster, galerie différée) + sections mirrorées du sheet web :
 * Description, Quartier (carte → placeholder), Caractéristiques, Diagnostics
 * (DPE/GES en SVG), Composition, Marché. Galerie → passe média ultérieure.
 */
export const PropertyDetailSheet = forwardRef<BottomSheetModal, Props>(
  function PropertyDetailSheet({ property }, ref) {
    const insets = useSafeAreaInsets()
    const router = useRouter()
    const { dismiss } = useBottomSheetModal()
    const snapPoints = useMemo(() => ['92%'], [])

    // Favori abonné à CE bien (toggle + compteur des pills bas).
    const isFavorite = useShomeeStore((s) =>
      property ? s.favorites.some((f) => f.id === property.id) : false,
    )
    const toggleFavorite = useShomeeStore((s) => s.toggleFavorite)

    // Carte plein écran (au tap sur la vignette) — mêmes composants, cadrage
    // élargi et interactions Leaflet rendues à l'acquéreur.
    const [mapFull, setMapFull] = useState(false)
    // Repères de quartier OpenStreetMap. Best-effort : [] tant que la réponse
    // n'est pas là, et [] définitivement si Overpass ne répond pas.
    const pois = useNearbyPois(property?.mapLat, property?.mapLng)
    const poiCounts = useMemo(() => {
      const c: Partial<Record<PoiCat, number>> = {}
      for (const p of pois) c[p.cat] = (c[p.cat] ?? 0) + 1
      return c
    }, [pois])
    const hasMap = Boolean(property?.mapLat && property?.mapLng && MOBILE_MAP_AVAILABLE)

    // Features → puces ✓ sous l'en-tête. Même filtre que le feed (« Cave » est
    // déjà listé dans Caractéristiques) pour la cohérence visuelle.
    const features = property ? (property.features ?? []).filter((f) => f !== 'Cave') : []
    // Temps de marche par station (pré-calculé au backfill ; min si plusieurs quais).
    const walkByStation: Record<string, number> = {}
    for (const mt of property?.mapTransports ?? []) {
      if (mt.walkMin != null) {
        walkByStation[mt.name] =
          walkByStation[mt.name] == null ? mt.walkMin : Math.min(walkByStation[mt.name], mt.walkMin)
      }
    }

    // Badge agence — même logique que le feed (PropertyOverlay) : logo agence,
    // sinon avatar agent, sinon initiale. Repris pour la cohérence visuelle.
    const brandName = property ? property.agencyName ?? property.agentName : ''
    const brandLogo = property ? property.agencyLogo ?? property.agentAvatar : null
    const brandInitial = (brandName.trim().charAt(0) || '?').toUpperCase()

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

    // Ouvre le fil de discussion du bien (crée la conversation à l'envoi du 1er
    // message côté thread) — parité web `onMessage`. On ferme d'abord la sheet.
    const handleMessage = useCallback(() => {
      if (!property) return
      dismiss()
      router.push({ pathname: '/messages/[id]', params: { id: property.id } })
    }, [property, dismiss, router])

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
        return (
          <BottomSheetFooter {...props} bottomInset={insets.bottom}>
            <View style={styles.footer}>
              {/* Pill gauche — 3 CTA à parts égales (flex:1 chacun) */}
              <View style={[styles.pill, styles.pillLeft]}>
                <CtaButton icon={MessageCircle} label="Message" onPress={handleMessage} grow />
                <Divider />
                <CtaButton icon={Phone} label="Appeler" onPress={handleCall} grow />
                <Divider />
                <CtaButton icon={CalendarPlus} label="Visiter" onPress={() => {}} grow />
              </View>
              {/* Pill droite — Like + Share */}
              <View style={[styles.pill, styles.pillRight]}>
                <CtaButton
                  icon={Heart}
                  active={isFavorite}
                  onPress={() => toggleFavorite(property)}
                />
                <Divider />
                <CtaButton icon={Send} onPress={handleShare} />
              </View>
            </View>
          </BottomSheetFooter>
        )
      },
      [property, isFavorite, insets.bottom, handleCall, handleMessage, handleShare, toggleFavorite],
    )

    return (
      <>
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
            {/* En-tête texte — AU-DESSUS du média, repris de la fiche web :
                agence · prix + €/m² · localisation · chips stats · features. */}
            <View style={styles.header}>
              {/* Badge agence — logo rond + nom */}
              <View style={styles.agencyRow}>
                <View style={styles.logo}>
                  {brandLogo ? (
                    <Image source={{ uri: brandLogo }} style={styles.logoImg} contentFit="contain" />
                  ) : (
                    <Text style={styles.logoInitial}>{brandInitial}</Text>
                  )}
                </View>
                <Text style={styles.agencyName} numberOfLines={1}>
                  {brandName}
                </Text>
              </View>

              {/* Prix + prix/m² */}
              <View style={styles.priceRow}>
                <Text style={styles.price}>{euro(property.price)}</Text>
                <Text style={styles.perSqm}>
                  soit{' '}
                  {perSqm(
                    property.pricePerSqm ?? Math.round(property.price / Math.max(property.surface, 1)),
                  )}
                </Text>
              </View>

              {/* Localisation — épingle + arrondissement · quartier */}
              <View style={styles.locationRow}>
                <MapPin size={12} color="#A8A29E" strokeWidth={2.5} />
                <Text style={styles.location}>
                  {property.arrondissement}
                  {property.district ? ` · ${property.district}` : ''}
                </Text>
              </View>

              {/* Chips stats */}
              <View style={styles.chipsRow}>
                {[
                  `${property.surface} m²`,
                  `${property.rooms} pièces`,
                  ...(property.bedrooms != null ? [`${property.bedrooms} ch.`] : []),
                ].map((v) => (
                  <View key={v} style={styles.statChip}>
                    <Text style={styles.statChipTxt}>{v}</Text>
                  </View>
                ))}
              </View>

              {/* Équipements — puces ✓ vertes (même rendu que le feed) */}
              {features.length > 0 && (
                <View style={styles.featuresRow}>
                  {features.map((f) => (
                    <View key={f} style={styles.chip}>
                      <Check size={11} color="#34d399" strokeWidth={3} />
                      <Text style={styles.chipTxt}>{f}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Critères NON matchés (grisés, ✗) puis doutes (?) — spec
                  scoring : la fiche montre aussi ce qui ne colle pas. */}
              {(property?.matchDetail?.unmatched?.length ?? 0) > 0 && (
                <View style={styles.featuresRow}>
                  {property!.matchDetail!.unmatched.map((c) => (
                    <View key={`um-${c.label}`} style={styles.chip}>
                      <X size={11} color="#a8a29e" strokeWidth={3} />
                      <Text style={styles.chipTxtMuted}>{c.label}</Text>
                    </View>
                  ))}
                  {property!.matchDetail!.doubts.map((c) => (
                    <View key={`db-${c.label}`} style={styles.chip}>
                      <HelpCircle size={11} color="#d97706" strokeWidth={2.5} />
                      <Text style={styles.chipTxtDoubt}>{c.label}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.headerDivider} />

            {/* Média : onglets Visite virtuelle | Plan | Photos + zone hero.
                Fallback : gallery vide → le poster devient l'unique photo. */}
            <View style={styles.mediaWrap}>
              <PropertyMediaTabs
                photos={
                  property.gallery.length > 0
                    ? property.gallery
                    : [property.imageUrlFallback || DEFAULT_FALLBACK_IMAGE, ...DEMO_PHOTOS]
                }
                planUrls={DEMO_PLAN_URLS}
                virtualTourUrl={property.matterportUrl ?? DEMO_TOUR_URL}
                coverUrl={property.imageUrlFallback || DEFAULT_FALLBACK_IMAGE}
              />
            </View>

            <View style={styles.sections}>
              {/* Description */}
              <View>
                <SectionTitle>Description</SectionTitle>
                <GreyBox style={styles.boxPadded}>
                  <Text style={styles.description}>{property.description}</Text>
                </GreyBox>
              </View>

              {/* Quartier */}
              {(hasMap ||
                property.irisZone ||
                (property.transports?.length ?? 0) > 0 ||
                (property.nearbyPlaces?.length ?? 0) > 0 ||
                property.neighborhoodVibe) && (
                <View>
                  <SectionTitle>Quartier</SectionTitle>

                  {property.irisZone && (
                    <View style={styles.irisBlock}>
                      <Text style={styles.irisZone}>{property.irisZone}</Text>
                      {property.irisDescription && (
                        <Text style={styles.irisDesc}>{property.irisDescription}</Text>
                      )}
                    </View>
                  )}

                  {/* Carte quartier — Leaflet (WebView) : zone IRIS + stations
                      étiquetées + repères OpenStreetMap. Figée ici (les gestes
                      Leaflet se disputeraient le défilement de la feuille) : le
                      tap ouvre la version manipulable en plein écran.
                      Fallback placeholder si WebView indispo ou bien sans coords. */}
                  {hasMap ? (
                    <>
                      <View>
                        <MapZone
                          lat={property.mapLat!}
                          lng={property.mapLng!}
                          polygon={property.irisPolygon}
                          transports={property.mapTransports}
                          pois={pois}
                          legacyPois={property.mapPois}
                          height={260}
                          interactive={false}
                          fit="near"
                        />
                        {/* Le Pressable est POSÉ SUR la carte, jamais autour :
                            une WebView consomme le toucher et un parent
                            Pressable ne verrait jamais le tap (même motif que
                            le bouton plein écran de PropertyMediaTabs). */}
                        <Pressable
                          style={StyleSheet.absoluteFill}
                          onPress={() => setMapFull(true)}
                          accessibilityRole="button"
                          accessibilityLabel="Agrandir la carte du quartier"
                        />
                        <View style={styles.mapExpand} pointerEvents="none">
                          <Maximize2 size={17} color="#fff" strokeWidth={2.2} />
                        </View>
                      </View>

                      {/* Légende — même palette que les points de la carte */}
                      <View style={styles.legendRow}>
                        {(Object.keys(POI_LABELS) as PoiCat[]).map((cat) => (
                          <View key={cat} style={styles.legendItem}>
                            <View style={[styles.legendDot, { backgroundColor: POI_COLORS[cat] }]} />
                            <Text style={styles.legendTxt}>{POI_LABELS[cat]}</Text>
                          </View>
                        ))}
                      </View>
                      <Text style={styles.mapSource}>
                        Repères OpenStreetMap · Toucher la carte pour l&apos;agrandir
                      </Text>
                    </>
                  ) : (
                    <GreyBox style={styles.mapPlaceholder}>
                      <Map size={26} color="#D6D3D1" />
                      <Text style={styles.mapPlaceholderTxt}>Carte du quartier bientôt disponible</Text>
                    </GreyBox>
                  )}

                  {/* Transports groupés par type (métro / RER / tram / bus) */}
                  {property.transports && property.transports.length > 0 && (
                    <GreyBox style={[styles.boxRows, styles.qSpace]}>
                      {TRANSPORT_ORDER.map((type) => {
                        const strs = (property.transports ?? []).filter((t) => getTransportType(t) === type)
                        if (!strs.length) return null
                        return (
                          <View key={type}>
                            <Text style={styles.transportGroup}>{TRANSPORT_LABELS[type]}</Text>
                            {groupStations(strs).map((g) => (
                              <StationRow
                                key={g.name}
                                name={g.name}
                                badges={g.badges}
                                walk={walkByStation[g.name]}
                              />
                            ))}
                          </View>
                        )
                      })}
                    </GreyBox>
                  )}

                  {/* À proximité + Ambiance */}
                  {((property.nearbyPlaces?.length ?? 0) > 0 || property.neighborhoodVibe) && (
                    <GreyBox style={styles.boxRows}>
                      {property.nearbyPlaces && property.nearbyPlaces.length > 0 && (
                        <View style={styles.row}>
                          <Text style={styles.rowLabel}>À proximité</Text>
                          <View style={styles.nearbyCol}>
                            {property.nearbyPlaces.map((pl) => (
                              <Text key={pl} style={styles.nearbyItem}>{pl}</Text>
                            ))}
                          </View>
                        </View>
                      )}
                      <Row label="Ambiance" value={property.neighborhoodVibe} />
                    </GreyBox>
                  )}
                </View>
              )}

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

              {/* Diagnostics — DPE flèche, GES pilule (SVG) */}
              <View>
                <SectionTitle>Diagnostics</SectionTitle>
                <GreyBox style={styles.diagBox}>
                  <DiagBadge kind="dpe" grade={property.dpe} label="DPE — Énergie" />
                  {property.ges && <DiagBadge kind="ges" grade={property.ges} label="GES — Climat" />}
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

      {/* Carte plein écran — hors du BottomSheetModal (une Modal RN est une vue
          native posée au-dessus de tout). Cadrage `all` : toutes les stations
          entrent dans l'écran, y compris celles à plus de 8 min. */}
      {mapFull && property && hasMap && (
        <Modal visible animationType="slide" onRequestClose={() => setMapFull(false)} statusBarTranslucent>
          <View style={styles.fsRoot}>
            <MapZone
              lat={property.mapLat!}
              lng={property.mapLng!}
              polygon={property.irisPolygon}
              transports={property.mapTransports}
              pois={pois}
              legacyPois={property.mapPois}
              interactive
              fit="all"
              style={styles.fsMap}
            />
            <Pressable
              style={[styles.fsClose, { top: insets.top + 8 }]}
              onPress={() => setMapFull(false)}
              hitSlop={12}
            >
              <X size={24} color="#fff" strokeWidth={2.4} />
            </Pressable>
            <View style={[styles.fsLegend, { bottom: insets.bottom + 20 }]} pointerEvents="none">
              {(Object.keys(POI_LABELS) as PoiCat[]).map((cat) => (
                <View key={cat} style={styles.fsLegendItem}>
                  <View style={[styles.legendDot, { backgroundColor: POI_COLORS[cat] }]} />
                  <Text style={styles.fsLegendTxt}>{POI_LABELS[cat]}</Text>
                  <Text style={styles.fsLegendCount}>{poiCounts[cat] ?? 0}</Text>
                </View>
              ))}
            </View>
          </View>
        </Modal>
      )}
      </>
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
  label?: string
  onPress: () => void
  active?: boolean
  /** flex:1 → utilisé seulement dans la pill gauche (3 boutons à parts égales).
   *  La pill droite (Like/Share) reste dimensionnée par son contenu. */
  grow?: boolean
}) {
  return (
    <Pressable onPress={onPress} style={[styles.cta, grow && styles.ctaGrow]} hitSlop={6}>
      <Icon size={18} strokeWidth={1.8} color="#fff" fill={active ? '#fff' : 'transparent'} />
      {label ? <Text style={styles.ctaLabel}>{label}</Text> : null}
    </Pressable>
  )
}

function Divider() {
  return <View style={styles.ctaDivider} />
}

const styles = StyleSheet.create({
  sheetBg: { backgroundColor: '#FDF5F2' },
  handle: { backgroundColor: '#D6D3D1', width: 40 },
  content: { paddingBottom: 120 },

  hero: { width: '100%', height: 220, backgroundColor: '#E7E5E4' },

  header: { paddingHorizontal: 16, paddingTop: 16 },
  agencyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  logo: {
    width: 32, height: 32, borderRadius: 16, overflow: 'hidden', backgroundColor: '#171717',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)', alignItems: 'center', justifyContent: 'center',
  },
  logoImg: { width: '100%', height: '100%' },
  logoInitial: { color: '#fff', fontSize: 12, fontWeight: '700' },
  agencyName: { color: '#1C1917', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 8, marginTop: 4 },
  price: { color: '#1C1917', fontSize: 24, fontWeight: '900', lineHeight: 26 },
  perSqm: { color: '#78716C', fontSize: 12 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  location: { color: '#1C1917', fontSize: 14, fontWeight: '500' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  statChip: {
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statChipTxt: { color: '#292524', fontSize: 12, fontWeight: '600' },
  headerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.08)',
    marginTop: 14,
    marginHorizontal: 16,
  },
  mediaWrap: { marginTop: 12 },

  featuresRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 8, marginTop: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chipTxt: { color: '#44403C', fontSize: 13 },
  chipTxtMuted: { color: '#a8a29e', fontSize: 13, textDecorationLine: 'line-through' },
  chipTxtDoubt: { color: '#b45309', fontSize: 13 },

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

  // Quartier
  irisBlock: { marginBottom: 12 },
  irisZone: { color: '#1C1917', fontSize: 14, fontWeight: '600' },
  irisDesc: { color: '#78716C', fontSize: 12, lineHeight: 17, marginTop: 2 },
  mapPlaceholder: { height: 150, alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 12 },
  mapPlaceholderTxt: { color: '#A8A29E', fontSize: 12 },
  qSpace: { marginBottom: 12 },
  transportGroup: {
    color: '#A8A29E', fontSize: 9, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 1, paddingTop: 8, paddingBottom: 2,
  },
  transportItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  lineBadge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  lineNumber: { fontSize: 10, fontWeight: '900' },
  transportName: { color: '#57534E', fontSize: 14, flexShrink: 1 },
  walkRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto' },
  walkTime: { color: '#A8A29E', fontSize: 12, fontWeight: '600' },
  nearbyCol: { alignItems: 'flex-end', gap: 2, flexShrink: 1 },
  nearbyItem: { color: '#57534E', fontSize: 14, textAlign: 'right' },

  // Carte quartier
  mapExpand: {
    position: 'absolute', top: 10, right: 10, width: 32, height: 32, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 9 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendTxt: { color: '#78716c', fontSize: 10.5, fontWeight: '500' },
  mapSource: { color: '#A8A29E', fontSize: 10, marginTop: 6, marginBottom: 12 },

  // Carte plein écran
  fsRoot: { flex: 1, backgroundColor: '#FDF5F2' },
  fsMap: { flex: 1, height: '100%', borderRadius: 0, borderWidth: 0 },
  fsClose: {
    position: 'absolute', right: 14, width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  fsLegend: {
    position: 'absolute', left: 14, backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11, gap: 7,
    shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  fsLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  fsLegendTxt: { color: '#44403c', fontSize: 11.5, fontWeight: '500' },
  fsLegendCount: { color: '#A8A29E', fontSize: 11.5, fontWeight: '700' },

  // Diagnostics
  diagBox: { paddingHorizontal: 16, paddingVertical: 16, flexDirection: 'row', gap: 24 },
  diag: { flex: 1 },
  diagLabel: {
    color: '#A8A29E', fontSize: 9, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 8,
  },

  footer: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  pill: { backgroundColor: ACCENT, borderRadius: 9999, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  pillLeft: { flex: 1 },
  pillRight: { paddingHorizontal: 4 },
  cta: { alignItems: 'center', gap: 2, paddingVertical: 10, paddingHorizontal: 12 },
  ctaGrow: { flex: 1 },
  ctaLabel: { color: '#fff', fontSize: 10, fontWeight: '600' },
  ctaDivider: { width: StyleSheet.hairlineWidth, height: 24, backgroundColor: 'rgba(255,255,255,0.2)' },
})
