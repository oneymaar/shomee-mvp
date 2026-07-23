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
import Svg, { Path } from 'react-native-svg'

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

// Logo Google officiel (« G » 4 couleurs) — asset requis par les guidelines
// Google pour le bouton de connexion.
function GoogleLogo({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  )
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
          <GoogleLogo size={18} />
          <Text style={styles.label}>Se connecter avec Google</Text>
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
  label: { fontSize: 16, fontWeight: '600', color: '#1f1f1f' },
})
