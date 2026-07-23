/**
 * Écran de connexion (premier lancement) — Apple, Google, et « Continuer sans
 * compte » (invité persistant). Affiché par le gate racine tant qu'aucune
 * session n'existe. Apple ne s'affiche que sur iOS avec le module dispo ;
 * Google se masque tout seul si indisponible ; l'invité est toujours proposé.
 */
import { useState } from 'react'
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { appleModuleAvailable, signInWithApple } from './appleAuth'
import { GoogleSignInButton } from './GoogleSignInButton'
import { useAuth, loginGuest, loginApple, loginGoogleIdToken } from '@/lib/authStore'

const BG = '#FDF5F2'
const ACCENT = '#A64B27'
const INK = '#1c1917'
const MUTED = '#78716c'

export function AuthScreen() {
  const { busy } = useAuth()
  const [error, setError] = useState<string | null>(null)

  const showApple = Platform.OS === 'ios' && appleModuleAvailable

  const onApple = async () => {
    setError(null)
    const ok = await loginApple()
    if (!ok) setError('La connexion Apple n’a pas abouti.')
  }
  const onGoogle = async (idToken: string) => {
    setError(null)
    const ok = await loginGoogleIdToken(idToken)
    if (!ok) setError('La connexion Google n’a pas abouti.')
  }
  const onGuest = async () => {
    setError(null)
    const ok = await loginGuest()
    if (!ok) setError('Impossible de continuer pour le moment. Réessayez.')
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.hero}>
        <Text style={styles.wordmark}>SHOMEE</Text>
        <Text style={styles.tagline}>La recherche immobilière, en vidéo.</Text>
      </View>

      <View style={styles.actions}>
        {showApple && (
          <Pressable
            style={({ pressed }) => [styles.apple, busy && styles.disabled, pressed && styles.pressed]}
            onPress={onApple}
            disabled={busy}
            hitSlop={6}
          >
            <Text style={styles.appleGlyph}>{''}</Text>
            <Text style={styles.appleLabel}>Se connecter avec Apple</Text>
          </Pressable>
        )}

        <GoogleSignInButton onIdToken={onGoogle} disabled={busy} />

        <Pressable style={styles.guest} onPress={onGuest} disabled={busy} hitSlop={6}>
          {busy ? (
            <ActivityIndicator color={ACCENT} />
          ) : (
            <Text style={styles.guestLabel}>Continuer sans compte</Text>
          )}
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.legal}>
          En continuant, vous acceptez nos conditions d&apos;utilisation et notre politique de
          confidentialité.
        </Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, paddingHorizontal: 28 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  wordmark: { fontSize: 40, fontWeight: '800', letterSpacing: 4, color: ACCENT },
  tagline: { fontSize: 15, color: MUTED, textAlign: 'center' },

  actions: { paddingBottom: 12, gap: 12 },
  apple: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#000000',
  },
  appleGlyph: { color: '#fff', fontSize: 18, marginTop: -2 },
  appleLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },

  guest: { height: 50, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  guestLabel: { fontSize: 15, fontWeight: '600', color: ACCENT, textDecorationLine: 'underline' },

  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.85 },

  error: { fontSize: 13, color: '#b91c1c', textAlign: 'center', marginTop: 2 },
  legal: { fontSize: 11, color: MUTED, textAlign: 'center', lineHeight: 16, marginTop: 4 },
})
