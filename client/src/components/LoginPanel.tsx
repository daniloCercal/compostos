import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye, EyeOff, Bot, Zap, Shield, BarChart3 } from 'lucide-react'

import { getDiscordLoginStatus } from '../api/admin'

const DISCORD_ERRORS: Record<string, string> = {
  disabled: 'Login com Discord está desabilitado.',
  state: 'Sessão de login expirou. Tente novamente.',
  config: 'Login com Discord não está configurado.',
  token: 'Falha ao autenticar no Discord.',
  user: 'Não foi possível obter seu perfil do Discord.',
  no_mappings: 'Nenhum cargo foi mapeado para acesso ainda.',
  no_bot: 'Bot indisponível para verificar seus cargos.',
  no_access: 'Você não tem um cargo autorizado para acessar o painel.',
}

interface LoginPanelProps {
  isSubmitting: boolean
  onSubmit: (credentials: { email: string; password: string }) => Promise<void>
  errorMessage: string | null
}

const features = [
  {
    icon: Bot,
    title: 'Gerenciamento',
    description: 'Cadastre, edite e controle todos os seus bots em um único lugar.',
  },
  {
    icon: BarChart3,
    title: 'Monitoramento',
    description: 'Acompanhe o status de cada bot em tempo real com heartbeat automático.',
  },
  {
    icon: Zap,
    title: 'Comandos',
    description: 'Configure respostas e comandos personalizados sem sair do painel.',
  },
  {
    icon: Shield,
    title: 'Controle de acesso',
    description: 'Hierarquia de roles com permissões granulares por bot.',
  },
]

export function LoginPanel({ isSubmitting, onSubmit, errorMessage }: LoginPanelProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const discordStatus = useQuery({
    queryKey: ['discord-login-status'],
    queryFn: getDiscordLoginStatus,
    retry: false,
    staleTime: 60_000,
  })
  const discordEnabled = discordStatus.data?.enabled === true
  const discordError = new URLSearchParams(window.location.search).get('discord_error')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await onSubmit({ email: email.trim(), password })
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex">
      {/* Left — hero */}
      <div className="hidden lg:flex flex-col justify-between w-[480px] shrink-0 bg-zinc-900 border-r border-zinc-800 px-10 py-12">
        <div>
          <div className="flex items-center gap-3 mb-12">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/30">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-semibold text-zinc-100">zKazuh</span>
          </div>

          <h1 className="text-3xl font-bold text-zinc-100 leading-snug mb-3">
            Painel de<br />administração
          </h1>
          <p className="text-zinc-400 text-sm leading-relaxed mb-10">
            Gerencie seus bots do Discord de forma segura e centralizada.
          </p>

          <div className="space-y-4">
            {features.map(({ icon: Icon, title, description }) => (
              <div key={title} className="flex gap-4">
                <div className="mt-0.5 w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-200">{title}</p>
                  <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-zinc-600">
          Acesso restrito a administradores autorizados.
        </p>
      </div>

      {/* Right — form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-zinc-100">zKazuh</span>
          </div>

          <h2 className="text-xl font-semibold text-zinc-100 mb-1">Entrar no painel</h2>
          <p className="text-sm text-zinc-400 mb-8">Use sua conta administrativa.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
                placeholder="admin@exemplo.com"
                className="w-full bg-zinc-900 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Senha
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  className="w-full bg-zinc-900 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2.5 pr-10 text-sm transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {errorMessage ? (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
                <span className="text-red-400 text-sm">{errorMessage}</span>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2.5 text-sm transition-colors mt-2"
            >
              {isSubmitting ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          {discordError ? (
            <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <span className="text-amber-400 text-sm">{DISCORD_ERRORS[discordError] ?? 'Falha no login com Discord.'}</span>
            </div>
          ) : null}

          {discordEnabled ? (
            <>
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-zinc-800" />
                <span className="text-xs text-zinc-600">ou</span>
                <div className="flex-1 h-px bg-zinc-800" />
              </div>
              <a
                href="/api/admin/auth/discord"
                className="w-full flex items-center justify-center gap-2 bg-[#5865F2] hover:bg-[#4752c4] text-white font-medium rounded-lg py-2.5 text-sm transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.197.373.291a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
                Entrar com Discord
              </a>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
