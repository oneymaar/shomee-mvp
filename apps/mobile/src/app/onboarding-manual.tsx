/**
 * Funnel d'onboarding MANUEL natif — l'étape Quartiers est le proto « deux
 * moments » (saisie + carte) affiché dans une WebView plein écran (préchargement
 * de la carte + morph fluide gérés par le proto). Puis wizard natif Bien /
 * Budget / Critères + récap éditable.
 *
 * Point d'entrée : bouton « Rechercher à la main » (profil).
 * NE casse PAS la route handoff `onboarding.tsx` (fichier distinct).
 */
import { useCallback, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { generateFeedFromStore } from '@/lib/handoff'
import { WizardProgress } from '@/components/onboarding/WizardProgress'
import { QuartierProtoWebView } from '@/components/onboarding/QuartierProtoWebView'
import { StepBien } from '@/components/onboarding/StepBien'
import { StepBudget } from '@/components/onboarding/StepBudget'
import { StepCriteres } from '@/components/onboarding/StepCriteres'
import { Recap } from '@/components/onboarding/Recap'
import { SearchStagingLoader } from '@/components/onboarding/SearchStagingLoader'
import { FeedSuggestion } from '@/components/feed/FeedSuggestion'
import { diagnoseSearch } from '@/lib/searchDiagnosis'
import { useFeedStore, useSearchStore } from '@/lib/stores'
import { BG, ACCENT, INK, MUTED } from '@/components/onboarding/ui'

const LOGO = require('../../assets/images/logo-shomee-terracotta.png')

type Phase = 'idle' | 'generating' | 'empty' | 'error'

export default function ManualOnboarding() {
  const router = useRouter()
  // Ouverture directe sur le récap depuis « Modifier la recherche » (profil).
  const params = useLocalSearchParams<{ recap?: string }>()
  const openedAtRecap = params.recap === '1'
  const [step, setStep] = useState<1 | 2 | 3 | 4>(openedAtRecap ? 4 : 1)
  const [recapOpen, setRecapOpen] = useState(openedAtRecap)
  const [editing, setEditing] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')

  const handleNext = useCallback(() => {
    if (editing) { setEditing(false); setRecapOpen(true); return }
    if (step < 4) { setStep((s) => (s + 1) as 1 | 2 | 3 | 4); return }
    setRecapOpen(true) // après l'étape 4 → récap
  }, [editing, step])

  const handleBack = useCallback(() => {
    // Récap ouvert directement (bouton « Modifier la recherche ») → retour = sortie.
    if (recapOpen) { if (openedAtRecap) { router.back(); return } setRecapOpen(false); return }
    if (editing) { setEditing(false); setRecapOpen(true); return }
    if (step === 1) { router.back(); return }
    setStep((s) => (s - 1) as 1 | 2 | 3 | 4)
  }, [recapOpen, editing, step, router, openedAtRecap])

  const editBlock = useCallback((target: 1 | 2 | 3 | 4) => {
    setRecapOpen(false); setEditing(true); setStep(target)
  }, [])

  const editManual = useCallback(() => {
    setRecapOpen(false); setEditing(false); setStep(1)
  }, [])

  // Le calcul + la navigation sont pilotés par SearchStagingLoader (mise en
  // scène ~7 s). Ici on ne fait que basculer sur l'écran de chargement.
  const launch = useCallback(() => {
    setPhase('generating')
  }, [])

  // Sortie commune des écrans « aucun bien » et « erreur » : on revient au
  // brief, seul endroit où TOUTE la recherche est modifiable. Un seul geste,
  // un seul libellé — « Revoir mon brief ».
  const backToRecap = useCallback(() => {
    setPhase('idle')
    setRecapOpen(true)
  }, [])

  // ── Écrans de génération (loading / aucun bien / erreur) ─────────────────
  if (phase === 'generating') {
    return (
      <SearchStagingLoader
        run={generateFeedFromStore}
        getCount={() => useFeedStore.getState().properties.length}
        onFinish={(outcome) => {
          if (outcome === 'ok') router.replace('/(tabs)')
          else setPhase(outcome === 'empty' ? 'empty' : 'error')
        }}
      />
    )
  }
  // Aucun bien trouvé — ce n'est PAS une erreur : la recherche a abouti, elle
  // est simplement trop étroite. Même écran que les intercalaires du feed
  // (constat → proposition pré-positionnée → validation), avec le déclencheur
  // `empty` : le diagnostic met alors les critères rédhibitoires en tête, eux
  // seuls pouvant vider un feed à eux tout seuls.
  if (phase === 'empty') {
    return (
      <View style={styles.root}>
        <FeedSuggestion
          diagnosis={diagnoseSearch(useSearchStore.getState(), 'empty')}
          onApply={() => setPhase('generating')}
          onDismiss={backToRecap}
          onEditBrief={backToRecap}
        />
      </View>
    )
  }
  if (phase === 'error') {
    return (
      <View style={styles.overlay}>
        <Image source={LOGO} style={styles.logo} contentFit="contain" />
        <Text style={styles.overlayTitle}>Oups</Text>
        <Text style={styles.overlayText}>
          Impossible de préparer votre sélection. Réessayez.
        </Text>
        <Pressable style={styles.retry} onPress={launch} hitSlop={8}>
          <Text style={styles.retryTxt}>Réessayer</Text>
        </Pressable>
        <Pressable onPress={backToRecap} hitSlop={8}>
          <Text style={styles.retryAlt}>Revoir mon brief</Text>
        </Pressable>
      </View>
    )
  }

  // ── Étape 1 — proto « deux moments » plein écran (barre de progression +
  //    retour intégrés dans le proto lui-même). ──────────────────────────────
  if (step === 1 && !recapOpen) {
    return <QuartierProtoWebView onValidate={handleNext} onBack={handleBack} />
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.topbar}>
        <Pressable onPress={handleBack} style={styles.backBtn} hitSlop={8}>
          <ChevronLeft size={18} color="#525252" />
        </Pressable>
        {!recapOpen && <WizardProgress step={step} />}
        {recapOpen && <View style={{ flex: 1 }} />}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {recapOpen ? (
          <Recap onEditBlock={editBlock} onEditManual={editManual} onLaunch={launch} />
        ) : step === 2 ? (
          <StepBien onNext={handleNext} />
        ) : step === 3 ? (
          <StepBudget onNext={handleNext} />
        ) : (
          <StepCriteres onNext={handleNext} />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  logo: { width: 132, height: 44 },
  overlayTitle: { fontSize: 18, fontWeight: '700', color: INK, marginTop: 24 },
  overlayText: { fontSize: 15, color: MUTED, textAlign: 'center', marginTop: 12, lineHeight: 21 },
  retry: { marginTop: 24, backgroundColor: ACCENT, paddingHorizontal: 28, paddingVertical: 13, borderRadius: 999 },
  retryTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  retryAlt: { color: ACCENT, fontSize: 13.5, fontWeight: '500', marginTop: 16 },
})
