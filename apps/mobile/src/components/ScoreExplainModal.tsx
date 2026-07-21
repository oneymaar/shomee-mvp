import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Check, HelpCircle, X } from 'lucide-react-native'
import type { MatchCriterionRef, Property } from '@shomee/core/types/domain'

const TERRACOTTA = '#A64B27'
const CREAM = '#FDF5F2'

interface Props {
  property: Property
  visible: boolean
  onClose: () => void
}

/**
 * Modale d'explication du score (spec Olivier) — s'ouvre au tap sur le
 * MatchBadge. Trois sections issues de `property.matchDetail` (transporté
 * par /api/properties) :
 *   ✓ critères matchés   ✗ critères non-matchés   ? doutes (non renseigné)
 *
 * La section doutes est la matérialisation du TRI-ÉTAT (D1) : le système
 * dit honnêtement ce qu'il ne sait pas, au lieu de le compter faux.
 */
export function ScoreExplainModal({ property, visible, onClose }: Props) {
  const detail = property.matchDetail
  if (!detail) return null

  const rows = (items: MatchCriterionRef[], kind: 'ok' | 'ko' | 'doubt') =>
    items.map((c, i) => (
      <View key={`${kind}-${c.label}-${i}`} style={styles.row}>
        {kind === 'ok' && <Check size={14} color="#34d399" strokeWidth={3} />}
        {kind === 'ko' && <X size={14} color="#a8a29e" strokeWidth={3} />}
        {kind === 'doubt' && <HelpCircle size={14} color="#d97706" strokeWidth={2.5} />}
        <Text style={[styles.rowTxt, kind === 'ko' && styles.rowTxtMuted]}>
          {c.label}
        </Text>
        {c.importance !== 'desired' && (
          <Text style={styles.importanceTag}>
            {c.importance === 'dealbreaker' ? 'rédhibitoire' : 'obligatoire'}
          </Text>
        )}
      </View>
    ))

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          {/* En-tête : score + fermeture */}
          <View style={styles.header}>
            <View style={styles.scoreDisc}>
              <Text style={styles.scorePct}>{detail.score100}%</Text>
              <Text style={styles.scoreLbl}>MATCH</Text>
            </View>
            <View style={styles.headerTxt}>
              <Text style={styles.title}>Pourquoi ce score ?</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {property.arrondissement} · {property.surface} m²
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <X size={18} color="#78716c" />
            </Pressable>
          </View>

          {property.discoveryDelta && (
            <View style={styles.deltaBanner}>
              <Text style={styles.deltaTxt}>
                Hors de vos critères — {property.discoveryDelta}
              </Text>
            </View>
          )}

          <ScrollView style={styles.scroll} bounces={false}>
            {detail.matched.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Critères validés</Text>
                {rows(detail.matched, 'ok')}
              </View>
            )}
            {detail.unmatched.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Non remplis</Text>
                {rows(detail.unmatched, 'ko')}
              </View>
            )}
            {detail.doubts.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>À vérifier avec l'agent</Text>
                {rows(detail.doubts, 'doubt')}
                <Text style={styles.doubtHint}>
                  Ces informations ne sont pas renseignées sur l'annonce — le
                  score en tient compte sans les pénaliser comme des défauts.
                </Text>
              </View>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: CREAM,
    borderRadius: 24,
    maxHeight: '78%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    paddingBottom: 12,
  },
  scoreDisc: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 3,
    borderColor: TERRACOTTA,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  scorePct: { color: TERRACOTTA, fontWeight: '900', fontSize: 14, lineHeight: 16 },
  scoreLbl: { color: TERRACOTTA, fontWeight: '700', fontSize: 6.5, letterSpacing: 0.5 },
  headerTxt: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '700', color: '#1c1917' },
  subtitle: { fontSize: 12, color: '#78716c', marginTop: 2 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deltaBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: 'rgba(217,119,6,0.1)',
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  deltaTxt: { color: '#b45309', fontSize: 12.5, fontWeight: '600' },
  scroll: { paddingHorizontal: 16 },
  section: { marginBottom: 16 },
  sectionTitle: {
    color: '#A8A29E',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  rowTxt: { color: '#292524', fontSize: 13.5, flexShrink: 1 },
  rowTxtMuted: { color: '#a8a29e', textDecorationLine: 'line-through' },
  importanceTag: {
    marginLeft: 'auto',
    color: TERRACOTTA,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  doubtHint: { color: '#a8a29e', fontSize: 11.5, marginTop: 6, lineHeight: 15 },
})
