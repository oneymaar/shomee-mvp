/**
 * Écran de connexion (premier lancement) — Google, Apple, et « Continuer sans
 * compte » (invité persistant). Affiché par le gate racine tant qu'aucune
 * session n'existe. Apple ne s'affiche que sur iOS avec le module dispo ;
 * Google se masque tout seul si indisponible ; l'invité est toujours proposé.
 *
 * Fond : UNE seule vidéo de 30 s en boucle (`assets/video/accueil-mosaique.mp4`),
 * pré-rendue par `outils/generer-fond-accueil.py` à partir des visites
 * Cloudinary. Ce n'est pas un détail d'implémentation : un mur de N lecteurs
 * était l'approche naturelle, mais iOS plafonne le nombre de décodeurs H.264
 * simultanés (~4 sur un appareil modeste) — au-delà, les vidéos en trop restent
 * figées, et l'écran ne ressemble plus à rien selon le téléphone. Avec un seul
 * lecteur, le rendu est identique partout et le coût est constant.
 *
 * Le fondu du haut et le halo derrière le logo sont CUITS dans la vidéo. Le
 * socle bas, lui, est dessiné ici : c'est de l'interface, il doit pouvoir bouger
 * avec les boutons sans re-générer l'asset.
 */
import { useEffect, useState } from 'react'
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Path } from 'react-native-svg'
import { appleModuleAvailable, signInWithApple } from './appleAuth'
import { GoogleSignInButton } from './GoogleSignInButton'
import { useAuth, loginGuest, loginApple, loginGoogleIdToken } from '@/lib/authStore'
import { fonts, serifSizes } from '@/lib/theme'

const BEIGE = '#FAF3EE'
const ACCENT = '#A6512B'
const MUTED = '#8A7A6E'
const LOINTAIN = '#544C47' // gris chaud du haut de la vidéo, avant son chargement

const LOGO = require('../../../assets/images/logo-shomee-terracotta.png')
const FOND_VIDEO = require('../../../assets/video/accueil-mosaique.mp4')
const FOND_POSTER = require('../../../assets/video/accueil-mosaique.jpg')

// expo-video est installé, mais on garde la convention du projet (require-guard) :
// tsc et le bundling restent sains même si le module natif n'est pas encore lié.
interface VideoModule {
  useVideoPlayer: (source: unknown, setup?: (p: VideoPlayer) => void) => VideoPlayer
  VideoView: React.ComponentType<Record<string, unknown>>
}
interface VideoPlayer {
  loop: boolean
  muted: boolean
  playbackRate: number
  play: () => void
  pause: () => void
}

/**
 * Vitesse de lecture du fond — à laisser à 1.
 *
 * Ralentir ici ralentirait AUSSI le contenu des visites : les gens marcheraient
 * au ralenti. Le rythme du défilement se règle à la génération de l'asset, en
 * allongeant sa durée (une colonne parcourt exactement sa période sur la durée
 * du fichier, ce qui est aussi ce qui rend la boucle invisible) :
 *     outils/generer-fond-accueil.py --duree 30   → défilement à 2/3 de la vitesse
 * La durée doit rester un multiple de 5 s, sinon la boucle saute.
 */
const VITESSE_FOND = 1
let videoMod: VideoModule | null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  videoMod = require('expo-video')
} catch {
  videoMod = null
}

/**
 * Le fond animé. Isolé dans son propre composant parce que `useVideoPlayer` est
 * un hook : il ne peut pas être appelé sous condition dans AuthScreen.
 */
function FondMosaique() {
  const { useVideoPlayer, VideoView } = videoMod as VideoModule
  const player = useVideoPlayer(FOND_VIDEO, (p) => {
    p.loop = true
    p.muted = true
    p.playbackRate = VITESSE_FOND
    p.play()
  })

  // Écran d'accueil = tout premier écran : on ne laisse pas un décodeur tourner
  // quand l'app passe en arrière-plan (batterie, et chauffe sur les vieux modèles).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') player.play()
      else player.pause()
    })
    return () => sub.remove()
  }, [player])

  return (
    <VideoView
      style={StyleSheet.absoluteFill}
      player={player}
      contentFit="cover"
      nativeControls={false}
      pointerEvents="none"
    />
  )
}

// Logo Apple — requis par les guidelines Apple sur le bouton de connexion.
function AppleLogo({ size = 17 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 384 512">
      <Path
        fill="#ffffff"
        d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"
      />
    </Svg>
  )
}

export function AuthScreen() {
  const { busy } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const insets = useSafeAreaInsets()

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
    <View style={styles.root}>
      {/* Image de la 1re frame : évite le flash gris entre le montage de l'écran
          et le premier rendu du lecteur (~100 ms). */}
      <Image source={FOND_POSTER} style={StyleSheet.absoluteFill} contentFit="cover" />
      {videoMod ? <FondMosaique /> : null}

      {/* `edges` SANS 'bottom' : un padding bas sur ce conteneur ferait s'arrêter
          le socle beige avant le bord physique, et la vidéo réapparaîtrait sous
          la mention légale. C'est le socle qui absorbe l'inset, plus bas. */}
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.hero}>
          <Image source={LOGO} style={styles.logo} contentFit="contain" tintColor={BEIGE} />
          <Text style={styles.tagline}>
            La recherche immobilière,{'\n'}
            <Text style={styles.taglineSerif}>en vidéo.</Text>
          </Text>
        </View>

        <View style={[styles.socle, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <LinearGradient
            colors={['rgba(253,245,242,0)', 'rgba(253,245,242,0.38)', 'rgba(253,245,242,0.88)', BEIGE]}
            locations={[0, 0.38, 0.74, 1]}
            style={styles.fondu}
            pointerEvents="none"
          />

          <View style={styles.actions}>
            <GoogleSignInButton onIdToken={onGoogle} disabled={busy} />

            {showApple && (
              <Pressable
                style={({ pressed }) => [styles.apple, busy && styles.disabled, pressed && styles.pressed]}
                onPress={onApple}
                disabled={busy}
                hitSlop={6}
              >
                <AppleLogo />
                <Text style={styles.appleLabel}>Se connecter avec Apple</Text>
              </Pressable>
            )}

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
        </View>
      </SafeAreaView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: LOINTAIN },
  safe: { flex: 1, justifyContent: 'space-between' },

  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 13, paddingHorizontal: 28 },
  logo: { width: 104, height: 104 },
  // Montserrat Light — une sans plus élégante et plus fine que la police
  // système (« un tout petit peu plus fine », retour du 21/08). Pas de
  // fontWeight avec une police chargée : Android en synthétiserait un faux gras.
  tagline: {
    fontFamily: fonts.taglineSans,
    fontSize: 26,
    lineHeight: 33,
    letterSpacing: 0.2,
    color: '#FAF3EE',
    textAlign: 'center',
    // Ombre large et diffuse plutôt que marquée : elle doit décoller le texte
    // des visites claires sans se voir comme un contour.
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 18,
    textShadowOffset: { width: 0, height: 2 },
  },

  // « en vidéo. » — et rien d'autre — porte la serif de marque : deux mots en
  // relief suffisent à signer, la phrase entière en serif ferait littéraire.
  taglineSerif: { fontFamily: fonts.serif, fontSize: serifSizes.tagline },

  // paddingBottom posé à l'exécution depuis l'inset bas (home indicator).
  socle: { backgroundColor: BEIGE, paddingHorizontal: 28, paddingTop: 22 },
  // Le dégradé vit AU-DESSUS du socle : il déborde vers la vidéo, d'où le top négatif.
  fondu: { position: 'absolute', left: 0, right: 0, top: -190, height: 190 },

  actions: { gap: 11 },
  apple: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#000000',
  },
  appleLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },

  guest: { height: 46, alignItems: 'center', justifyContent: 'center' },
  guestLabel: { fontSize: 15, fontWeight: '600', color: ACCENT, textDecorationLine: 'underline' },

  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.85 },

  error: { fontSize: 13, color: '#B0442C', textAlign: 'center' },
  legal: { fontSize: 11, color: MUTED, textAlign: 'center', lineHeight: 16, marginTop: 2 },
})
