import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus, Trash2, ShieldCheck } from 'lucide-react'

import {
  getDiscordLoginConfig,
  updateDiscordLoginConfig,
  addDiscordRoleMapping,
  removeDiscordRoleMapping,
  listBots,
  listBotDiscordGuilds,
  listGuildRoles,
} from '../api/admin'
import { ApiError } from '../api/client'
import type { SessionResponse } from '../types'

function extractError(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return 'erro inesperado'
}

interface Props {
  session: SessionResponse | null
}

export function DiscordLoginView({ session }: Props) {
  const queryClient = useQueryClient()
  const isCeo = session?.user?.role === 'ceo'
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const cfgQuery = useQuery({ queryKey: ['discord-login'], queryFn: getDiscordLoginConfig })
  const config = cfgQuery.data?.config
  const mappings = cfgQuery.data?.mappings ?? []

  // --- form de credenciais ---
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    if (config) {
      setClientId(config.clientId)
      setEnabled(config.enabled)
    }
  }, [config])

  const saveConfig = useMutation({
    mutationFn: () =>
      updateDiscordLoginConfig({
        clientId,
        clientSecret: clientSecret || undefined,
        enabled,
      }),
    onSuccess: () => {
      setClientSecret('')
      setMsg({ type: 'ok', text: 'Configuração salva.' })
      void queryClient.invalidateQueries({ queryKey: ['discord-login'] })
    },
    onError: (e) => setMsg({ type: 'err', text: extractError(e) }),
  })

  // --- form de mapeamento de cargo ---
  const [botId, setBotId] = useState('')
  const [guildId, setGuildId] = useState('')
  const [roleId, setRoleId] = useState('')
  const [panelRole, setPanelRole] = useState<'admin' | 'user'>('user')

  const botsQuery = useQuery({ queryKey: ['bots'], queryFn: listBots })
  const guildsQuery = useQuery({
    queryKey: ['discord-guilds', botId],
    queryFn: () => listBotDiscordGuilds(botId),
    enabled: Boolean(botId),
  })
  const rolesQuery = useQuery({
    queryKey: ['discord-roles', botId, guildId],
    queryFn: () => listGuildRoles(botId, guildId),
    enabled: Boolean(botId && guildId),
  })
  const roles = rolesQuery.data ?? []

  const addMapping = useMutation({
    mutationFn: () => {
      const role = roles.find((r) => r.id === roleId)
      return addDiscordRoleMapping({
        guildId,
        roleId,
        roleName: role?.name ?? '',
        panelRole,
      })
    },
    onSuccess: () => {
      setRoleId('')
      setMsg({ type: 'ok', text: 'Cargo mapeado.' })
      void queryClient.invalidateQueries({ queryKey: ['discord-login'] })
    },
    onError: (e) => setMsg({ type: 'err', text: extractError(e) }),
  })

  const removeMapping = useMutation({
    mutationFn: (id: string) => removeDiscordRoleMapping(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['discord-login'] }),
    onError: (e) => setMsg({ type: 'err', text: extractError(e) }),
  })

  const inputCls =
    'w-full bg-zinc-900 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm'

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <KeyRound className="w-5 h-5 text-zinc-400" />
          <h2 className="text-lg font-semibold text-zinc-100">Login com Discord</h2>
        </div>
        <p className="text-sm text-zinc-500">
          Usuários entram no painel pelo Discord; o cargo deles define o acesso (admin ou user).
        </p>
      </div>

      {msg && (
        <div className={`px-3 py-2 rounded-lg text-sm ${msg.type === 'ok' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
          {msg.text}
        </div>
      )}

      {/* credenciais */}
      <section className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-zinc-200">Credenciais da aplicação Discord</h3>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Client ID</label>
          <input className={inputCls} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="ID da aplicação" />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">
            Client Secret {config?.hasSecret && <span className="text-zinc-600">(já configurado — preencha só para trocar)</span>}
          </label>
          <input className={inputCls} type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={config?.hasSecret ? '••••••••' : 'Client secret'} />
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-blue-600" />
          Habilitar o botão "Entrar com Discord" na tela de login
        </label>
        <div className="text-xs text-zinc-600">
          Redirect URI (já deve estar no portal): <code className="text-zinc-400">https://painel.daniloc.work/api/admin/auth/discord/callback</code>
        </div>
        <button
          type="button"
          onClick={() => saveConfig.mutate()}
          disabled={saveConfig.isPending}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-4 py-2"
        >
          {saveConfig.isPending ? 'Salvando…' : 'Salvar credenciais'}
        </button>
      </section>

      {/* mapeamento de cargos */}
      <section className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-zinc-200">Mapa de cargos → acesso</h3>
        <p className="text-xs text-zinc-500">Quem entrar pelo Discord com um destes cargos recebe o acesso correspondente. Sem cargo mapeado = sem acesso.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select className={inputCls} value={botId} onChange={(e) => { setBotId(e.target.value); setGuildId(''); setRoleId('') }}>
            <option value="">— Bot —</option>
            {(botsQuery.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className={inputCls} value={guildId} onChange={(e) => { setGuildId(e.target.value); setRoleId('') }} disabled={!botId}>
            <option value="">— Servidor —</option>
            {(guildsQuery.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select className={inputCls} value={roleId} onChange={(e) => setRoleId(e.target.value)} disabled={!guildId}>
            <option value="">— Cargo —</option>
            {roles.filter((r) => r.name !== '@everyone').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select className={inputCls} value={panelRole} onChange={(e) => setPanelRole(e.target.value as 'admin' | 'user')}>
            <option value="user">→ acesso: user</option>
            <option value="admin" disabled={!isCeo}>→ acesso: admin{isCeo ? '' : ' (só CEO)'}</option>
          </select>
        </div>
        <button
          type="button"
          onClick={() => addMapping.mutate()}
          disabled={!roleId || addMapping.isPending}
          className="inline-flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 text-sm rounded-lg px-3 py-2"
        >
          <Plus className="w-3.5 h-3.5" /> Adicionar mapeamento
        </button>

        <div className="border-t border-zinc-800 pt-4 space-y-2">
          {mappings.length === 0 ? (
            <p className="text-sm text-zinc-600">Nenhum cargo mapeado ainda.</p>
          ) : (
            mappings.map((m) => (
              <div key={m.id} className="flex items-center gap-3 bg-zinc-950 border border-zinc-800/60 rounded-lg px-3 py-2">
                <ShieldCheck className="w-4 h-4 text-zinc-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-200 truncate">{m.roleName || m.roleId}</p>
                  <p className="text-xs text-zinc-600 font-mono truncate">guild {m.guildId}</p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${m.panelRole === 'admin' ? 'bg-blue-500/10 text-blue-400' : 'bg-zinc-800 text-zinc-400'}`}>{m.panelRole}</span>
                <button type="button" onClick={() => removeMapping.mutate(m.id)} className="text-zinc-600 hover:text-red-400 p-1">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
