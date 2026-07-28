import { StyleSheet, View } from 'react-native'
import { useFlyHeartStore } from '@/lib/flyHeartStore'
import { FlyingHeart } from './FlyingHeart'

/**
 * Overlay racine des cœurs volants — monté APRÈS la sortie du routeur, en
 * absoluteFill + pointerEvents="none", HORS de tout SafeAreaView (sinon les
 * coordonnées measureInWindow seraient décalées de l'inset). Peint au-dessus de
 * la tab bar. Ne rend rien tant que l'onglet Favoris n'a pas été mesuré.
 */
export function FlyHeartOverlay() {
  const flights = useFlyHeartStore((s) => s.flights)
  const target = useFlyHeartStore((s) => s.target)
  const land = useFlyHeartStore((s) => s.land)

  if (!target) return null

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {flights.map((f) => (
        <FlyingHeart key={f.id} from={f.from} to={target} onDone={() => land(f.id)} />
      ))}
    </View>
  )
}
