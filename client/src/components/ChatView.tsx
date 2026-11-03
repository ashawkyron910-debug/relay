import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MessageBody } from '../format'
import { useRelay } from '../store'
import type { Message } from '../types'
import { Avatar } from './Avatar'

export function ChatView() {
  const relay = useRelay()
  const channelId = relay.view.channelId
  const activeServerId = relay.view.kind === 'server' ? relay.view.serverId : null
  const server = activeServerId ? relay.servers.find((item) => item.id === activeServerId) ?? null : null
  const channel = server?.channels.find((item) => item.id === channelId) ?? null
  const dm = relay.view.kind === 'home' ? relay.dms.find((item) => item.id === channelId) : null
  const messages = channelId ? relay.messages[channelId] ?? [] : []
  const typing = channelId ? (relay.typing[channelId] ?? []).filter((person) => person.userId !== relay.me?.id) : []
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const anchor = useRef<number | null>(null)
  const lastId = useRef<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [jump, setJump] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    setDraft('')
    setEditingId(null)
    setConfirmDelete(null)
    setJump(false)
    setLoadError('')
    stick.current = true
    lastId.current = null
    if (!channelId) return
    let cancel = false
    relay.loadMessages(channelId).catch((error: unknown) => {
      if (!cancel) setLoadError(error instanceof Error ? error.message : 'Could not load messages.')
    })
    return () => {
      cancel = true
    }
  }, [channelId, relay.loadMessages])

  useEffect(() => {
    const title = channel ? `#${channel.name}` : dm ? dm.peer.displayName : 'Relay'
    document.title = `${title} · Relay`
  }, [channel, dm])

  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return
    if (anchor.current != null) {
      element.scrollTop += element.scrollHeight - anchor.current
      anchor.current = null
      return
    }
    if (stick.current) element.scrollTop = element.scrollHeight
  }, [messages, channelId, typing.length])

  useEffect(() => {
    const newest = messages[messages.length - 1]
    if (!newest) return
    if (lastId.current && lastId.current !== newest.id && !stick.current) setJump(true)
    lastId.current = newest.id
  }, [messages])

  function onScroll() {
    const element = scroller.current
    if (!element) return
    stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
    if (stick.current) setJump(false)
    if (element.scrollTop < 48 && channelId && relay.hasMore[channelId] && !loadingOlder) void loadOlder()
  }

  async function loadOlder() {
    if (!channelId || loadingOlder) return
    const element = scroller.current
    if (element) anchor.current = element.scrollHeight
    setLoadingOlder(true)
    try {
      await relay.loadOlder(channelId)
    } catch (error) {
      anchor.current = null
      relay.toast(error instanceof Error ? error.message : 'Could not load older messages.')
    } finally {
      setLoadingOlder(false)
    }
  }

  async function onSend() {
    if (!channelId || sending) return
    const content = draft.trim()
    if (!content || content.length > 2000) return
    setSending(true)
    try {
      await relay.sendMessage(channelId, content)
      setDraft('')
      stick.current = true
    } catch (error) {
      relay.toast(error instanceof Error ? error.message : 'Could not send that message.')
    } finally {
      setSending(false)
    }
  }

  async function onEdit(message: Message) {
    const content = editDraft.trim()
    if (!content) return
    try {
      await relay.editMessage(message.id, content)
      setEditingId(null)
    } catch (error) {
      relay.toast(error instanceof Error ? error.message : 'Could not edit that message.')
    }
  }

  async function onDelete(messageId: string) {
    try {
      await relay.deleteMessage(messageId)
      setConfirmDelete(null)
    } catch (error) {
      relay.toast(error instanceof Error ? error.message : 'Could not delete that message.')
    }
  }

  const placeholder = channel ? `Message #${channel.name}` : dm ? `Message @${dm.peer.username}` : 'Select a conversation'

  return (
    <section className="chat">
      <header className="chat-head">
        {channel && (
          <div>
            <h2><span className="hash">#</span> {channel.name}</h2>
            <p>{server?.name}</p>
          </div>
        )}
        {dm && (
          <div className="dm-head">
            <Avatar name={dm.peer.displayName} color={dm.peer.avatarColor} size={28} online={relay.online.includes(dm.peer.id)} />
            <div>
              <h2>{dm.peer.displayName}</h2>
              <p>@{dm.peer.username}</p>
            </div>
          </div>
        )}
        {!channel && !dm && (
          <div>
            <h2>Relay</h2>
            <p>Pick a channel or start a conversation.</p>
          </div>
        )}
      </header>
      <div className="messages" ref={scroller} onScroll={onScroll}>
        {channelId && relay.hasMore[channelId] && (
          <button className="older" type="button" onClick={() => void loadOlder()} disabled={loadingOlder}>
            {loadingOlder ? 'Loading…' : 'Load older messages'}
          </button>
        )}
        {loadError && <div className="form-error inline">{loadError}</div>}
        {channel && messages.length === 0 && !loadError && (
          <div className="channel-start">
            <div className="start-hash">#</div>
            <h3>Welcome to #{channel.name}</h3>
            <p>This is the start of the <strong>#{channel.name}</strong> channel.</p>
          </div>
        )}
        {dm && messages.length === 0 && !loadError && (
          <div className="channel-start">
            <Avatar name={dm.peer.displayName} color={dm.peer.avatarColor} size={64} />
            <h3>{dm.peer.displayName}</h3>
            <p>This is the beginning of your conversation with @{dm.peer.username}.</p>
          </div>
        )}
        {!channelId && (
          <div className="channel-start">
            <h3>Nothing selected</h3>
            <p>Choose a direct message, or add a server from the left rail.</p>
          </div>
        )}
        {groupMessages(messages).map((entry) =>
          entry.kind === 'day' ? (
            <div key={entry.key} className="day-divider"><span>{entry.label}</span></div>
          ) : (
            <article key={entry.message.id} className={entry.compact ? 'message compact' : 'message'} onMouseLeave={() => setConfirmDelete((current) => (current === entry.message.id ? null : current))}>
              <div className="avatar-col">
                {entry.compact ? <time className="hover-time">{clock(entry.message.createdAt)}</time> : <Avatar name={entry.message.author.displayName} color={entry.message.author.avatarColor} size={40} />}
              </div>
              <div className="message-main">
                {!entry.compact && (
                  <div className="message-meta">
                    <strong>{entry.message.author.displayName}</strong>
                    <time>{stamp(entry.message.createdAt)}</time>
                  </div>
                )}
                {editingId === entry.message.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      void onEdit(entry.message)
                    }}
                  >
                    <textarea
                      value={editDraft}
                      onChange={(event) => setEditDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setEditingId(null)
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault()
                          void onEdit(entry.message)
                        }
                      }}
                      maxLength={2000}
                      autoFocus
                    />
                    <div className="edit-hint">Escape to cancel · Enter to save</div>
                  </form>
                ) : (
                  <MessageBody text={entry.message.content} />
                )}
                {entry.message.editedAt && editingId !== entry.message.id && <span className="edited">(edited)</span>}
                {confirmDelete === entry.message.id && (
                  <div className="confirm-inline">
                    Delete this message?
                    <button type="button" className="danger" onClick={() => void onDelete(entry.message.id)}>Delete</button>
                    <button type="button" className="secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
                  </div>
                )}
              </div>
              {relay.me?.id === entry.message.author.id && editingId !== entry.message.id && (
                <div className="message-actions">
                  <button type="button" onClick={() => { setEditingId(entry.message.id); setEditDraft(entry.message.content); setConfirmDelete(null) }}>Edit</button>
                  <button type="button" onClick={() => setConfirmDelete(entry.message.id)}>Delete</button>
                </div>
              )}
            </article>
          ),
        )}
        <div />
      </div>
      {jump && (
        <button
          className="jump"
          type="button"
          onClick={() => {
            stick.current = true
            setJump(false)
            const element = scroller.current
            if (element) element.scrollTop = element.scrollHeight
          }}
        >
          New messages
        </button>
      )}
      <div className="typing-row" aria-live="polite">
        {typing.length > 0 && <span>{typingLabel(typing.map((person) => person.displayName))}</span>}
      </div>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault()
          void onSend()
        }}
      >
        <label className="sr-only" htmlFor="composer">Message</label>
        <textarea
          id="composer"
          value={draft}
          placeholder={placeholder}
          disabled={!channelId || sending}
          rows={1}
          maxLength={2000}
          onChange={(event) => {
            setDraft(event.target.value)
            const field = event.target
            field.style.height = 'auto'
            field.style.height = `${Math.min(field.scrollHeight, 180)}px`
            if (channelId && event.target.value.trim()) relay.notifyTyping(channelId)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void onSend()
            }
          }}
        />
        <div className="composer-bar">
          {draft.length > 1800 && <span className={draft.trim().length > 2000 ? 'counter over' : 'counter'}>{2000 - draft.trim().length}</span>}
          <button className="primary send" type="submit" disabled={!channelId || sending || !draft.trim() || draft.trim().length > 2000}>
            Send
          </button>
        </div>
      </form>
    </section>
  )
}

function groupMessages(messages: Message[]) {
  const entries: Array<{ kind: 'day'; key: string; label: string } | { kind: 'message'; message: Message; compact: boolean }> = []
  let previous: Message | null = null
  for (const message of messages) {
    const key = dayKey(message.createdAt)
    if (!previous || dayKey(previous.createdAt) !== key) {
      entries.push({ kind: 'day', key: `day-${key}-${message.id}`, label: dayLabel(message.createdAt) })
    }
    const compact = Boolean(
      previous &&
        previous.author.id === message.author.id &&
        dayKey(previous.createdAt) === key &&
        message.createdAt - previous.createdAt < 5 * 60 * 1000,
    )
    entries.push({ kind: 'message', message, compact })
    previous = message
  }
  return entries
}

function dayKey(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function dayLabel(timestamp: number) {
  const date = new Date(timestamp)
  const today = new Date()
  const start = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const diff = Math.round((start(today) - start(date)) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

function clock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function stamp(timestamp: number) {
  return `${dayLabel(timestamp) === 'Today' ? 'Today' : dayLabel(timestamp)} at ${clock(timestamp)}`
}

function typingLabel(names: string[]) {
  if (names.length === 1) return `${names[0]} is typing…`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`
  return `${names[0]} and ${names.length - 1} others are typing…`
}
