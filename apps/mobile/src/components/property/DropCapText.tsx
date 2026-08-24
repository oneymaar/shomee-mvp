/**
 * La LETTRINE — première lettre de la description en serif de marque, calée
 * entre le haut de la première ligne et la ligne de base de la deuxième, le
 * texte venant se ranger à sa droite.
 *
 * DEUX DIFFICULTÉS, DEUX PARADES.
 *
 * 1. React Native n'a **ni `::first-letter` ni `float`**. Une grosse lettre
 *    imbriquée dans un paragraphe se contente d'écarter la première ligne : le
 *    texte ne s'enroule jamais autour. Il faut donc couper le texte à la main,
 *    et pour ça savoir où tombent les retours à la ligne — ce que seul le
 *    moteur de rendu sait. D'où la passe de mesure (`onTextLayout`), qui nous
 *    rend le découpage ligne à ligne ; on coupe après la 2ᵉ.
 *
 * 2. La lettre est POSÉE EN ABSOLU, hors du flux. C'est ce qui corrige le
 *    défaut de la première version : lui imposer une hauteur de ligne plus
 *    petite que son corps la faisait **rogner par le haut** — le moteur dessine
 *    le glyphe dans la boîte de ligne et coupe ce qui dépasse. Hors du flux,
 *    sa boîte peut être aussi généreuse qu'il faut sans rien décaler : le
 *    paragraphe, lui, se contente d'un retrait à gauche.
 *
 * Le calage vertical est calculé à partir des proportions de la police plutôt
 * que réglé au pixel : il suit donc le corps et l'interligne du paragraphe, et
 * reste juste si on les change. Les trois ratios ci-dessous sont les seuls
 * réglages.
 */
import { useState } from 'react'
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native'
import { colors, fonts } from '@/lib/theme'

/** Hauteur de capitale rapportée au corps (Frank Ruhl Libre ≈ 0,70). */
const CAP_RATIO = 0.7
/** Hauteur d'ascendante rapportée au corps — donne la ligne de base. */
const ASC_RATIO = 0.78
/** Interligne de la lettrine, généreux : c'est lui qui empêche tout rognage. */
const CAP_LINE = 1.2
/** Blanc entre la lettrine et le texte. */
const GUTTER = 9
/** En dessous, un texte n'a pas deux lignes à habiller : pas de lettrine. */
const MIN_LENGTH = 60

type Props = {
  text: string
  /** Style du paragraphe. Le corps et l'interligne en sont déduits. */
  style: StyleProp<TextStyle>
  /** Nombre de lignes que la lettrine doit occuper. 2 = registre éditorial. */
  lines?: number
}

export function DropCapText({ text, style, lines = 2 }: Props) {
  const flat = StyleSheet.flatten(style) ?? {}
  const fontSize = flat.fontSize ?? 14.5
  const lineHeight = flat.lineHeight ?? Math.round(fontSize * 1.6)

  const clean = text.trim()
  const cap = clean.charAt(0)
  const rest = clean.slice(1)

  const [capW, setCapW] = useState<number | null>(null)
  const [split, setSplit] = useState<{ head: string; tail: string } | null>(null)

  // ── Géométrie ───────────────────────────────────────────────────────────
  // Ligne de base de la 1ʳᵉ ligne du paragraphe, depuis le haut du bloc.
  const baseline1 = (lineHeight - fontSize) / 2 + ASC_RATIO * fontSize
  // Hauteur visée pour la lettrine : du haut des capitales de la 1ʳᵉ ligne
  // jusqu'à la ligne de base de la dernière ligne habillée.
  const targetCap = lineHeight * (lines - 1) + CAP_RATIO * fontSize
  const capFont = Math.round(targetCap / CAP_RATIO)
  const capLineHeight = Math.round(capFont * CAP_LINE)
  // Ligne de base de la lettrine à l'intérieur de sa propre boîte…
  const capBaseline = ((CAP_LINE - 1) / 2) * capFont + ASC_RATIO * capFont
  // …qu'on fait coïncider avec celle de la dernière ligne habillée.
  const capTop = Math.round(baseline1 + lineHeight * (lines - 1) - capBaseline)

  const capStyle: TextStyle = {
    fontFamily: fonts.serifStrong,
    fontSize: capFont,
    lineHeight: capLineHeight,
    color: colors.ink,
  }

  if (clean.length < MIN_LENGTH) return <Text style={style}>{clean}</Text>

  return (
    <View>
      {/* Passe 1 — largeur réelle de la lettre dans cette police. */}
      {capW == null && (
        <Text
          style={[capStyle, styles.probe]}
          onLayout={(e) => setCapW(Math.ceil(e.nativeEvent.layout.width))}
        >
          {cap}
        </Text>
      )}

      {/* Passe 2 — retours à la ligne du texte, sur la largeur qui lui reste. */}
      {capW != null && split == null && (
        <Text
          style={[style, styles.probe, { left: capW + GUTTER }]}
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
        // Pendant la mesure : le paragraphe normal. Rien ne clignote, rien ne saute.
        <Text style={style}>{clean}</Text>
      ) : (
        <>
          <View>
            {/* HORS DU FLUX : sa boîte peut déborder sans rien décaler ni rogner. */}
            <Text style={[capStyle, styles.cap, { top: capTop }]}>{cap}</Text>
            {/* Le retrait s'applique aux DEUX lignes habillées — c'est ce que
                fait un `float` en CSS. */}
            <Text style={[style, { paddingLeft: (capW ?? 0) + GUTTER }]}>{split.head}</Text>
          </View>
          {split.tail.trim().length > 0 ? <Text style={style}>{split.tail}</Text> : null}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  // Les sondes de mesure : composées par le moteur, invisibles à l'écran.
  probe: { position: 'absolute', opacity: 0, right: 0 },
  cap: { position: 'absolute', left: 0 },
})
