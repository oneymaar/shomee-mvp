/**
 * La LETTRINE — première lettre de la description en serif de marque, haute
 * d'exactement DEUX lignes, le texte venant se caler à sa droite.
 *
 * POURQUOI CE COMPOSANT EXISTE. En CSS, une lettrine s'écrit en une ligne
 * (`::first-letter { float: left }`). React Native n'a **ni `::first-letter`,
 * ni `float`** : un `<Text>` imbriqué en gros corps se contente d'écarter la
 * première ligne, et le paragraphe ne vient jamais s'enrouler autour. Il faut
 * donc découper le texte à la main, et pour cela savoir **où tombent les
 * retours à la ligne** — ce que seul le moteur de rendu sait.
 *
 * D'où les deux passes :
 *   1. on mesure la largeur réelle de la lettre (`onLayout`) ;
 *   2. on fait composer le texte, invisible, sur la largeur restante, et
 *      `onTextLayout` nous rend le découpage ligne à ligne. On coupe après la
 *      2ᵉ ligne : ce qui précède se met à droite de la lettrine, le reste passe
 *      dessous en pleine largeur.
 * Les deux passes se jouent en deux images, avant que la fiche ne soit posée.
 *
 * Le paragraphe reste affiché normalement pendant la mesure : jamais de vide,
 * jamais de saut — juste la lettrine qui prend sa place.
 */
import { useState } from 'react'
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native'
import { colors, fonts } from '@/lib/theme'

type Props = {
  text: string
  /** Style du paragraphe. `fontSize` et `lineHeight` en sont déduits. */
  style: StyleProp<TextStyle>
  /** Nombre de lignes que la lettrine doit occuper. 2 = registre éditorial. */
  lines?: number
}

export function DropCapText({ text, style, lines = 2 }: Props) {
  const flat = StyleSheet.flatten(style) ?? {}
  const lineHeight = flat.lineHeight ?? Math.round((flat.fontSize ?? 14.5) * 1.6)

  const clean = text.trim()
  const cap = clean.charAt(0)
  const rest = clean.slice(1)

  const [capW, setCapW] = useState<number | null>(null)
  const [split, setSplit] = useState<{ head: string; tail: string } | null>(null)

  // La lettrine fait EXACTEMENT la hauteur de `lines` lignes de texte. On
  // contraint sa boîte, et on choisit un corps qui la remplit : pour une serif,
  // la hauteur de capitale vaut ~0,72 em.
  const capBox = lineHeight * lines
  const capStyle: TextStyle = {
    fontFamily: fonts.serifStrong,
    fontSize: Math.round(capBox / 0.72),
    lineHeight: capBox,
    color: colors.ink,
    marginRight: 9,
  }

  // Texte trop court pour deux lignes : pas de lettrine, ce serait grotesque.
  if (clean.length < 60) return <Text style={style}>{clean}</Text>

  return (
    <View>
      {/* Passe 1 — largeur réelle de la lettre. */}
      {capW == null && (
        <Text
          style={[capStyle, styles.probe]}
          onLayout={(e) => setCapW(e.nativeEvent.layout.width)}
        >
          {cap}
        </Text>
      )}

      {/* Passe 2 — découpage en lignes sur la largeur restante. */}
      {capW != null && split == null && (
        <Text
          style={[style, styles.probe, { left: capW + 9 }]}
          onTextLayout={(e) => {
            const ls = e.nativeEvent.lines
            const n = Math.min(lines, ls.length)
            const head = ls
              .slice(0, n)
              .map((l) => l.text)
              .join('')
            setSplit({ head, tail: rest.slice(head.length) })
          }}
        >
          {rest}
        </Text>
      )}

      {split == null ? (
        // Pendant la mesure : le paragraphe normal. Rien ne clignote.
        <Text style={style}>{clean}</Text>
      ) : (
        <>
          <View style={styles.row}>
            <Text style={capStyle}>{cap}</Text>
            <Text style={[style, styles.flex]}>{split.head}</Text>
          </View>
          {split.tail.trim().length > 0 ? <Text style={style}>{split.tail}</Text> : null}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  // Les sondes de mesure : dans le flux du moteur de rendu, hors de la vue.
  probe: { position: 'absolute', opacity: 0, right: 0 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  flex: { flex: 1 },
})
