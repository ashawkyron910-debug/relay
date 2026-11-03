import type { ReactNode } from 'react'

export function MessageBody({ text }: { text: string }) {
  return <div className="message-body">{renderBlocks(text)}</div>
}

function renderBlocks(text: string) {
  const chunks = text.split('```')
  return chunks.map((chunk, index) => {
    if (index % 2 === 1) {
      const lines = chunk.split('\n')
      const code = lines.length > 1 && /^[a-z0-9_+-]+$/i.test(lines[0].trim()) ? lines.slice(1).join('\n') : chunk
      return (
        <pre key={index}>
          <code>{code.replace(/^\n/, '').replace(/\n$/, '')}</code>
        </pre>
      )
    }
    return <span key={index}>{renderInline(chunk, `b${index}`)}</span>
  })
}

function renderInline(text: string, keyPrefix: string) {
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(https?:\/\/[^\s<]+)/g
  const nodes: ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  let index = 0
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(<span key={`${keyPrefix}-t${index}`}>{text.slice(last, match.index)}</span>)
    const token = match[0]
    if (token.startsWith('`')) nodes.push(<code key={`${keyPrefix}-c${index}`}>{token.slice(1, -1)}</code>)
    else if (token.startsWith('**')) nodes.push(<strong key={`${keyPrefix}-s${index}`}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith('*')) nodes.push(<em key={`${keyPrefix}-e${index}`}>{token.slice(1, -1)}</em>)
    else {
      const href = token.replace(/[),.;!?]+$/g, '')
      const trailing = token.slice(href.length)
      nodes.push(
        <a key={`${keyPrefix}-a${index}`} href={href} target="_blank" rel="noreferrer noopener">
          {href}
        </a>,
      )
      if (trailing) nodes.push(<span key={`${keyPrefix}-p${index}`}>{trailing}</span>)
    }
    last = match.index + token.length
    index += 1
  }
  if (last < text.length) nodes.push(<span key={`${keyPrefix}-end`}>{text.slice(last)}</span>)
  return nodes
}
