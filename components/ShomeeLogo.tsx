interface ShomeeLogoProps {
  size?: number
  className?: string
}

export default function ShomeeLogo({ size = 100, className }: ShomeeLogoProps) {
  const borderWidth = Math.round(size * 0.048)
  const borderRadius = Math.round(size * 0.22)
  const fontSize = Math.round(size * 0.31)
  const height = Math.round(size * 1.08)

  return (
    <div
      className={className}
      style={{
        width: size,
        height: height,
        borderRadius: borderRadius,
        border: `${borderWidth}px solid white`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0,
      }}
    >
      <span
        style={{
          color: 'white',
          fontWeight: 900,
          fontSize: fontSize,
          lineHeight: 1.1,
          letterSpacing: '0.04em',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        SHO
      </span>
      <span
        style={{
          color: 'white',
          fontWeight: 900,
          fontSize: fontSize,
          lineHeight: 1.1,
          letterSpacing: '0.04em',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        MEE
      </span>
    </div>
  )
}
