'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { api, API_URL, getToken } from '@/lib/api';
import { connectChatSocket } from '@/lib/chat-socket';

interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function MessageAttachment({ att }: { att: Attachment }) {
  const url = `${API_URL}/chat/attachments/${att.id}`;
  if (att.mimeType.startsWith('image/')) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={att.filename} className="max-h-64 rounded-md border border-club-100" />
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 inline-flex items-center gap-2 rounded-md border border-club-100 bg-white px-3 py-2 text-sm text-club-700 hover:bg-club-50"
    >
      📎 {att.filename} <span className="text-xs text-gray-400">{fmtSize(att.size)}</span>
    </a>
  );
}

interface Channel {
  id: string;
  kind: string;
  name: string;
  teamName: string | null;
  categoryCode: string | null;
  lastMessage: { body: string; createdAt: string } | null;
  unreadCount: number;
}

const KIND_LABELS: Record<string, string> = {
  TEAM_ANNOUNCEMENTS: '📢 Oznamy',
  TEAM_TRAINING: '🏃 Tréningy',
  TEAM_GENERAL: '💬 Všeobecné',
  TEAM_EMAIL: '✉ Hromadný email',
  CLUB_ANNOUNCEMENT: '📣 Oznamy klubu',
  COACHES: '👔 Tréneri a vedenie',
  BOARD: '🗂 Vedenie',
};

/** Zoskupí podkanály podľa družstva; klubové/interné dá zvlášť. */
function groupChannels(channels: Channel[]) {
  const groups = new Map<string, { key: string; label: string; channels: Channel[] }>();
  for (const c of channels) {
    const key = c.teamName ?? (c.kind === 'CLUB_ANNOUNCEMENT' ? '_club' : '_other');
    const label = c.teamName ?? (c.kind === 'CLUB_ANNOUNCEMENT' ? 'Celý klub' : 'Ostatné');
    if (!groups.has(key)) groups.set(key, { key, label, channels: [] });
    groups.get(key)!.channels.push(c);
  }
  return [...groups.values()];
}

interface Message {
  id: string;
  channelId?: string;
  body: string;
  createdAt: string;
  sender: { id: string; firstName: string; lastName: string };
  attachment?: Attachment | null;
  emailedTo?: number;
  replyTo?: {
    id: string;
    body: string;
    sender: { id: string; firstName: string; lastName: string };
    attachment?: { filename: string } | null;
  } | null;
}

function quoteText(r: { body: string; attachment?: { filename: string } | null }) {
  return r.body || (r.attachment ? `📎 ${r.attachment.filename}` : '');
}

export default function ChatPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<Socket | null>(null);
  // aktuálny kanál dostupný aj v async callbackoch (send/fetch môžu
  // dobehnúť až po prepnutí kanála — vtedy ich výsledok nesmieme zobraziť)
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  /** Pridá správu, len ak patrí do práve zobrazeného kanála a ešte tam nie je.
   *  Rieši duplicitu (WS broadcast + REST odpoveď doručia tú istú správu)
   *  aj únik správy do iného kanála po rýchlom prepnutí. */
  const appendMessage = useCallback((message: Message, channelId: string) => {
    if (activeIdRef.current !== channelId) return;
    setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
  }, []);

  const reloadChannels = useCallback(async () => {
    try {
      const list = await api<Channel[]>('/chat/channels');
      setChannels(list);
      return list;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Načítanie zlyhalo');
      return [];
    }
  }, []);

  useEffect(() => {
    api<{ id: string }>('/auth/me')
      .then((me) => setMeId(me.id))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void reloadChannels().then((list) => {
      if (list.length > 0) setActiveId((current) => current ?? list[0]!.id);
    });
  }, [reloadChannels]);

  // otvorenie kanála: hneď vynuluj neprečítané (na serveri sa označí pri načítaní správ)
  function openChannel(id: string) {
    setActiveId(id);
    setInfo(null);
    setReplyTo(null);
    setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
  }

  const loadMessages = useCallback(async () => {
    if (!activeId) return;
    try {
      const list = await api<Message[]>(`/chat/channels/${activeId}/messages`);
      // odpoveď mohla dobehnúť až po prepnutí na iný kanál — vtedy ju zahodíme
      if (activeIdRef.current !== activeId) return;
      setMessages(list);
      setError(null);
      // server kanál označil ako prečítaný → obnov ikonku neprečítaných v menu
      window.dispatchEvent(new Event('fkknv:chat-read'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Načítanie zlyhalo');
    }
  }, [activeId]);

  // jedno WebSocket spojenie na stránku
  useEffect(() => {
    const socket = connectChatSocket();
    socketRef.current = socket;
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // pri zmene kanála: vyčisti zoznam, načítaj históriu, prihlás sa na realtime
  useEffect(() => {
    setMessages([]); // nech sa pod novým kanálom nezobrazujú správy predchádzajúceho
    // po načítaní (server označí kanál za prečítaný) obnov zoznam s počtami neprečítaných
    void loadMessages().then(() => reloadChannels());
    const socket = socketRef.current;
    if (!socket || !activeId) return;

    socket.emit('join', { channelId: activeId });
    const onMessage = (message: Message & { channelId: string }) => {
      appendMessage(message, message.channelId);
    };
    const onDeleted = (p: { channelId: string; messageId: string }) => {
      if (activeIdRef.current !== p.channelId) return;
      setMessages((prev) => prev.filter((m) => m.id !== p.messageId));
    };
    socket.on('message', onMessage);
    socket.on('messageDeleted', onDeleted);
    return () => {
      socket.off('message', onMessage);
      socket.off('messageDeleted', onDeleted);
      socket.emit('leave', { channelId: activeId });
    };
  }, [loadMessages, activeId, appendMessage, reloadChannels]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // textarea sa podľa obsahu zväčšuje (max ~8 riadkov, potom scrolluje)
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  async function deleteMessage(id: string) {
    if (!window.confirm('Vymazať túto správu?')) return;
    try {
      await api(`/chat/messages/${id}`, { method: 'DELETE' });
      setMessages((prev) => prev.filter((m) => m.id !== id));
      if (replyTo?.id === id) setReplyTo(null);
      void reloadChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vymazanie zlyhalo');
    }
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || !activeId) return;
    const channelId = activeId; // kanál v momente odoslania
    const replyToId = replyTo?.id;
    setText('');
    setReplyTo(null);
    try {
      const message = await api<Message>(`/chat/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body, replyToId }),
      });
      appendMessage(message, channelId);
      if (typeof message.emailedTo === 'number') setInfo(`Správa odoslaná e-mailom na ${message.emailedTo} adries (hráči a rodičia).`);
      void reloadChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Odoslanie zlyhalo');
      setText(body);
      if (replyToId) setReplyTo((cur) => cur ?? messages.find((m) => m.id === replyToId) ?? null);
    }
  }

  async function onAttach(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeId) return;
    if (file.size > 15 * 1024 * 1024) {
      setError('Súbor je príliš veľký (max 15 MB).');
      return;
    }
    const channelId = activeId;
    const caption = text.trim();
    const replyToId = replyTo?.id;
    setText('');
    setReplyTo(null);
    try {
      const form = new FormData();
      form.append('file', file);
      if (caption) form.append('body', caption);
      if (replyToId) form.append('replyToId', replyToId);
      const token = getToken();
      const res = await fetch(`${API_URL}/chat/channels/${channelId}/attachment`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Nahranie zlyhalo');
      appendMessage(await res.json(), channelId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nahranie zlyhalo');
    }
  }

  const active = channels.find((c) => c.id === activeId);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-club-900">Komunikácia</h1>
      {info && <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{info}</p>}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="max-h-[600px] overflow-y-auto rounded-lg border border-club-100 bg-white">
          <h2 className="sticky top-0 border-b border-club-100 bg-white px-4 py-3 text-sm font-semibold text-club-800">
            Kanály
          </h2>
          {groupChannels(channels).map((group) => {
            const groupUnread = group.channels.some((c) => c.unreadCount > 0 && c.id !== activeId);
            return (
              <div key={group.key}>
                <div className="flex items-center gap-2 bg-club-50 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-club-700">
                  {group.label}
                  {groupUnread && <span className="inline-block h-2 w-2 rounded-full bg-red-500" title="Neprečítané správy" />}
                </div>
                <ul>
                  {group.channels.map((channel) => {
                    const unread = channel.unreadCount > 0 && channel.id !== activeId;
                    return (
                      <li key={channel.id}>
                        <button
                          onClick={() => openChannel(channel.id)}
                          className={`flex w-full items-start justify-between gap-2 px-4 py-2 text-left text-sm hover:bg-club-50 ${
                            channel.id === activeId
                              ? 'bg-club-50 font-semibold text-club-800'
                              : unread
                                ? 'font-semibold text-club-900'
                                : 'text-gray-700'
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            {KIND_LABELS[channel.kind] ?? channel.name}
                            {channel.lastMessage && (
                              <span
                                className={`mt-0.5 block truncate text-xs font-normal ${unread ? 'text-gray-600' : 'text-gray-400'}`}
                              >
                                {channel.lastMessage.body}
                              </span>
                            )}
                          </span>
                          {unread && (
                            <span className="mt-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-bold text-white">
                              {channel.unreadCount}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {channels.length === 0 && <p className="px-4 py-6 text-sm text-gray-500">Žiadne kanály.</p>}
        </aside>

        <section className="flex h-[600px] flex-col rounded-lg border border-club-100 bg-white">
          <h2 className="border-b border-club-100 px-4 py-3 text-sm font-semibold text-club-800">
            {active?.name ?? 'Vyberte kanál'}
            {active?.kind === 'TEAM_EMAIL' && (
              <span className="ml-2 font-normal text-gray-500">
                — napísaná správa sa odošle aj e-mailom všetkým hráčom a rodičom družstva
              </span>
            )}
          </h2>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((message) => (
              <div key={message.id} className="rounded-lg border border-club-100 bg-club-50 p-3">
                <p className="text-xs font-semibold text-club-800">
                  {message.sender.firstName} {message.sender.lastName}
                  <span className="ml-2 font-normal text-gray-400">
                    {new Date(message.createdAt).toLocaleString('sk-SK', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                </p>
                {message.replyTo && (
                  <div className="mt-1 rounded border-l-4 border-club-300 bg-white/70 px-2 py-1 text-xs text-gray-600">
                    <span className="font-semibold">
                      {message.replyTo.sender.firstName} {message.replyTo.sender.lastName}
                    </span>
                    <p className="line-clamp-2 whitespace-pre-wrap break-words">{quoteText(message.replyTo)}</p>
                  </div>
                )}
                {message.body && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-800">{message.body}</p>
                )}
                {message.attachment && <MessageAttachment att={message.attachment} />}
                <div className="mt-1 flex gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setReplyTo(message);
                      textRef.current?.focus();
                    }}
                    className="text-club-700 hover:underline"
                  >
                    Odpovedať
                  </button>
                  {meId === message.sender.id && (
                    <button
                      type="button"
                      onClick={() => void deleteMessage(message.id)}
                      className="text-red-600 hover:underline"
                    >
                      Vymazať
                    </button>
                  )}
                </div>
              </div>
            ))}
            {messages.length === 0 && (
              <p className="pt-8 text-center text-sm text-gray-500">Zatiaľ žiadne správy — napíšte prvú!</p>
            )}
            <div ref={bottomRef} />
          </div>
          {replyTo && (
            <div className="flex items-start justify-between gap-2 border-t border-club-100 bg-club-50 px-4 py-2 text-xs text-gray-600">
              <div className="min-w-0">
                Odpoveď pre{' '}
                <span className="font-semibold">
                  {replyTo.sender.firstName} {replyTo.sender.lastName}
                </span>
                <p className="truncate">{quoteText(replyTo)}</p>
              </div>
              <button type="button" onClick={() => setReplyTo(null)} className="text-gray-500 hover:text-gray-800" title="Zrušiť odpoveď">
                ✕
              </button>
            </div>
          )}
          <form onSubmit={send} className="flex items-end gap-2 border-t border-club-100 p-3">
            <input ref={fileRef} type="file" onChange={onAttach} className="hidden" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={!activeId || active?.kind === 'TEAM_EMAIL'}
              title="Priložiť obrázok alebo dokument"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              📎
            </button>
            <textarea
              ref={textRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Enter odošle, Shift+Enter vloží nový riadok
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Napíšte správu… (Shift+Enter = nový riadok)"
              className="max-h-[200px] flex-1 resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-club-500 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md bg-club-600 px-5 py-2 text-sm font-semibold text-white hover:bg-club-700"
            >
              Odoslať
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
