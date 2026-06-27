import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, UserPlus, RefreshCw } from 'lucide-react'
import { listBots, listBotDiscordGuilds, listTickets, sendTicketReply, addUserToTicket } from '../api/admin'
import { ApiError } from '../api/client'
import type { SessionResponse, Ticket } from '../types'

function extractError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'erro inesperado'
}

function statusBadge(status: string) {
  if (status === 'open') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
  if (status === 'closed') return 'bg-zinc-700/50 text-zinc-400 border-zinc-600/20'
  return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
}

interface TicketRowProps {
  ticket: Ticket
  botId: string
  guildId: string
  adminName: string
  canEdit: boolean
}

function TicketRow({ ticket, botId, guildId, adminName, canEdit }: TicketRowProps) {
  const queryClient = useQueryClient()
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyContent, setReplyContent] = useState('')
  const [addUserOpen, setAddUserOpen] = useState(false)
  const [addUserId, setAddUserId] = useState('')
  const [rowFeedback, setRowFeedback] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const replyMutation = useMutation({
    mutationFn: () =>
      sendTicketReply(botId, guildId, ticket.id, ticket.channelId, adminName, replyContent.trim()),
    onSuccess: () => {
      setRowFeedback('Resposta enviada.')
      setRowError(null)
      setReplyContent('')
      setReplyOpen(false)
    },
    onError: (err) => {
      setRowError(extractError(err))
    },
  })

  const addUserMutation = useMutation({
    mutationFn: () =>
      addUserToTicket(botId, guildId, ticket.id, ticket.channelId, addUserId.trim()),
    onSuccess: () => {
      setRowFeedback('Usuário adicionado ao canal.')
      setRowError(null)
      setAddUserId('')
      setAddUserOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['tickets', botId, guildId] })
    },
    onError: (err) => {
      setRowError(extractError(err))
    },
  })

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-zinc-200">
              #{ticket.ticketNumber.toString().padStart(4, '0')} — {ticket.category || 'geral'}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${statusBadge(ticket.status)}`}>
              {ticket.status}
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            {`<@${ticket.userId}>`} • {new Date(ticket.createdAt).toLocaleString('pt-BR')}
          </p>
          <p className="text-xs text-zinc-600 font-mono">canal: {ticket.channelId}</p>
        </div>

        {canEdit && ticket.status !== 'closed' && (
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => { setReplyOpen((v) => !v); setAddUserOpen(false) }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Responder
            </button>
            <button
              type="button"
              onClick={() => { setAddUserOpen((v) => !v); setReplyOpen(false) }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Adicionar
            </button>
          </div>
        )}
      </div>

      {rowFeedback && (
        <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
          {rowFeedback}
        </div>
      )}
      {rowError && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
          {rowError}
        </div>
      )}

      {replyOpen && (
        <div className="space-y-2 pt-1 border-t border-zinc-800">
          <p className="text-xs font-medium text-zinc-400">Responder como <span className="text-zinc-200">{adminName}</span></p>
          <textarea
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
            placeholder="Mensagem..."
            rows={3}
            className="w-full bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm resize-none"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => replyMutation.mutate()}
              disabled={replyMutation.isPending || !replyContent.trim()}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
            >
              {replyMutation.isPending ? 'Enviando...' : 'Enviar'}
            </button>
          </div>
        </div>
      )}

      {addUserOpen && (
        <div className="space-y-2 pt-1 border-t border-zinc-800">
          <p className="text-xs font-medium text-zinc-400">Adicionar usuário ao ticket</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value)}
              placeholder="ID do usuário Discord"
              className="flex-1 bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm font-mono"
            />
            <button
              type="button"
              onClick={() => addUserMutation.mutate()}
              disabled={addUserMutation.isPending || !addUserId.trim()}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
            >
              {addUserMutation.isPending ? '...' : 'Adicionar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface TicketManagerViewProps {
  session: SessionResponse | null
}

export function TicketManagerView({ session }: TicketManagerViewProps) {
  const queryClient = useQueryClient()
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null)
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const permissions = session?.permissions
  const canEdit = Boolean(permissions?.canUpdateBots)
  const sessionBotIds = session?.botIds ?? []
  const adminName = session?.user?.displayName ?? 'Admin'

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

  const ticketsQuery = useQuery({
    queryKey: ['tickets', selectedBotId, selectedGuildId],
    queryFn: () =>
      selectedBotId && selectedGuildId
        ? listTickets(selectedBotId, selectedGuildId)
        : Promise.resolve([]),
    enabled: Boolean(selectedBotId && selectedGuildId),
  })

  const allTickets = ticketsQuery.data ?? []
  const filteredTickets: Ticket[] = statusFilter === 'all'
    ? allTickets
    : allTickets.filter((t) => t.status === statusFilter)

  return (
    <div className="p-6 space-y-6">
      <div>
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Suporte</p>
        <h2 className="text-lg font-semibold text-zinc-100">Gerenciador de Tickets</h2>
        <p className="text-sm text-zinc-500 mt-0.5">
          Visualize, responda e gerencie tickets pelo painel.
        </p>
      </div>

      {/* Bot */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
        <label className="block text-xs font-medium text-zinc-400 mb-2">Bot</label>
        <div className="flex flex-wrap gap-2">
          {visibleBots.map((bot) => (
            <button
              key={bot.id}
              type="button"
              onClick={() => {
                setSelectedBotId(bot.id)
                setSelectedGuildId(null)
              }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                selectedBotId === bot.id ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              {bot.name}
            </button>
          ))}
        </div>
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
                  onClick={() => setSelectedGuildId(g.id)}
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
        <>
          {/* Filters + refresh */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-2">
              {['all', 'open', 'closed'].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    statusFilter === s ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {s === 'all' ? 'Todos' : s === 'open' ? 'Abertos' : 'Fechados'}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ['tickets', selectedBotId, selectedGuildId] })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Atualizar
            </button>
          </div>

          {/* Ticket list */}
          {ticketsQuery.isLoading ? (
            <div className="text-sm text-zinc-500 text-center py-8">Carregando tickets...</div>
          ) : filteredTickets.length === 0 ? (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 text-center">
              <p className="text-sm text-zinc-500">Nenhum ticket encontrado.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTickets.map((ticket) => (
                <TicketRow
                  key={ticket.id}
                  ticket={ticket}
                  botId={selectedBotId}
                  guildId={selectedGuildId}
                  adminName={adminName}
                  canEdit={canEdit}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
