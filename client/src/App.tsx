import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Activity, LogOut, Menu, X, Users, ClipboardList, Megaphone, Ticket, Settings, ScrollText, KeyRound } from 'lucide-react'

import { ensureCsrfToken, getAdminSession, listBots, loginAdmin, logoutAdmin } from './api/admin'
import { ApiError, clearCsrfToken } from './api/client'
import { LoginPanel } from './components/LoginPanel'
import { BotsView } from './views/BotsView'
import { StatusView } from './views/StatusView'
import { UsersView } from './views/UsersView'
import { WhitelistView } from './views/WhitelistView'
import { BotConfigView } from './views/BotConfigView'
import { AnnouncementsView } from './views/AnnouncementsView'
import { TicketManagerView } from './views/TicketManagerView'
import { LogsView } from './views/LogsView'
import { DiscordLoginView } from './views/DiscordLoginView'
import type { SessionResponse } from './types'

function extractError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'erro inesperado'
}

type ActiveView = 'bots' | 'status' | 'users' | 'whitelist' | 'config' | 'announcements' | 'tickets' | 'logs' | 'discord-login'

const ROLE_LABEL: Record<string, string> = {
  ceo: 'CEO',
  admin: 'Admin',
  user: 'Usuário',
}

// ─── Shared auth hook ────────────────────────────────────────────────────────

function useAuth() {
  const queryClient = useQueryClient()

  const sessionQuery = useQuery({
    queryKey: ['admin-session'],
    queryFn: getAdminSession,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Ping every 15 min so Lucia refreshes the cookie before it expires.
    refetchInterval: 15 * 60 * 1000,
    // Retry transient server errors before giving up.
    retry: 3,
  })
  // Use === true so that undefined / loading / error never counts as "authenticated".
  const isAuthenticated = sessionQuery.data?.authenticated === true

  useQuery({
    queryKey: ['csrf-token'],
    queryFn: ensureCsrfToken,
    enabled: isAuthenticated,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      loginAdmin(email, password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-session'] })
      await queryClient.invalidateQueries({ queryKey: ['csrf-token'] })
    },
  })

  const logoutMutation = useMutation({
    mutationFn: logoutAdmin,
    onSuccess: async () => {
      clearCsrfToken()
      await queryClient.invalidateQueries({ queryKey: ['admin-session'] })
      await queryClient.resetQueries({ queryKey: ['bots'] })
      await queryClient.resetQueries({ queryKey: ['bot-logs'] })
      await queryClient.resetQueries({ queryKey: ['bot-status'] })
    },
  })

  return { sessionQuery, isAuthenticated, loginMutation, logoutMutation }
}

// ─── Modern layout (Tailwind) ────────────────────────────────────────────────

interface ShellProps {
  session: SessionResponse | null
  onLogout: () => void
  isLoggingOut: boolean
}

function ModernShell({ session, onLogout, isLoggingOut }: ShellProps) {
  const [activeView, setActiveView] = useState<ActiveView>('bots')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const user = session?.user
  const permissions = session?.permissions

  // Branding: um usuário não-CEO com acesso a UM único bot vê o nome + logo
  // desse bot no lugar da marca padrão "zKazuh".
  const botsQuery = useQuery({
    queryKey: ['bots'],
    queryFn: listBots,
    enabled: Boolean(permissions?.canViewBots),
  })
  const accessibleBots = botsQuery.data ?? []
  const brandBot = user?.role !== 'ceo' && accessibleBots.length === 1 ? accessibleBots[0] : null
  const brandName = brandBot ? brandBot.name : 'zKazuh'

  const ALL_NAV_ITEMS: { view: ActiveView; icon: typeof Bot; label: string; sub: string; visible: boolean }[] = [
    { view: 'bots', icon: Bot, label: 'Bots', sub: 'Gerenciar bots', visible: Boolean(permissions?.canViewBots) },
    { view: 'status', icon: Activity, label: 'Status', sub: 'Monitorar runtime', visible: Boolean(permissions?.canViewBots) },
    { view: 'whitelist', icon: ClipboardList, label: 'Whitelist', sub: 'Perguntas e respostas', visible: Boolean(permissions?.canViewBots) },
    { view: 'config', icon: Settings, label: 'Configurações', sub: 'Visual e presença', visible: Boolean(permissions?.canUpdateBots) },
    { view: 'announcements', icon: Megaphone, label: 'Avisos', sub: 'Enviar comunicados', visible: Boolean(permissions?.canUpdateBots) },
    { view: 'tickets', icon: Ticket, label: 'Tickets', sub: 'Gerenciar suporte', visible: Boolean(permissions?.canViewBots) },
    { view: 'users', icon: Users, label: 'Usuários', sub: 'Controle de acesso', visible: Boolean(permissions?.canManageUsers) },
    { view: 'logs', icon: ScrollText, label: 'Logs', sub: 'Auditoria de acesso', visible: user?.role === 'ceo' },
    { view: 'discord-login', icon: KeyRound, label: 'Login Discord', sub: 'Acesso via Discord', visible: Boolean(permissions?.canManageUsers) },
  ]

  const NAV_ITEMS = ALL_NAV_ITEMS.filter((n) => n.visible)

  useEffect(() => {
    if (!sidebarOpen) return undefined
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarOpen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [sidebarOpen])

  useEffect(() => {
    const handler = () => { if (window.innerWidth >= 1024) setSidebarOpen(false) }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  function navigate(view: ActiveView) {
    setActiveView(view)
    setSidebarOpen(false)
  }

  return (
    <div className="flex h-screen bg-zinc-950 overflow-hidden">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-40 flex flex-col w-60
          bg-zinc-900 border-r border-zinc-800
          transition-transform duration-200 ease-in-out
          lg:static lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex items-center gap-3 px-5 py-5 border-b border-zinc-800">
          <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center shadow-md shadow-blue-600/30 shrink-0 bg-blue-600">
            {brandBot && brandBot.image ? (
              <img src={brandBot.image} alt="" className="w-full h-full object-cover" />
            ) : (
              <Bot className="w-4 h-4 text-white" />
            )}
          </div>
          <span className="font-semibold text-zinc-100 text-sm truncate">{brandName}</span>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="ml-auto text-zinc-500 hover:text-zinc-300 lg:hidden transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          <p className="text-xs font-medium text-zinc-600 uppercase tracking-wider px-2 mb-2">
            Módulos
          </p>
          {NAV_ITEMS.map(({ view, icon: Icon, label, sub }) => (
            <button
              key={view}
              type="button"
              onClick={() => navigate(view)}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors
                ${activeView === view
                  ? 'bg-blue-600/15 text-blue-400'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                }
              `}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <div>
                <p className="text-sm font-medium leading-none">{label}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>
              </div>
            </button>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-zinc-800 space-y-3">
          {user && (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                <span className="text-xs font-semibold text-zinc-300">
                  {user.displayName.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-200 truncate">{user.displayName}</p>
                <p className="text-xs text-zinc-500 truncate">{ROLE_LABEL[user.role] ?? user.role}</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={onLogout}
            disabled={isLoggingOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors text-sm disabled:opacity-50"
          >
            <LogOut className="w-4 h-4" />
            {isLoggingOut ? 'Saindo...' : 'Sair'}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="flex items-center gap-4 px-6 h-14 border-b border-zinc-800 bg-zinc-950 shrink-0">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="text-zinc-400 hover:text-zinc-100 transition-colors lg:hidden"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div>
            <p className="text-xs text-zinc-500 leading-none">
              {ALL_NAV_ITEMS.find((n) => n.view === activeView)?.sub}
            </p>
            <h1 className="text-sm font-semibold text-zinc-100 mt-0.5">
              {ALL_NAV_ITEMS.find((n) => n.view === activeView)?.label}
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-800 text-xs text-zinc-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot" />
              {user?.displayName ?? 'Sessão ativa'}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {activeView === 'bots' ? <BotsView session={session} /> : null}
          {activeView === 'status' ? <StatusView /> : null}
          {activeView === 'users' ? <UsersView session={session} /> : null}
          {activeView === 'whitelist' ? <WhitelistView session={session} /> : null}
          {activeView === 'config' ? <BotConfigView session={session} /> : null}
          {activeView === 'announcements' ? <AnnouncementsView session={session} /> : null}
          {activeView === 'tickets' ? <TicketManagerView session={session} /> : null}
          {activeView === 'logs' ? <LogsView session={session} /> : null}
          {activeView === 'discord-login' ? <DiscordLoginView session={session} /> : null}
        </main>
      </div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

function App() {
  const { sessionQuery, isAuthenticated, loginMutation, logoutMutation } = useAuth()

  // 1. First fetch — no data yet.
  if (sessionQuery.isPending) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-zinc-400 text-sm">Carregando sessão...</p>
        </div>
      </div>
    )
  }

  // 2. Server error (5xx / network) and no stale data to fall back on.
  //    Do NOT show the login screen — the user may still be authenticated.
  //    Show a retry button instead.
  if (sessionQuery.isError && !sessionQuery.data) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-zinc-300 text-sm font-medium">Não foi possível verificar a sessão.</p>
          <p className="text-zinc-500 text-xs">{extractError(sessionQuery.error)}</p>
          <button
            type="button"
            onClick={() => void sessionQuery.refetch()}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  // 3. Server confirmed not authenticated (positive { authenticated: false } response).
  if (!isAuthenticated) {
    return (
      <LoginPanel
        isSubmitting={loginMutation.isPending}
        onSubmit={async (credentials) => { await loginMutation.mutateAsync(credentials) }}
        errorMessage={loginMutation.isError ? extractError(loginMutation.error) : null}
      />
    )
  }

  const session = (sessionQuery.data ?? null) as SessionResponse | null

  return (
    <ModernShell
      session={session}
      onLogout={() => logoutMutation.mutate()}
      isLoggingOut={logoutMutation.isPending}
    />
  )
}

export default App
