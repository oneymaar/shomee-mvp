/**
 * Bouton « Continuer avec Google » — expo-auth-session (provider Google),
 * require-guardé. Le hook fournit promptAsync + la réponse ; on remonte
 * l'id_token au parent. Se masque tout seul si le module ou le client id
 * (EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID) manquent.
 *
 * NOTE : le flux OAuth Google (redirect reversed-client-id) doit être validé
 * une fois le module installé + le client id iOS créé (rebuild requis).
 */
import { useEffect } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native'

interface GoogleAuthResponse {
  type?: string
  params?: Record<string, string>
  authentication?: { idToken?: string } | null
}
type GoogleAuthHook = (
  config: Record<string, unknown>,
) => [unknown, GoogleAuthResponse | null, () => Promise<unknown>]
interface GoogleProviderModule {
  useIdTokenAuthRequest?: GoogleAuthHook
  useAuthRequest?: GoogleAuthHook
}
interface WebBrowserModule {
  maybeCompleteAuthSession: () => void
}

let googleMod: GoogleProviderModule | null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  googleMod = require('expo-auth-session/providers/google')
} catch {
  googleMod = null
}
let webBrowser: WebBrowserModule | null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  webBrowser = require('expo-web-browser')
} catch {
  webBrowser = null
}
webBrowser?.maybeCompleteAuthSession()

const CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || undefined
const useGoogleIdToken: GoogleAuthHook | null =
  googleMod?.useIdTokenAuthRequest ?? googleMod?.useAuthRequest ?? null

export const googleAvailable = !!useGoogleIdToken && !!CLIENT_ID

interface Props {
  onIdToken: (idToken: string) => void
  disabled?: boolean
}

function GoogleSignInInner({ onIdToken, disabled }: Props) {
  const hook = useGoogleIdToken as GoogleAuthHook
  const [request, response, promptAsync] = hook({ iosClientId: CLIENT_ID })

  useEffect(() => {
    if (response?.type === 'success') {
      const idToken = response.params?.id_token ?? response.authentication?.idToken
      if (idToken) onIdToken(idToken)
    }
  }, [response, onIdToken])

  return (
    <Pressable
      style={({ pressed }) => [styles.btn, (disabled || !request) && styles.btnDisabled, pressed && styles.btnPressed]}
      disabled={disabled || !request}
      onPress={() => {
        void promptAsync()
      }}
      hitSlop={6}
    >
      {disabled ? (
        <ActivityIndicator color="#1f1f1f" />
      ) : (
        <>
          <Text style={styles.g}>G</Text>
          <Text style={styles.label}>Continuer avec Google</Text>
        </>
      )}
    </Pressable>
  )
}

export function GoogleSignInButton(props: Props) {
  if (!googleAvailable) return null
  return <GoogleSignInInner {...props} />
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
  },
  btnDisabled: { opacity: 0.6 },
  btnPressed: { opacity: 0.85 },
  g: { fontSize: 18, fontWeight: '800', color: '#4285F4' },
  label: { fontSize: 16, fontWeight: '600', color: '#1f1f1f' },
})
