/**
 * Cartes structurées du fil de discussion (côté acquéreur).
 *
 * LA CARTE DES DISPONIBILITÉS EST UNE CARTE DE L'APPLICATION, PAS UN MESSAGE
 * DE L'AGENT — décision d'Olivier (24/08) : un faux message « instantané » de
 * l'agent ferait croire à une réponse humaine, et le silence qui suivrait la
 * première vraie question casserait la confiance. Visuellement, c'est
 * l'application qui organise l'échange ; la vraie réponse de l'agent garde
 * toute sa valeur quand elle arrive.
 */
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { CalendarPlus, CalendarCheck2, Clock3 } from 'lucide-react-native'
import {
  formatAvailabilities,
  formatVisitDateFr,
  type AvailabilitiesPayload,
  type VisitConfirmedPayload,
} from '@shomee/core/visits'
import type { ChatMessage } from '@shomee/core/types/domain'
import { colors, fonts, radii } from '@/lib/theme'
import { visitIcsUrl } from '@/lib/chat'

/** Carte applicative : « Indiquez vos disponibilités ». */
export function AvailabilityPromptCard({ onOpen }: { onOpen: () => void }) {
  return (
    <View style={styles.promptCard}>
      <View style={styles.promptIcon}>
        <Clock3 size={17} color={colors.terracotta} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.promptTitle}>Vos disponibilités aident l&apos;agence à vous répondre</Text>
        <Text style={styles.promptSub}>
          Cochez vos créneaux des deux prochaines semaines — elle vous proposera une heure précise.
        </Text>
        <Pressable onPress={onOpen} style={styles.promptBtn} hitSlop={6}>
          <Text style={styles.promptBtnTxt}>Indiquer mes disponibilités</Text>
        </Pressable>
      </View>
    </View>
  )
}

/** Rendu d'un message `availabilities` — récapitulatif propre plutôt que texte brut. */
export function AvailabilitiesBubble({ msg }: { msg: ChatMessage }) {
  const payload = (msg.payload ?? { days: [] }) as unknown as AvailabilitiesPayload
  return (
    <View style={styles.availBubble}>
      <Text style={styles.availTitle}>Vos disponibilités</Text>
      <Text style={styles.availBody}>{formatAvailabilities(payload)}</Text>
    </View>
  )
}

/** Rendu d'un message `visit_request` (la bulle simple suffit ; le brief
 *  voyage dans le payload pour l'AGENT, l'acquéreur n'a pas à le relire). */
export function VisitRequestBubble() {
  return (
    <View style={styles.requestRow}>
      <CalendarPlus size={13} color={colors.muted} strokeWidth={2} />
      <Text style={styles.requestTxt}>Demande de visite envoyée avec votre recherche</Text>
    </View>
  )
}

/** Carte « visite confirmée » + ajout à l'agenda (.ics). */
export function VisitConfirmedCard({ msg }: { msg: ChatMessage }) {
  const p = (msg.payload ?? {}) as Partial<VisitConfirmedPayload>
  const cancelled = p.status === 'CANCELLED'
  return (
    <View style={[styles.confirmCard, cancelled && styles.confirmCardOff]}>
      <View style={styles.confirmHead}>
        <CalendarCheck2 size={17} color={cancelled ? colors.muted : colors.green} strokeWidth={2} />
        <Text style={[styles.confirmTitle, cancelled && { color: colors.muted }]}>
          {cancelled ? 'Visite annulée' : 'Visite confirmée'}
        </Text>
      </View>
      {p.scheduledAt && (
        <Text style={[styles.confirmDate, cancelled && styles.confirmDateOff]}>
          {formatVisitDateFr(p.scheduledAt)}
        </Text>
      )}
      {!cancelled && p.icsToken && (
        <Pressable
          onPress={() => {
            void Linking.openURL(visitIcsUrl(p.icsToken as string)).catch(() => {})
          }}
          style={styles.icsBtn}
          hitSlop={6}
        >
          <Text style={styles.icsBtnTxt}>Ajouter à mon agenda</Text>
        </Pressable>
      )}
    </View>
  )
}

/** Message système (annulation…) — discret, centré. */
export function SystemLine({ msg }: { msg: ChatMessage }) {
  return <Text style={styles.system}>{msg.text}</Text>
}

const styles = StyleSheet.create({
  promptCard: {
    flexDirection: 'row',
    gap: 11,
    backgroundColor: colors.sand,
    borderRadius: radii.card,
    padding: 14,
    marginVertical: 6,
  },
  promptIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptTitle: { fontSize: 13.5, fontWeight: '600', color: colors.ink, lineHeight: 18 },
  promptSub: { fontSize: 12, color: colors.muted, lineHeight: 17, marginTop: 3 },
  promptBtn: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptBtnTxt: { color: colors.creamOnDark, fontSize: 12.5, fontWeight: '600' },

  availBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: colors.terracotta,
    borderRadius: radii.card,
    borderBottomRightRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginVertical: 3,
  },
  availTitle: {
    color: 'rgba(246,237,230,0.75)',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  availBody: { color: colors.creamOnDark, fontSize: 13.5, lineHeight: 20 },

  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'center',
    marginVertical: 6,
  },
  requestTxt: { fontSize: 11.5, color: colors.muted },

  confirmCard: {
    backgroundColor: 'rgba(53,132,95,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(53,132,95,0.25)',
    borderRadius: radii.card,
    padding: 14,
    marginVertical: 6,
  },
  confirmCardOff: {
    backgroundColor: colors.sand,
    borderColor: colors.line,
  },
  confirmHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  confirmTitle: { fontSize: 13.5, fontWeight: '600', color: colors.green },
  confirmDate: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.ink,
    marginTop: 6,
    textTransform: 'capitalize',
  },
  confirmDateOff: { textDecorationLine: 'line-through', color: colors.muted },
  icsBtn: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: 'rgba(53,132,95,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icsBtnTxt: { color: colors.green, fontSize: 12.5, fontWeight: '600' },

  system: { alignSelf: 'center', fontSize: 11.5, color: '#B7A99D', marginVertical: 6, textAlign: 'center' },
})
