import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { runBriefHandoff, type HandoffOutcome } from '@/lib/handoff'

const BG = '#FAF3EE'
const TERRACOTTA = '#A6512B'
const LOGO = require('../../assets/images/logo-shomee-terracotta.png')

/**
 * Écran de handoff deep-link — capture `shomee://onboarding?brief=<TOKEN>`.
 *
 * expo-router route ce lien ici automatiquement (démarrage à froid ET app déjà
 * ouverte), et `useLocalSearchParams` expose le token. On consomme le brief,
 * on génère le feed personnalisé in-app, puis on remplace l'écran par l'onglet
 * Biens. Un token absent/invalide retombe proprement sur le feed générique.
 *
 * Le cold start SANS lien n'atteint jamais cette route : l'app démarre sur
 * `(tabs)` — comportement inchangé.
 */
type Phase = 'loading' | HandoffOutcome['status']

export default function OnboardingHandoff() {
  const router = useRouter()
  const params = useLocalSearchParams()
  const token = Array.isArray(params.brief) ? params.brief[0] : params.brief
  const [phase, setPhase] = useState<Phase>('loading')
  const startedRef = useRef(false)

  useEffect(() => {
    if (!token || startedRef.current) return
    startedRef.current = true
    let cancelled = false
    ;(async () => {
      const outcome = await runBriefHandoff(token)
      if (cancelled) return
      if (outcome.status === 'success') {
        // Feed personnalisé posé dans le store → on remplace le handoff par les
        // onglets (pas de retour arrière possible vers cet écran transitoire).
        router.replace('/(tabs)')
      } else {
        setPhase(outcome.status)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, router])

  // Lien sans token → rien à consommer, on file au feed générique.
  if (!token) return <Redirect href="/(tabs)" />

  if (phase === 'loading') {
    return (
      <View style={styles.root}>
        <Image source={LOGO} style={styles.logo} contentFit="contain" />
        <ActivityIndicator color={TERRACOTTA} style={styles.spinner} />
        <Text style={styles.title}>Nous préparons votre sélection…</Text>
      </View>
    )
  }

  const message =
    phase === 'not_found'
      ? "Ce lien est introuvable ou a déjà été remplacé."
      : phase === 'expired'
        ? "Ce lien a expiré. Demandez-en un nouveau pour relancer votre recherche."
        : "Un problème est survenu pendant la préparation de votre sélection."

  return (
    <View style={styles.root}>
      <Image source={LOGO} style={styles.logo} contentFit="contain" />
      <Text style={styles.title}>Oups</Text>
      <Text style={styles.message}>{message}</Text>
      <Pressable style={styles.cta} onPress={() => router.replace('/(tabs)')} hitSlop={8}>
        <Text style={styles.ctaTxt}>Voir les biens</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  logo: { width: 132, height: 44, marginBottom: 28 },
  spinner: { marginBottom: 16 },
  title: { color: '#201A16', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  message: { color: '#8A7A6E', fontSize: 15, lineHeight: 21, textAlign: 'center', marginTop: 10 },
  cta: {
    marginTop: 28,
    backgroundColor: TERRACOTTA,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 999,
  },
  ctaTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
