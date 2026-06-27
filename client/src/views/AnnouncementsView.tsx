import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import { listBots, listBotDiscordGuilds, listGuildChannels, listGuildRoles, sendAnnouncement } from '../api/admin'
import { ApiError } from '../api/client'
import type { SessionResponse } from '../types'

function extractError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'erro inesperado'
}

interface AnnouncementsViewProps {
  session: SessionResponse | null
}

export function AnnouncementsView({ session }: AnnouncementsViewProps) {
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null)
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([])
  const [content, setContent] = useState('')
  const [hideRoles, setHideRoles] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const permissions = session?.permissions
  const canSend = Boolean(permissions?.canUpdateBots)
  const sessionBotIds = session?.botIds ?? []

  const botsQuery = useQuery({ queryKey: ['bots'], queryFn: listBots })
  const bots = botsQuery.data ?? []
  const visibleBots = session?.user?.scope === 'all'
    ? bots
    : bots.filter((b) => sessionBotIds.includes(b.id))

  const guildsQuery = useQuery({
    queryKey: ['bot-guilds', selectedBotId ?? 'none'],
    queryFn: () => selectedBotId ? listBotDiscordGuilds(selectedBotId) : Promise.resolve([]),
    enabled: Boolean(selectedBotId),
  })

  const channelsQuery = useQuery({
    queryKey: ['guild-channels', selectedBotId, selectedGuildId],
    queryFn: () =>
      selectedBotId && selectedGuildId
        ? listGuildChannels(selectedBotId, selectedGuildId)
        : Promise.resolve([]),
    enabled: Boolean(selectedBotId && selectedGuildId),
  })

  const rolesQuery = useQuery({
    queryKey: ['guild-roles', selectedBotId, selectedGuildId],
    queryFn: () =>
      selectedBotId && selectedGuildId
        ? listGuildRoles(selectedBotId, selectedGuildId)
        : Promise.resolve([]),
    enabled: Boolean(selectedBotId && selectedGuildId),
  })

  const sendMutation = useMutation({
    mutationFn: () => {
      if (!selectedBotId || !selectedGuildId || !selectedChannelId || !content.trim()) {
        throw new Error('Preencha todos os campos obrigatórios')
      }
      return sendAnnouncement(selectedBotId, selectedGuildId, selectedChannelId, content.trim(), selectedRoleIds, hideRoles)
    },
    onSuccess: () => {
      setFeedback('Aviso enviado com sucesso!')
      setError(null)
      setContent('')
      setSelectedRoleIds([])
      setHideRoles(false)
      setShowPreview(false)
    },
    onError: (err) => {
      setError(extractError(err))
    },
  })

  function toggleRole(roleId: string) {
    setSelectedRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]
    )
  }

  // Build preview text
  const roles = rolesQuery.data ?? []
  const mentionNames = selectedRoleIds
    .map((id) => roles.find((r) => r.id === id)?.name ?? id)
    .map((name) => `@${name}`)
    .join(' ')
  const previewMentions = mentionNames
    ? hideRoles ? `||${mentionNames}||` : mentionNames
    : ''
  const previewContent = previewMentions ? `${previewMentions}\n${content}` : content

  const inputCls = 'w-full bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm'

  return (
    <div className="p-6 space-y-6">
      <div>
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Comunicações</p>
        <h2 className="text-lg font-semibold text-zinc-100">Avisos</h2>
        <p className="text-sm text-zinc-500 mt-0.5">
          Envie mensagens com menções de cargo diretamente pelo bot.
        </p>
      </div>

      {/* Bot */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
        <label className="block text-xs font-medium text-zinc-400 mb-2">Bot</label>
        {botsQuery.isLoading ? (
          <p className="text-sm text-zinc-500">Carregando...</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {visibleBots.map((bot) => (
              <button
                key={bot.id}
                type="button"
                onClick={() => {
                  setSelectedBotId(bot.id)
                  setSelectedGuildId(null)
                  setSelectedChannelId('')
                  setSelectedRoleIds([])
                  setFeedback(null)
                  setError(null)
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedBotId === bot.id ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                {bot.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Guild */}
      {selectedBotId && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <label className="block text-xs font-medium text-zinc-400 mb-2">Servidor</label>
          {guildsQuery.isLoading ? (
            <p className="text-sm text-zinc-500">Carregando...</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(guildsQuery.data ?? []).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    setSelectedGuildId(g.id)
                    setSelectedChannelId('')
                    setSelectedRoleIds([])
                    setFeedback(null)
                    setError(null)
                  }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    selectedGuildId === g.id ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedBotId && selectedGuildId && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 space-y-5">
          {feedback && (
            <div className="px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">
              {feedback}
            </div>
          )}
          {error && (
            <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Channel */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Canal de destino</label>
            {channelsQuery.isLoading ? (
              <p className="text-sm text-zinc-500">Carregando canais...</p>
            ) : (
              <select
                value={selectedChannelId}
                onChange={(e) => setSelectedChannelId(e.target.value)}
                className={inputCls}
              >
                <option value="">Selecione um canal...</option>
                {(channelsQuery.data ?? []).filter((c) => c.type !== 4).map((c) => (
                  <option key={c.id} value={c.id}>#{c.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Message */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Mensagem</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Digite o aviso aqui..."
              rows={5}
              className={`${inputCls} resize-none`}
            />
          </div>

          {/* Role mentions */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2">
              Mencionar cargos <span className="text-zinc-600">(opcional)</span>
            </label>
            {rolesQuery.isLoading ? (
              <p className="text-sm text-zinc-500">Carregando cargos...</p>
            ) : (rolesQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-zinc-500">Nenhum cargo disponível.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(rolesQuery.data ?? []).map((role) => {
                  const selected = selectedRoleIds.includes(role.id)
                  const colorHex = role.color
                    ? '#' + role.color.toString(16).padStart(6, '0')
                    : undefined
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => toggleRole(role.id)}
                      style={selected && colorHex ? { borderColor: colorHex, color: colorHex } : undefined}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        selected
                          ? 'bg-blue-600/10 border-blue-500 text-blue-300'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      @{role.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Hide roles */}
          {selectedRoleIds.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={hideRoles}
                onClick={() => setHideRoles((v) => !v)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                  hideRoles ? 'bg-blue-600' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                    hideRoles ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
              <div>
                <span className="text-sm text-zinc-300">Ocultar cargos</span>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Envolve as menções em spoiler{' '}
                  <code className="text-zinc-400">
                    ||{selectedRoleIds.map((id) => `@${roles.find((r) => r.id === id)?.name ?? id}`).join(' ')}||
                  </code>
                </p>
              </div>
            </div>
          )}

          {/* Preview toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              {showPreview ? 'Ocultar pré-visualização' : 'Pré-visualizar mensagem'}
            </button>

            {showPreview && (
              <div className="mt-3 bg-zinc-950 border border-zinc-800 rounded-lg p-4">
                <p className="text-xs font-medium text-zinc-500 mb-2">Pré-visualização</p>
                <pre className="text-sm text-zinc-200 whitespace-pre-wrap font-sans break-words">
                  {previewContent || <span className="text-zinc-600 italic">Mensagem vazia</span>}
                </pre>
              </div>
            )}
          </div>

          {canSend && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => sendMutation.mutate()}
                disabled={sendMutation.isPending || !selectedChannelId || !content.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Send className="w-4 h-4" />
                {sendMutation.isPending ? 'Enviando...' : 'Enviar aviso'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
