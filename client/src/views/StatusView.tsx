import { useQuery } from '@tanstack/react-query'
import { Wifi, WifiOff, AlertTriangle, Clock, Users, Gauge, RefreshCw } from 'lucide-react'

import { listBotStatus } from '../api/admin'
import { ApiError } from '../api/client'
import type { BotStatus } from '../types'

const STATUS_REFRESH_MS = 15_000

function extractError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'erro inesperado'
}

function relativeTime(value: string | null): string {
  if (!value) return '--'
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return '--'
  const diff = Date.now() - parsed
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s atrás`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min atrás`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h atrás`
  return new Date(parsed).toLocaleDateString('pt-BR')
}

function formatLatency(ms: number | null): string {
  if (ms === null) return '--'
  return `${ms}ms`
}

interface StatusBadgeProps {
  item: BotStatus
}

function StatusBadge({ item }: StatusBadgeProps) {
  if (!item.isActive) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-800 text-zinc-500">
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
        Inativo
      </span>
    )
  }
  if (item.isOnline) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot" />
        Online
      </span>
    )
  }
  if (item.status === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        Erro
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-400">
      <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
      Offline
    </span>
  )
}

function BotStatusCard({ item }: { item: BotStatus }) {
  return (
    <article className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4 hover:border-zinc-700 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-zinc-100 truncate">{item.botName}</p>
          <p className="text-xs text-zinc-600 font-mono mt-0.5">{item.botId.slice(0, 8)}…</p>
        </div>
        <StatusBadge item={item} />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-zinc-950/60 rounded-lg px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-zinc-500 mb-1">
            <Clock className="w-3 h-3" />
            <span className="text-xs">Último ping</span>
          </div>
          <p className="text-sm font-medium text-zinc-300">{relativeTime(item.lastSeenAt)}</p>
        </div>

        <div className="bg-zinc-950/60 rounded-lg px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-zinc-500 mb-1">
            <Users className="w-3 h-3" />
            <span className="text-xs">Servidores</span>
          </div>
          <p className="text-sm font-medium text-zinc-300">
            {item.guildsCount !== null ? item.guildsCount : '--'}
          </p>
        </div>

        <div className="bg-zinc-950/60 rounded-lg px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-zinc-500 mb-1">
            <Gauge className="w-3 h-3" />
            <span className="text-xs">Latência</span>
          </div>
          <p className="text-sm font-medium text-zinc-300">{formatLatency(item.latencyMs)}</p>
        </div>

        <div className="bg-zinc-950/60 rounded-lg px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-zinc-500 mb-1">
            <RefreshCw className="w-3 h-3" />
            <span className="text-xs">Iniciado</span>
          </div>
          <p className="text-sm font-medium text-zinc-300">{relativeTime(item.startedAt)}</p>
        </div>
      </div>

      {item.errorMessage ? (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-400 break-words">{item.errorMessage}</p>
        </div>
      ) : null}

      {item.restartRequestedAt ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <RefreshCw className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
          <p className="text-xs text-yellow-400">
            Reinício solicitado {relativeTime(item.restartRequestedAt)}
          </p>
        </div>
      ) : null}
    </article>
  )
}

export function StatusView() {
  const statusQuery = useQuery({
    queryKey: ['bot-status'],
    queryFn: listBotStatus,
    refetchInterval: STATUS_REFRESH_MS,
  })

  const items = statusQuery.data ?? []
  const online = items.filter((i) => i.isOnline).length
  const active = items.filter((i) => i.isActive).length
  const offline = items.filter((i) => i.isActive && !i.isOnline).length

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-500 mb-0.5">Runtime Analytics</p>
          <h2 className="text-base font-semibold text-zinc-100">Status dos bots</h2>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Atualiza a cada 15s</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-1">Total</p>
          <p className="text-2xl font-bold text-zinc-100">{items.length}</p>
          <p className="text-xs text-zinc-600 mt-0.5">cadastrados</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-1">Ativos</p>
          <p className="text-2xl font-bold text-zinc-100">{active}</p>
          <p className="text-xs text-zinc-600 mt-0.5">habilitados</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-1">Online</p>
          <p className="text-2xl font-bold text-emerald-400">{online}</p>
          <p className="text-xs text-zinc-600 mt-0.5">heartbeat recente</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-1">Offline</p>
          <p className="text-2xl font-bold text-yellow-400">{offline}</p>
          <p className="text-xs text-zinc-600 mt-0.5">sem heartbeat</p>
        </div>
      </div>

      {/* Cards grid */}
      {statusQuery.isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : statusQuery.isError ? (
        <div className="px-6 py-10 text-center text-sm text-red-400">
          {extractError(statusQuery.error)}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 px-6 py-16 text-center">
          <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
            <WifiOff className="w-5 h-5 text-zinc-600" />
          </div>
          <p className="text-sm text-zinc-500">Nenhum bot cadastrado.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((item) => (
            <BotStatusCard key={item.botId} item={item} />
          ))}
        </div>
      )}

      {/* Legend */}
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-zinc-800/60">
          <p className="text-xs text-zinc-600">Legenda:</p>
          <span className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Wifi className="w-3 h-3 text-emerald-400" /> Online = heartbeat nos últimos 2min
          </span>
          <span className="flex items-center gap-1.5 text-xs text-zinc-500">
            <WifiOff className="w-3 h-3 text-yellow-400" /> Offline = sem heartbeat
          </span>
        </div>
      )}
    </div>
  )
}
