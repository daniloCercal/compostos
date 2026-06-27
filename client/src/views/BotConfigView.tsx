import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Wifi } from 'lucide-react'
import {
  listBots,
  listBotDiscordGuilds,
  getExtendedConfig,
  upsertExtendedConfig,
  setBotPresence,
  getGuildConfig,
  upsertGuildConfig,
  listGuildChannels,
  listGuildRoles,
} from '../api/admin'
import { ApiError } from '../api/client'
import type { SessionResponse, PanelEmbedConfig, PanelConfigs } from '../types'

const inputCls = 'w-full bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm disabled:opacity-50'
const selectCls = 'w-full bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-zinc-100 rounded-lg px-3 py-2 text-sm disabled:opacity-50'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

function ChannelSelect({ label, value, onChange, channels, disabled, onDirty }: {
  label: string; value: string; onChange: (v: string) => void
  channels: { id: string; name: string }[]; disabled: boolean; onDirty: () => void
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => { onChange(e.target.value); onDirty() }} disabled={disabled} className={selectCls}>
        <option value="">— Não configurado —</option>
        {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
      </select>
    </Field>
  )
}

function CategorySelect({ label, value, onChange, categories, disabled, onDirty }: {
  label: string; value: string; onChange: (v: string) => void
  categories: { id: string; name: string }[]; disabled: boolean; onDirty: () => void
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => { onChange(e.target.value); onDirty() }} disabled={disabled} className={selectCls}>
        <option value="">— Não configurado —</option>
        {categories.map((c) => <option key={c.id} value={c.id}>📁 {c.name}</option>)}
      </select>
    </Field>
  )
}

function RoleSelect({ label, value, onChange, roles, disabled, onDirty }: {
  label: string; value: string; onChange: (v: string) => void
  roles: { id: string; name: string }[]; disabled: boolean; onDirty: () => void
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => { onChange(e.target.value); onDirty() }} disabled={disabled} className={selectCls}>
        <option value="">— Não configurado —</option>
        {roles.map((r) => <option key={r.id} value={r.id}>@{r.name}</option>)}
      </select>
    </Field>
  )
}

const BOT_PANEL_DEFAULTS: PanelConfigs = {
  whitelist: {
    title: '📋 Painel de Whitelist',
    description: 'Clique no botão abaixo para iniciar sua whitelist.\n\nVocê responderá a um formulário inicial e, em seguida, fará a prova teórica em um canal privado.\n\n**Como funciona**\n> Clique em Iniciar Whitelist\n> Preencha o nome do personagem e o ID do FiveM\n> Responda às perguntas teóricas configuradas no painel web\n> Se passar, aguarde a entrevista com a equipe',
    buttonLabel: '📝 Iniciar Whitelist',
    placeholder: '',
  },
  tickets: {
    title: '🎫 Suporte',
    description: 'Selecione uma categoria abaixo para abrir um ticket com a equipe.',
    buttonLabel: '',
    placeholder: 'Escolha uma categoria...',
  },
  verification: {
    title: '✅ Verificação',
    description: 'Clique no botão abaixo para verificar sua conta e obter acesso ao servidor.',
    buttonLabel: '✅ Verificar',
    placeholder: '',
  },
}

function applyPanelDefaults(pc: PanelConfigs): PanelConfigs {
  const d = BOT_PANEL_DEFAULTS
  return {
    whitelist: {
      title: pc.whitelist.title || d.whitelist.title,
      description: pc.whitelist.description || d.whitelist.description,
      buttonLabel: pc.whitelist.buttonLabel || d.whitelist.buttonLabel,
      placeholder: pc.whitelist.placeholder || d.whitelist.placeholder,
    },
    tickets: {
      title: pc.tickets.title || d.tickets.title,
      description: pc.tickets.description || d.tickets.description,
      buttonLabel: pc.tickets.buttonLabel || d.tickets.buttonLabel,
      placeholder: pc.tickets.placeholder || d.tickets.placeholder,
    },
    verification: {
      title: pc.verification.title || d.verification.title,
      description: pc.verification.description || d.verification.description,
      buttonLabel: pc.verification.buttonLabel || d.verification.buttonLabel,
      placeholder: pc.verification.placeholder || d.verification.placeholder,
    },
  }
}

function emptyPanelConfigs(): PanelConfigs {
  return { whitelist: { title: '', description: '', buttonLabel: '', placeholder: '' }, tickets: { title: '', description: '', buttonLabel: '', placeholder: '' }, verification: { title: '', description: '', buttonLabel: '', placeholder: '' } }
}

function extractError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'erro inesperado'
}

// Convert number like 0x8B0000 to "#8B0000"
function colorToHex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0').toUpperCase()
}

// Convert "#8B0000" to number 0x8B0000
function hexToColor(s: string): number {
  const clean = s.replace('#', '')
  const n = parseInt(clean, 16)
  return isNaN(n) ? 0x8B0000 : n
}

const ACTIVITY_TYPES = [
  { value: 0, label: 'Jogando' },
  { value: 1, label: 'Streamando' },
  { value: 2, label: 'Ouvindo' },
  { value: 3, label: 'Assistindo' },
  { value: 5, label: 'Competindo' },
]

const STATUS_OPTIONS = [
  { value: 'online', label: '🟢 Online' },
  { value: 'idle', label: '🟡 Ausente' },
  { value: 'dnd', label: '🔴 Não perturbe' },
  { value: 'invisible', label: '⚫ Invisível' },
]

interface BotConfigViewProps {
  session: SessionResponse | null
}

export function BotConfigView({ session }: BotConfigViewProps) {
  const queryClient = useQueryClient()
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null)
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null)

  // Extended config form state
  const [embedColorHex, setEmbedColorHex] = useState('#8B0000')
  const [ticketImageUrl, setTicketImageUrl] = useState('')
  const [welcomeImageUrl, setWelcomeImageUrl] = useState('')
  const [dmNotifyDefault, setDmNotifyDefault] = useState(true)
  const [configDirty, setConfigDirty] = useState(false)
  const [configFeedback, setConfigFeedback] = useState<string | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)

  // Guild channel/role config state
  const [logChannelId, setLogChannelId] = useState('')
  const [ticketCategoryId, setTicketCategoryId] = useState('')
  const [ticketLogChannelId, setTicketLogChannelId] = useState('')
  const [whitelistChannelId, setWhitelistChannelId] = useState('')
  const [whitelistLogChannelId, setWhitelistLogChannelId] = useState('')
  const [whitelistRoleId, setWhitelistRoleId] = useState('')
  const [verifiedRoleId, setVerifiedRoleId] = useState('')
  const [staffRoleId, setStaffRoleId] = useState('')
  const [adminRoleId, setAdminRoleId] = useState('')
  const [whitelistPassScore, setWhitelistPassScore] = useState(80)
  const [channelsDirty, setChannelsDirty] = useState(false)
  const [channelsFeedback, setChannelsFeedback] = useState<string | null>(null)
  const [channelsError, setChannelsError] = useState<string | null>(null)

  // Panel embed config state
  const [panelConfigs, setPanelConfigs] = useState<PanelConfigs>(applyPanelDefaults(emptyPanelConfigs()))
  const [selectedPanel, setSelectedPanel] = useState<'whitelist' | 'tickets' | 'verification'>('whitelist')
  const [panelsDirty, setPanelsDirty] = useState(false)
  const [panelsFeedback, setPanelsFeedback] = useState<string | null>(null)
  const [panelsError, setPanelsError] = useState<string | null>(null)

  // Presence form state
  const [presenceStatus, setPresenceStatus] = useState('online')
  const [presenceActivityType, setPresenceActivityType] = useState(0)
  const [presenceActivityName, setPresenceActivityName] = useState('')
  const [presenceFeedback, setPresenceFeedback] = useState<string | null>(null)
  const [presenceError, setPresenceError] = useState<string | null>(null)

  const permissions = session?.permissions
  const canEdit = Boolean(permissions?.canUpdateBots)
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

  const extConfigQuery = useQuery({
    queryKey: ['extended-config', selectedBotId, selectedGuildId],
    queryFn: async () => {
      if (!selectedBotId || !selectedGuildId) return null
      return getExtendedConfig(selectedBotId, selectedGuildId)
    },
    enabled: Boolean(selectedBotId && selectedGuildId),
  })

  const guildConfigQuery = useQuery({
    queryKey: ['guild-config', selectedBotId, selectedGuildId],
    queryFn: () => selectedBotId && selectedGuildId ? getGuildConfig(selectedBotId, selectedGuildId) : Promise.resolve(null),
    enabled: Boolean(selectedBotId && selectedGuildId),
  })

  const channelsQuery = useQuery({
    queryKey: ['guild-channels', selectedBotId, selectedGuildId],
    queryFn: () => selectedBotId && selectedGuildId ? listGuildChannels(selectedBotId, selectedGuildId) : Promise.resolve([]),
    enabled: Boolean(selectedBotId && selectedGuildId),
  })

  const rolesQuery = useQuery({
    queryKey: ['guild-roles', selectedBotId, selectedGuildId],
    queryFn: () => selectedBotId && selectedGuildId ? listGuildRoles(selectedBotId, selectedGuildId) : Promise.resolve([]),
    enabled: Boolean(selectedBotId && selectedGuildId),
  })

  // Sync server data into form fields when loaded
  useEffect(() => {
    const data = extConfigQuery.data
    if (data) {
      setEmbedColorHex(colorToHex(data.embedColor))
      setTicketImageUrl(data.ticketImageUrl)
      setWelcomeImageUrl(data.welcomeImageUrl)
      setDmNotifyDefault(data.dmNotifyDefault)
      setConfigDirty(false)
    }
  }, [extConfigQuery.data])

  useEffect(() => {
    const cfg = guildConfigQuery.data
    if (cfg) {
      setLogChannelId(cfg.logChannelId)
      setTicketCategoryId(cfg.ticketCategoryId)
      setTicketLogChannelId(cfg.ticketLogChannelId)
      setWhitelistChannelId(cfg.whitelistChannelId)
      setWhitelistLogChannelId(cfg.whitelistLogChannelId)
      setWhitelistRoleId(cfg.whitelistRoleId)
      setVerifiedRoleId(cfg.verifiedRoleId)
      setStaffRoleId(cfg.staffRoleId)
      setAdminRoleId(cfg.adminRoleId)
      setWhitelistPassScore(cfg.whitelistPassScore ?? 80)
      setPanelConfigs(applyPanelDefaults(cfg.panelConfigs ?? emptyPanelConfigs()))
      setChannelsDirty(false)
      setPanelsDirty(false)
    }
  }, [guildConfigQuery.data])

  const saveConfigMutation = useMutation({
    mutationFn: () => {
      if (!selectedBotId || !selectedGuildId) throw new Error('Selecione bot e servidor')
      return upsertExtendedConfig(selectedBotId, selectedGuildId, {
        embedColor: hexToColor(embedColorHex),
        ticketImageUrl,
        welcomeImageUrl,
        dmNotifyDefault,
      })
    },
    onSuccess: () => {
      setConfigFeedback('Configurações salvas.')
      setConfigError(null)
      setConfigDirty(false)
      void queryClient.invalidateQueries({ queryKey: ['extended-config', selectedBotId, selectedGuildId] })
    },
    onError: (err) => {
      setConfigError(extractError(err))
    },
  })

  const saveChannelsMutation = useMutation({
    mutationFn: () => {
      if (!selectedBotId || !selectedGuildId) throw new Error('Selecione bot e servidor')
      const existing = guildConfigQuery.data
      return upsertGuildConfig(selectedBotId, selectedGuildId, {
        logChannelId,
        ticketCategoryId,
        ticketLogChannelId,
        whitelistChannelId,
        whitelistLogChannelId,
        whitelistRoleId,
        verifiedRoleId,
        staffRoleId,
        adminRoleId,
        maxTicketsPerUser: existing?.maxTicketsPerUser ?? 3,
        ticketPrefix: existing?.ticketPrefix ?? 'ticket',
        whitelistPassMessage: existing?.whitelistPassMessage ?? '',
        whitelistFailMessage: existing?.whitelistFailMessage ?? '',
        welcomeMessage: existing?.welcomeMessage ?? '',
        whitelistPassScore,
        panelConfigs,
      })
    },
    onSuccess: () => {
      setChannelsFeedback('Canais e cargos salvos.')
      setChannelsError(null)
      setChannelsDirty(false)
      void queryClient.invalidateQueries({ queryKey: ['guild-config', selectedBotId, selectedGuildId] })
    },
    onError: (err) => {
      setChannelsError(extractError(err))
    },
  })

  const savePanelsMutation = useMutation({
    mutationFn: () => {
      if (!selectedBotId || !selectedGuildId) throw new Error('Selecione bot e servidor')
      const existing = guildConfigQuery.data
      return upsertGuildConfig(selectedBotId, selectedGuildId, {
        logChannelId,
        ticketCategoryId,
        ticketLogChannelId,
        whitelistChannelId,
        whitelistLogChannelId,
        whitelistRoleId,
        verifiedRoleId,
        staffRoleId,
        adminRoleId,
        maxTicketsPerUser: existing?.maxTicketsPerUser ?? 3,
        ticketPrefix: existing?.ticketPrefix ?? 'ticket',
        whitelistPassMessage: existing?.whitelistPassMessage ?? '',
        whitelistFailMessage: existing?.whitelistFailMessage ?? '',
        welcomeMessage: existing?.welcomeMessage ?? '',
        whitelistPassScore,
        panelConfigs,
      })
    },
    onSuccess: () => {
      setPanelsFeedback('Embeds dos painéis salvos.')
      setPanelsError(null)
      setPanelsDirty(false)
      void queryClient.invalidateQueries({ queryKey: ['guild-config', selectedBotId, selectedGuildId] })
    },
    onError: (err) => {
      setPanelsError(extractError(err))
    },
  })

  const setPresenceMutation = useMutation({
    mutationFn: () => {
      if (!selectedBotId || !selectedGuildId) throw new Error('Selecione bot e servidor')
      return setBotPresence(selectedBotId, selectedGuildId, presenceStatus, presenceActivityType, presenceActivityName)
    },
    onSuccess: () => {
      setPresenceFeedback('Presença enfileirada — o bot vai aplicar em até 2 segundos.')
      setPresenceError(null)
    },
    onError: (err) => {
      setPresenceError(extractError(err))
    },
  })

  function handleSelectBot(botId: string) {
    setSelectedBotId(botId)
    setSelectedGuildId(null)
    setConfigDirty(false)
    setConfigFeedback(null)
    setConfigError(null)
    setChannelsDirty(false)
    setChannelsFeedback(null)
    setChannelsError(null)
    setPanelsDirty(false)
    setPanelsFeedback(null)
    setPanelsError(null)
    setPresenceFeedback(null)
    setPresenceError(null)
  }

  function handleSelectGuild(guildId: string) {
    setSelectedGuildId(guildId)
    setConfigDirty(false)
    setConfigFeedback(null)
    setConfigError(null)
    setChannelsDirty(false)
    setChannelsFeedback(null)
    setChannelsError(null)
    setPanelsDirty(false)
    setPanelsFeedback(null)
    setPanelsError(null)
    setPresenceFeedback(null)
    setPresenceError(null)
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Configurações</p>
        <h2 className="text-lg font-semibold text-zinc-100">Configuração Visual e Presença</h2>
        <p className="text-sm text-zinc-500 mt-0.5">
          Personalize cores, imagens, DM padrão e status do bot.
        </p>
      </div>

      {/* Bot selector */}
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
                onClick={() => handleSelectBot(bot.id)}
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

      {/* Guild selector */}
      {selectedBotId && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <label className="block text-xs font-medium text-zinc-400 mb-2">Servidor</label>
          {guildsQuery.isLoading ? (
            <p className="text-sm text-zinc-500">Carregando servidores...</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(guildsQuery.data ?? []).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => handleSelectGuild(g.id)}
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
          {/* Extended config */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 space-y-4">
            <p className="text-sm font-semibold text-zinc-200">Aparência dos Embeds</p>

            {configFeedback && (
              <div className="px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">
                {configFeedback}
              </div>
            )}
            {configError && (
              <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                {configError}
              </div>
            )}

            {extConfigQuery.isLoading ? (
              <p className="text-sm text-zinc-500">Carregando configuração...</p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Cor do embed (hex)">
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={embedColorHex}
                        onChange={(e) => { setEmbedColorHex(e.target.value.toUpperCase()); setConfigDirty(true) }}
                        disabled={!canEdit}
                        className="h-9 w-10 rounded cursor-pointer bg-zinc-950 border border-zinc-800 p-0.5 disabled:opacity-50"
                      />
                      <input
                        type="text"
                        value={embedColorHex}
                        onChange={(e) => { setEmbedColorHex(e.target.value); setConfigDirty(true) }}
                        disabled={!canEdit}
                        placeholder="#8B0000"
                        className={`${inputCls} flex-1`}
                      />
                    </div>
                  </Field>

                  <Field label="DM padrão ativada">
                    <div className="flex items-center gap-3 h-9">
                      <button
                        type="button"
                        onClick={() => { setDmNotifyDefault(!dmNotifyDefault); setConfigDirty(true) }}
                        disabled={!canEdit}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                          dmNotifyDefault ? 'bg-blue-600' : 'bg-zinc-700'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                            dmNotifyDefault ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                      <span className="text-sm text-zinc-400">
                        {dmNotifyDefault ? 'Notificar por DM por padrão' : 'DM desativada por padrão'}
                      </span>
                    </div>
                  </Field>
                </div>

                <Field label="URL da imagem do ticket">
                  <input
                    type="url"
                    value={ticketImageUrl}
                    onChange={(e) => { setTicketImageUrl(e.target.value); setConfigDirty(true) }}
                    disabled={!canEdit}
                    placeholder="https://..."
                    className={inputCls}
                  />
                </Field>

                <Field label="URL da imagem de boas-vindas">
                  <input
                    type="url"
                    value={welcomeImageUrl}
                    onChange={(e) => { setWelcomeImageUrl(e.target.value); setConfigDirty(true) }}
                    disabled={!canEdit}
                    placeholder="https://..."
                    className={inputCls}
                  />
                </Field>

                {ticketImageUrl && (
                  <div>
                    <p className="text-xs font-medium text-zinc-500 mb-1">Preview — ticket</p>
                    <img src={ticketImageUrl} alt="ticket preview" className="h-24 rounded-lg object-cover" />
                  </div>
                )}
                {welcomeImageUrl && (
                  <div>
                    <p className="text-xs font-medium text-zinc-500 mb-1">Preview — boas-vindas</p>
                    <img src={welcomeImageUrl} alt="welcome preview" className="h-24 rounded-lg object-cover" />
                  </div>
                )}

                {canEdit && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => saveConfigMutation.mutate()}
                      disabled={saveConfigMutation.isPending || !configDirty}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      <Save className="w-4 h-4" />
                      {saveConfigMutation.isPending ? 'Salvando...' : 'Salvar aparência'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Channels & Roles */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 space-y-5">
            <p className="text-sm font-semibold text-zinc-200">Canais e Cargos</p>

            {channelsFeedback && (
              <div className="px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">
                {channelsFeedback}
              </div>
            )}
            {channelsError && (
              <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                {channelsError}
              </div>
            )}

            {(channelsQuery.isLoading || rolesQuery.isLoading || guildConfigQuery.isLoading) ? (
              <p className="text-sm text-zinc-500">Carregando...</p>
            ) : (() => {
              const textChannels = (channelsQuery.data ?? []).filter((c) => c.type !== 4)
              const categories = (channelsQuery.data ?? []).filter((c) => c.type === 4)
              const roles = rolesQuery.data ?? []
              const onDirty = () => setChannelsDirty(true)
              return (
                <div className="space-y-5">
                  <div>
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Canais de texto</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <ChannelSelect label="Logs gerais" value={logChannelId} onChange={setLogChannelId} channels={textChannels} disabled={!canEdit} onDirty={onDirty} />
                      <ChannelSelect label="Log de tickets" value={ticketLogChannelId} onChange={setTicketLogChannelId} channels={textChannels} disabled={!canEdit} onDirty={onDirty} />
                      <ChannelSelect label="Log da whitelist" value={whitelistLogChannelId} onChange={setWhitelistLogChannelId} channels={textChannels} disabled={!canEdit} onDirty={onDirty} />
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Categorias</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <CategorySelect label="Categoria dos tickets" value={ticketCategoryId} onChange={setTicketCategoryId} categories={categories} disabled={!canEdit} onDirty={onDirty} />
                      <CategorySelect label="Categoria das aplicações (whitelist)" value={whitelistChannelId} onChange={setWhitelistChannelId} categories={categories} disabled={!canEdit} onDirty={onDirty} />
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Whitelist</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="Pontuação mínima (%)">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={whitelistPassScore}
                          onChange={(e) => { setWhitelistPassScore(Number(e.target.value)); setChannelsDirty(true) }}
                          disabled={!canEdit}
                          className={inputCls}
                        />
                      </Field>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Cargos</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <RoleSelect label="Cargo de aprovado (whitelist)" value={whitelistRoleId} onChange={setWhitelistRoleId} roles={roles} disabled={!canEdit} onDirty={onDirty} />
                      <RoleSelect label="Cargo de verificado" value={verifiedRoleId} onChange={setVerifiedRoleId} roles={roles} disabled={!canEdit} onDirty={onDirty} />
                      <RoleSelect label="Cargo de staff" value={staffRoleId} onChange={setStaffRoleId} roles={roles} disabled={!canEdit} onDirty={onDirty} />
                      <RoleSelect label="Cargo de admin" value={adminRoleId} onChange={setAdminRoleId} roles={roles} disabled={!canEdit} onDirty={onDirty} />
                    </div>
                  </div>

                  {canEdit && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => saveChannelsMutation.mutate()}
                        disabled={saveChannelsMutation.isPending || !channelsDirty}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        <Save className="w-4 h-4" />
                        {saveChannelsMutation.isPending ? 'Salvando...' : 'Salvar canais e cargos'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>

          {/* Panel embed configs */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 space-y-4">
            <p className="text-sm font-semibold text-zinc-200">Embeds dos Painéis</p>

            {panelsFeedback && (
              <div className="px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">
                {panelsFeedback}
              </div>
            )}
            {panelsError && (
              <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                {panelsError}
              </div>
            )}

            {/* Tab selector */}
            <div className="flex gap-2">
              {([
                { key: 'whitelist', label: 'Whitelist' },
                { key: 'tickets', label: 'Tickets' },
                { key: 'verification', label: 'Verificação' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedPanel(key)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    selectedPanel === key ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {(() => {
              const embed = panelConfigs[selectedPanel]
              const setField = (field: keyof PanelEmbedConfig, value: string) => {
                setPanelConfigs((prev) => ({
                  ...prev,
                  [selectedPanel]: { ...prev[selectedPanel], [field]: value },
                }))
                setPanelsDirty(true)
              }

              const placeholders: Record<typeof selectedPanel, { title: string; description: string; buttonLabel: string; placeholder: string }> = {
                whitelist: {
                  title: '📋 Painel de Whitelist',
                  description: 'Clique no botão abaixo para iniciar sua whitelist.',
                  buttonLabel: '📝 Iniciar Whitelist',
                  placeholder: 'Preencha o formulário...',
                },
                tickets: {
                  title: '🎫 Suporte',
                  description: 'Abra um ticket para falar com nossa equipe.',
                  buttonLabel: '📩 Abrir Ticket',
                  placeholder: 'Descreva seu problema...',
                },
                verification: {
                  title: '✅ Verificação',
                  description: 'Clique abaixo para verificar sua conta.',
                  buttonLabel: '✅ Verificar',
                  placeholder: '',
                },
              }

              const ph = placeholders[selectedPanel]

              return (
                <div className="space-y-4">
                  <Field label="Título do embed">
                    <input
                      type="text"
                      value={embed.title}
                      onChange={(e) => setField('title', e.target.value)}
                      disabled={!canEdit}
                      placeholder={ph.title}
                      className={inputCls}
                    />
                  </Field>

                  <Field label="Descrição do embed">
                    <textarea
                      value={embed.description}
                      onChange={(e) => setField('description', e.target.value)}
                      disabled={!canEdit}
                      placeholder={ph.description}
                      rows={5}
                      className={`${inputCls} resize-y`}
                    />
                  </Field>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Texto do botão">
                      <input
                        type="text"
                        value={embed.buttonLabel}
                        onChange={(e) => setField('buttonLabel', e.target.value)}
                        disabled={!canEdit}
                        placeholder={ph.buttonLabel}
                        className={inputCls}
                      />
                    </Field>

                    {selectedPanel !== 'verification' && (
                      <Field label="Placeholder do modal">
                        <input
                          type="text"
                          value={embed.placeholder}
                          onChange={(e) => setField('placeholder', e.target.value)}
                          disabled={!canEdit}
                          placeholder={ph.placeholder}
                          className={inputCls}
                        />
                      </Field>
                    )}
                  </div>

                  <p className="text-xs text-zinc-500">
                    Deixe em branco para usar os valores padrão do bot.
                  </p>
                </div>
              )
            })()}

            {canEdit && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => savePanelsMutation.mutate()}
                  disabled={savePanelsMutation.isPending || !panelsDirty}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <Save className="w-4 h-4" />
                  {savePanelsMutation.isPending ? 'Salvando...' : 'Salvar embeds'}
                </button>
              </div>
            )}
          </div>

          {/* Presence */}
          {canEdit && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 space-y-4">
              <p className="text-sm font-semibold text-zinc-200">Status e Presença do Bot</p>

              {presenceFeedback && (
                <div className="px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">
                  {presenceFeedback}
                </div>
              )}
              {presenceError && (
                <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                  {presenceError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Status">
                  <select
                    value={presenceStatus}
                    onChange={(e) => setPresenceStatus(e.target.value)}
                    className={selectCls}
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Tipo de atividade">
                  <select
                    value={presenceActivityType}
                    onChange={(e) => setPresenceActivityType(Number(e.target.value))}
                    className={selectCls}
                  >
                    {ACTIVITY_TYPES.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Nome da atividade">
                  <input
                    type="text"
                    value={presenceActivityName}
                    onChange={(e) => setPresenceActivityName(e.target.value)}
                    placeholder="ex: Roleplay City"
                    className={inputCls}
                  />
                </Field>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setPresenceMutation.mutate()}
                  disabled={setPresenceMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <Wifi className="w-4 h-4" />
                  {setPresenceMutation.isPending ? 'Enviando...' : 'Aplicar presença'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
