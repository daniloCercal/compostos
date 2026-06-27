import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Shield, User, Crown } from 'lucide-react'
import { createUser, deleteUser, listBots, listUsers, updateUser } from '../api/admin'
import { ApiError } from '../api/client'
import type { AdminRole, AdminUser, Bot, SessionResponse } from '../types'

function extractError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'erro inesperado'
}

const ROLE_LABEL: Record<AdminRole, string> = {
  ceo: 'CEO',
  admin: 'Admin',
  user: 'Usuário',
}

const ROLE_ICON: Record<AdminRole, typeof Crown> = {
  ceo: Crown,
  admin: Shield,
  user: User,
}

const ROLE_COLOR: Record<AdminRole, string> = {
  ceo: 'text-amber-400',
  admin: 'text-blue-400',
  user: 'text-zinc-400',
}

interface UserFormState {
  email: string
  displayName: string
  password: string
  role: AdminRole
  botIds: string[]
  isActive: boolean
}

const emptyForm: UserFormState = {
  email: '',
  displayName: '',
  password: '',
  role: 'user',
  botIds: [],
  isActive: true,
}

interface UsersViewProps {
  session: SessionResponse | null
}

export function UsersView({ session }: UsersViewProps) {
  const queryClient = useQueryClient()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<UserFormState>(emptyForm)

  const permissions = session?.permissions
  const myId = session?.user?.id
  const myRole = session?.user?.role

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: listUsers,
  })

  const botsQuery = useQuery({
    queryKey: ['bots'],
    queryFn: listBots,
  })

  const bots: Bot[] = botsQuery.data ?? []
  const users: AdminUser[] = usersQuery.data ?? []

  // Admin can only assign bots from their own list
  const assignableBots = myRole === 'ceo'
    ? bots
    : bots.filter((b) => session?.botIds?.includes(b.id))

  const createMutation = useMutation({
    mutationFn: createUser,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateUser>[1] }) =>
      updateUser(id, input),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
  })

  function openCreate() {
    setForm(emptyForm)
    setFormError(null)
    setShowCreate(true)
  }

  function openEdit(user: AdminUser) {
    setForm({
      email: user.email,
      displayName: user.displayName,
      password: '',
      role: user.role,
      botIds: user.botIds,
      isActive: user.isActive,
    })
    setFormError(null)
    setEditTarget(user)
  }

  function closeModal() {
    setShowCreate(false)
    setEditTarget(null)
    setForm(emptyForm)
    setFormError(null)
  }

  async function submitCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    try {
      await createMutation.mutateAsync({
        email: form.email,
        displayName: form.displayName,
        password: form.password,
        role: form.role,
        botIds: form.botIds,
        isActive: form.isActive,
      })
      setFeedback('Usuário criado com sucesso.')
      closeModal()
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    } catch (error) {
      setFormError(extractError(error))
    }
  }

  async function submitEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editTarget) return
    try {
      await updateMutation.mutateAsync({
        id: editTarget.id,
        input: {
          email: form.email,
          displayName: form.displayName,
          password: form.password || undefined,
          role: form.role,
          botIds: form.botIds,
          isActive: form.isActive,
        },
      })
      setFeedback('Usuário atualizado com sucesso.')
      closeModal()
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    } catch (error) {
      setFormError(extractError(error))
    }
  }

  async function handleDelete(user: AdminUser) {
    try {
      await deleteMutation.mutateAsync(user.id)
      setDeleteTarget(null)
      setFeedback('Usuário removido com sucesso.')
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    } catch (error) {
      setFeedback(extractError(error))
    }
  }

  function toggleBotId(botId: string) {
    setForm((prev) => ({
      ...prev,
      botIds: prev.botIds.includes(botId)
        ? prev.botIds.filter((id) => id !== botId)
        : [...prev.botIds, botId],
    }))
  }

  const isFormSubmitting = createMutation.isPending || updateMutation.isPending
  const showModal = showCreate || editTarget !== null
  const modalTitle = editTarget ? 'Editar usuário' : 'Novo usuário'
  const handleSubmit = editTarget ? submitEdit : submitCreate

  // Role options visible to current user
  const roleOptions: AdminRole[] = myRole === 'ceo'
    ? ['admin', 'user']
    : ['admin', 'user']

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
            Controle de acesso
          </p>
          <h2 className="text-lg font-semibold text-zinc-100">Usuários</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Gerencie contas e permissões de acesso ao painel.
          </p>
        </div>
        {permissions?.canManageUsers && (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            Novo usuário
          </button>
        )}
      </div>

      {feedback && (
        <div className="px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">
          {feedback}
        </div>
      )}

      {/* Users table */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        {usersQuery.isLoading ? (
          <div className="p-8 text-center text-sm text-zinc-500">Carregando usuários...</div>
        ) : usersQuery.isError ? (
          <div className="p-8 text-center text-sm text-red-400">{extractError(usersQuery.error)}</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">Nenhum usuário encontrado.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-4 py-3">Usuário</th>
                <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-4 py-3">Role</th>
                <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-4 py-3 hidden md:table-cell">Bots</th>
                <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {users.map((user) => {
                const RoleIcon = ROLE_ICON[user.role]
                const isSelf = user.id === myId
                return (
                  <tr key={user.id} className={`${isSelf ? 'bg-zinc-800/20' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                          <span className="text-xs font-semibold text-zinc-300">
                            {user.displayName.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-zinc-100">
                            {user.displayName}
                            {isSelf && <span className="ml-2 text-xs text-zinc-500">(você)</span>}
                          </p>
                          <p className="text-xs text-zinc-500">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1.5 text-xs font-medium ${ROLE_COLOR[user.role]}`}>
                        <RoleIcon className="w-3.5 h-3.5" />
                        {ROLE_LABEL[user.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {user.scope === 'all' ? (
                        <span className="text-xs text-zinc-400">Todos</span>
                      ) : user.botIds.length === 0 ? (
                        <span className="text-xs text-zinc-600">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {user.botIds.map((id) => {
                            const bot = bots.find((b) => b.id === id)
                            return (
                              <span key={id} className="px-1.5 py-0.5 rounded text-xs bg-zinc-800 text-zinc-300">
                                {bot?.name ?? id.slice(0, 8)}
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium ${user.isActive ? 'text-emerald-400' : 'text-zinc-500'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${user.isActive ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
                        {user.isActive ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {!isSelf && permissions?.canManageUsers && (
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            type="button"
                            onClick={() => openEdit(user)}
                            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                            title="Editar"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(user)}
                            className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Excluir"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={closeModal}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-100">{modalTitle}</h3>
              <button
                type="button"
                onClick={closeModal}
                className="text-zinc-500 hover:text-zinc-300 transition-colors text-xs"
              >
                Fechar
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Nome</label>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value }))}
                  required
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm"
                  placeholder="Nome de exibição"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  required
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm"
                  placeholder="email@exemplo.com"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Senha {editTarget ? '(deixe em branco para manter)' : ''}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                  required={!editTarget}
                  autoComplete="new-password"
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm"
                  placeholder="••••••••"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Role</label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm((p) => ({ ...p, role: e.target.value as AdminRole }))}
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-zinc-100 rounded-lg px-3 py-2 text-sm"
                  >
                    {roleOptions.map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Status</label>
                  <select
                    value={form.isActive ? 'active' : 'inactive'}
                    onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.value === 'active' }))}
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-zinc-100 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="active">Ativo</option>
                    <option value="inactive">Inativo</option>
                  </select>
                </div>
              </div>

              {assignableBots.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-2">
                    Bots permitidos
                  </label>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {assignableBots.map((bot) => (
                      <label key={bot.id} className="flex items-center gap-2.5 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={form.botIds.includes(bot.id)}
                          onChange={() => toggleBotId(bot.id)}
                          className="w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-blue-500 focus:ring-blue-500/30"
                        />
                        <span className="text-sm text-zinc-300 group-hover:text-zinc-100 transition-colors">
                          {bot.name}
                        </span>
                        {bot.isActive && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {formError && (
                <div className="px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                  {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isFormSubmitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {isFormSubmitting ? 'Salvando...' : editTarget ? 'Salvar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-sm shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-zinc-100 mb-1">Excluir usuário</h3>
            <p className="text-sm text-zinc-400 mb-1">
              Confirma a exclusão de <strong className="text-zinc-200">{deleteTarget.displayName}</strong>?
            </p>
            <p className="text-xs text-zinc-600 mb-5">Esta ação não pode ser desfeita.</p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(deleteTarget)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {deleteMutation.isPending ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
