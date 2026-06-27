import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, Bot, Zap, Shield, BarChart3 } from 'lucide-react'

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
        </div>
      </div>
    </div>
  )
}
