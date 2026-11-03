export function initial(name: string) {
  const character = [...name.trim()][0] || '?'
  return character.toUpperCase()
}

export function Avatar({
  name,
  color,
  size = 32,
  online,
}: {
  name: string
  color: string
  size?: number
  online?: boolean
}) {
  return (
    <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.4 }}>
      {initial(name)}
      {online !== undefined && <span className={online ? 'presence online' : 'presence offline'} />}
    </span>
  )
}
