import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ScrollText, Search } from 'lucide-react'

import { listAuditLog } from '../api/admin'
import type { AuditEntry, SessionResponse } from '../types'

const PAGE_SIZE = 50

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'auth', label: 'Auth' },
  { value: 'authorization', label: 'Autorização' },
  { value: 'users', label: 'Usuários' },
  { value: 'bots', label: 'Bots' },
  { value: 'audit', label: 'Auditoria' },
  { value: 'other', label: 'Outros' },
]

const CAT_STYLE: Record<string, string> = {
  auth: 'bg-amber-500/10 text-amber-400',
  authorization: 'bg-teal-500/10 text-teal-400',
  users: 'bg-violet-500/10 text-violet-400',
  bots: 'bg-blue-500/10 text-blue-400',
  audit: 'bg-zinc-700/40 text-zinc-300',
  other: 'bg-zinc-800 text-zinc-500',
}

function statusStyle(s: number | null): string {
  if (s == null) return 'text-zinc-500'
  if (s >= 500) return 'text-red-400'
  if (s >= 400) return 'text-amber-400'
  return 'text-emerald-400'
}

/** Para a categoria Autorização, o statusCode codifica o estado do captcha. */
function statusDisplay(e: AuditEntry): { label: string; cls: string } {
  if (e.category === 'authorization') {
    if (e.statusCode === 200) return { label: '✓ Autorizado', cls: 'text-emerald-400' }
    if (e.statusCode === 410) return { label: 'Expirado', cls: 'text-amber-400' }
    return { label: 'Pendente', cls: 'text-zinc-500' }
  }
  return { label: e.statusCode == null ? '—' : String(e.statusCode), cls: statusStyle(e.statusCode) }
}

function fmtTime(v: string): string {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleString('pt-BR')
}

interface LogsViewProps {
  session: SessionResponse | null
}

export function LogsView(_props: LogsViewProps) {
  const [category, setCategory] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)

  const query = useQuery({
    queryKey: ['audit', category, q, page],
    queryFn: () => listAuditLog({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, category, q }),
    placeholderData: (prev) => prev,
  })

  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)

  function applySearch(e: FormEvent) {
    e.preventDefault()
    setQ(searchInput)
    setPage(0)
  }

  function pickCategory(c: string) {
    setCategory(c)
    setPage(0)
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <ScrollText className="w-5 h-5 text-zinc-400" />
        <h2 className="text-lg font-semibold text-zinc-100">Logs de acesso</h2>
        <span className="text-xs text-zinc-500">{total} registro(s)</span>
      </div>
      <p className="text-sm text-zinc-500 mb-5">Auditoria de quem acessou o quê — restrito ao CEO.</p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => pickCategory(c.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                category === c.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <form onSubmit={applySearch} className="ml-auto relative">
          <Search className="w-3.5 h-3.5 text-zinc-600 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar rota, email, IP…"
            className="bg-zinc-900 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-zinc-100 placeholder-zinc-600 rounded-lg pl-8 pr-3 py-1.5 text-sm w-56"
          />
        </form>
      </div>

      <div className="border border-zinc-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-zinc-500">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">Quando</th>
              <th className="text-left font-medium px-4 py-2.5">Usuário</th>
              <th className="text-left font-medium px-4 py-2.5 hidden sm:table-cell">Cat.</th>
              <th className="text-left font-medium px-4 py-2.5">Ação</th>
              <th className="text-left font-medium px-4 py-2.5">Status</th>
              <th className="text-left font-medium px-4 py-2.5 hidden md:table-cell">Dur.</th>
              <th className="text-left font-medium px-4 py-2.5 hidden lg:table-cell">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {query.isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-600">Carregando…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-600">Nenhum registro.</td></tr>
            ) : (
              items.map((e) => (
                <tr key={e.id} className="bg-zinc-950 hover:bg-zinc-900/40">
                  <td className="px-4 py-2.5 text-zinc-400 whitespace-nowrap">{fmtTime(e.occurredAt)}</td>
                  <td className="px-4 py-2.5 text-zinc-300 whitespace-nowrap">
                    {e.userEmail ?? <span className="text-zinc-600">anônimo</span>}
                  </td>
                  <td className="px-4 py-2.5 hidden sm:table-cell">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CAT_STYLE[e.category] ?? CAT_STYLE.other}`}>
                      {e.category}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-400">
                    <span className="text-zinc-500">{e.method}</span> {e.path}
                  </td>
                  <td className={`px-4 py-2.5 font-medium whitespace-nowrap ${statusDisplay(e).cls}`}>{statusDisplay(e).label}</td>
                  <td className="px-4 py-2.5 text-zinc-500 hidden md:table-cell">{e.durationMs != null ? `${e.durationMs}ms` : '—'}</td>
                  <td className="px-4 py-2.5 text-zinc-600 font-mono text-xs hidden lg:table-cell">{e.ip ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-zinc-500">Página {page + 1} de {maxPage + 1}</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="px-3 py-1.5 rounded-lg bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page >= maxPage}
              onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
              className="px-3 py-1.5 rounded-lg bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
