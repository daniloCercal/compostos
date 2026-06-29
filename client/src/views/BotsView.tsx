import { useState, useRef, type FormEvent, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Pencil,
  Trash2,
  Power,
  PowerOff,
  RotateCcw,
  ScrollText,
  X,
  Bot,
  Upload,
  ChevronRight,
} from 'lucide-react'
import { z } from 'zod'

import { createBot, deleteBot, listBotLogs, listBots, restartBot, saveBotImage, updateBot, updateBotIdentity } from '../api/admin'
import { ApiError } from '../api/client'
import type { Bot as BotType, BotInput, BotLogEntry, SessionResponse } from '../types'

const DEFAULT_COMMANDS_TEXT = JSON.stringify([{ name: 'ping', response: 'Pong!' }], null, 2)

const botCommandSchema = z.object({
  name: z.string().trim().min(1, 'Comando precisa de um nome.'),
  response: z.string().trim().min(1, 'Comando precisa de resposta.'),
})

const botFormSchema = z.object({
  name: z.string().trim().min(1, 'Nome do bot é obrigatório.'),
  token: z.string(),
  commandsText: z.string().trim().min(1, 'Informe o JSON de comandos.'),
  isActive: z.boolean(),
})

type EditorMode = 'create' | 'edit'

interface BotFormState {
  name: string
  token: string
  commandsText: string
  isActive: boolean
}

interface EditorState {
  mode: EditorMode
  botId: string | null
}

const emptyFormState: BotFormState = {
  name: '',
  token: '',
  commandsText: DEFAULT_COMMANDS_TEXT,
  isActive: false,
}

function extractError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'erro inesperado'
}

function formatDateTime(value: string): string {
  if (!value) return '--'
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return new Date(parsed).toLocaleString('pt-BR')
}

function buildPayload(form: BotFormState): { payload?: BotInput; error?: string } {
  const parsed = botFormSchema.safeParse(form)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Formulário inválido.' }
  }

  let commandsRaw: unknown
  try {
    commandsRaw = JSON.parse(parsed.data.commandsText)
  } catch {
    return { error: 'Comandos precisa ser um JSON válido.' }
  }

  const commandsResult = z.array(botCommandSchema).safeParse(commandsRaw)
  if (!commandsResult.success) {
    return { error: commandsResult.error.issues[0]?.message ?? 'Comandos inválidos.' }
  }

  return {
    payload: {
      name: parsed.data.name.trim(),
      token: parsed.data.token.trim() || undefined,
      commands: commandsResult.data,
      isActive: parsed.data.isActive,
    },
  }
}

/** Reduz/recorta a imagem para 256x256 PNG (data URI) — mantém o payload leve. */
function resizeToDataUri(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Arquivo de imagem inválido.'))
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas indisponível.'))
          return
        }
        const min = Math.min(img.width, img.height)
        ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, size, size)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

function BotAvatarCell({ bot }: { bot: BotType }) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const saveImageMutation = useMutation({
    mutationFn: (dataUri: string) => saveBotImage(bot.id, dataUri),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['bots'] })
    },
    onError: (err) => setError(extractError(err)),
  })

  const applyAvatarMutation = useMutation({
    mutationFn: () => updateBotIdentity(bot.id, { avatarDataUri: bot.image }),
    onError: (err) => setError(extractError(err)),
  })

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const dataUri = await resizeToDataUri(file)
      saveImageMutation.mutate(dataUri)
    } catch (err) {
      setError(extractError(err))
    }
  }

  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={saveImageMutation.isPending}
        title="Trocar imagem do bot"
        className="relative w-8 h-8 rounded-lg overflow-hidden bg-zinc-800 flex items-center justify-center shrink-0 group disabled:opacity-60"
      >
        {bot.image ? (
          <img src={bot.image} alt="" className="w-full h-full object-cover" />
        ) : (
          <Bot className="w-3.5 h-3.5 text-zinc-400" />
        )}
        <span className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
          <Upload className="w-3.5 h-3.5 text-white" />
        </span>
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      <div className="min-w-0">
        <p className="font-medium text-zinc-200 truncate">{bot.name}</p>
        <div className="flex items-center gap-2">
          <p className="text-xs text-zinc-600 font-mono">{bot.id.slice(0, 8)}…</p>
          {bot.image ? (
            <button
              type="button"
              onClick={() => applyAvatarMutation.mutate()}
              disabled={applyAvatarMutation.isPending}
              className="text-xs text-zinc-500 hover:text-blue-400 disabled:opacity-50 transition-colors"
              title="Aplicar esta imagem como avatar do bot no Discord"
            >
              {applyAvatarMutation.isPending ? 'aplicando…' : applyAvatarMutation.isSuccess ? '✓ no Discord' : '→ aplicar no Discord'}
            </button>
          ) : null}
        </div>
        {error ? <p className="text-xs text-red-400 mt-0.5">{error}</p> : null}
      </div>
    </div>
  )
}

interface BotsViewProps {
  session: SessionResponse | null
}

export function BotsView({ session }: BotsViewProps) {
  const queryClient = useQueryClient()
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [editorState, setEditorState] = useState<EditorState | null>(null)
  const [form, setForm] = useState<BotFormState>(emptyFormState)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BotType | null>(null)
  const [logsTarget, setLogsTarget] = useState<BotType | null>(null)

  const botsQuery = useQuery({ queryKey: ['bots'], queryFn: listBots })

  const botLogsQuery = useQuery({
    queryKey: ['bot-logs', logsTarget?.id ?? 'none'],
    queryFn: () => {
      if (!logsTarget?.id) return Promise.resolve([] as BotLogEntry[])
      return listBotLogs(logsTarget.id)
    },
    enabled: Boolean(logsTarget?.id),
  })

  const createBotMutation = useMutation({ mutationFn: createBot })
  const updateBotMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: BotInput }) => updateBot(id, payload),
  })
  const deleteBotMutation = useMutation({ mutationFn: deleteBot })
  const restartBotMutation = useMutation({ mutationFn: restartBot })

  const bots = botsQuery.data ?? []
  const logs = botLogsQuery.data ?? []
  const isFormSubmitting = createBotMutation.isPending || updateBotMutation.isPending
  const permissions = session?.permissions
  const canCreateBots = Boolean(permissions?.canCreateBots)
  const canUpdateBots = Boolean(permissions?.canUpdateBots)
  const canDeleteBots = Boolean(permissions?.canDeleteBots)
  const canSubmitEditor = editorState?.mode === 'edit' ? canUpdateBots : canCreateBots

  function showFeedback(type: 'success' | 'error', text: string) {
    setFeedback({ type, text })
    setTimeout(() => setFeedback(null), 4000)
  }

  function openCreateModal() {
    setEditorState({ mode: 'create', botId: null })
    setForm(emptyFormState)
    setFormError(null)
  }

  function openEditModal(bot: BotType) {
    setEditorState({ mode: 'edit', botId: bot.id })
    setForm({
      name: bot.name,
      token: '',
      commandsText: JSON.stringify(bot.commands, null, 2),
      isActive: bot.isActive,
    })
    setFormError(null)
  }

  function closeEditorModal() {
    setEditorState(null)
    setForm(emptyFormState)
    setFormError(null)
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editorState) return

    const payloadResult = buildPayload(form)
    if (!payloadResult.payload) {
      setFormError(payloadResult.error ?? 'Erro ao validar formulário.')
      return
    }

    try {
      if (editorState.mode === 'edit' && editorState.botId) {
        await updateBotMutation.mutateAsync({ id: editorState.botId, payload: payloadResult.payload })
        showFeedback('success', 'Bot atualizado com sucesso.')
      } else {
        await createBotMutation.mutateAsync(payloadResult.payload)
        showFeedback('success', 'Bot criado com sucesso.')
      }
      closeEditorModal()
      await queryClient.invalidateQueries({ queryKey: ['bots'] })
    } catch (error) {
      setFormError(extractError(error))
    }
  }

  async function handleToggle(bot: BotType) {
    try {
      await updateBotMutation.mutateAsync({
        id: bot.id,
        payload: { name: bot.name, commands: bot.commands, isActive: !bot.isActive },
      })
      showFeedback('success', bot.isActive ? 'Bot desligado.' : 'Bot ligado.')
      await queryClient.invalidateQueries({ queryKey: ['bots'] })
    } catch (error) {
      showFeedback('error', extractError(error))
    }
  }

  async function handleDelete(bot: BotType) {
    try {
      await deleteBotMutation.mutateAsync(bot.id)
      setDeleteTarget(null)
      if (logsTarget?.id === bot.id) setLogsTarget(null)
      showFeedback('success', 'Bot removido.')
      await queryClient.invalidateQueries({ queryKey: ['bots'] })
      await queryClient.removeQueries({ queryKey: ['bot-logs', bot.id], exact: true })
    } catch (error) {
      showFeedback('error', extractError(error))
    }
  }

  async function handleRestart(bot: BotType) {
    try {
      await restartBotMutation.mutateAsync(bot.id)
      showFeedback('success', `Reinício solicitado para ${bot.name}.`)
      await queryClient.invalidateQueries({ queryKey: ['bots'] })
      await queryClient.invalidateQueries({ queryKey: ['bot-status'] })
    } catch (error) {
      showFeedback('error', extractError(error))
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-500 mb-0.5">Bot Registry</p>
          <h2 className="text-base font-semibold text-zinc-100">Bots cadastrados</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 text-xs text-zinc-400">
            <Bot className="w-3.5 h-3.5" />
            <span>{bots.length} bots</span>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            disabled={!canCreateBots}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Novo bot</span>
          </button>
        </div>
      </div>

      {/* Feedback toast */}
      {feedback ? (
        <div
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/10 border border-red-500/20 text-red-400'
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      {/* Table */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        {botsQuery.isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : botsQuery.isError ? (
          <div className="px-6 py-10 text-center text-sm text-red-400">
            {extractError(botsQuery.error)}
          </div>
        ) : bots.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Bot className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
            <p className="text-sm text-zinc-500">Nenhum bot cadastrado.</p>
            {canCreateBots && (
              <button
                type="button"
                onClick={openCreateModal}
                className="mt-3 text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                Criar o primeiro bot
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Nome</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider hidden sm:table-cell">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider hidden md:table-cell">Comandos</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider hidden lg:table-cell">Atualizado</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {bots.map((bot) => (
                <tr key={bot.id} className="bg-zinc-950 hover:bg-zinc-900/40 transition-colors">
                  <td className="px-4 py-3">
                    <BotAvatarCell bot={bot} />
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                        bot.isActive
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          bot.isActive ? 'bg-emerald-500 animate-pulse-dot' : 'bg-zinc-600'
                        }`}
                      />
                      {bot.isActive ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-zinc-400">{bot.commands.length}</span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-zinc-500 text-xs">
                    {formatDateTime(bot.updatedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        title={bot.isActive ? 'Desligar' : 'Ligar'}
                        onClick={() => void handleToggle(bot)}
                        disabled={!canUpdateBots || updateBotMutation.isPending}
                        className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {bot.isActive ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                      </button>
                      <button
                        type="button"
                        title="Reiniciar"
                        onClick={() => void handleRestart(bot)}
                        disabled={!canUpdateBots || !bot.isActive || restartBotMutation.isPending}
                        className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        title="Logs"
                        onClick={() => setLogsTarget(bot)}
                        className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                      >
                        <ScrollText className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        title="Editar"
                        onClick={() => openEditModal(bot)}
                        disabled={!canUpdateBots}
                        className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        title="Excluir"
                        onClick={() => setDeleteTarget(bot)}
                        disabled={!canDeleteBots}
                        className="p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Editor Modal */}
      {editorState ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          onClick={closeEditorModal}
        >
          <div
            className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <h3 className="font-semibold text-zinc-100">
                {editorState.mode === 'edit' ? 'Editar bot' : 'Novo bot'}
              </h3>
              <button
                type="button"
                onClick={closeEditorModal}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form className="px-6 py-5 space-y-4" onSubmit={submitForm}>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Nome do bot</label>
                <input
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm transition-colors"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  disabled={!canSubmitEditor}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Token do bot</label>
                <input
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm font-mono transition-colors"
                  type="password"
                  value={form.token}
                  onChange={(e) => setForm((p) => ({ ...p, token: e.target.value }))}
                  autoComplete="off"
                  disabled={!canUpdateBots}
                  placeholder={
                    editorState.mode === 'edit' ? 'Deixe em branco para manter o token atual' : 'Token do Discord'
                  }
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Comandos (JSON)</label>
                <textarea
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm font-mono transition-colors resize-y"
                  rows={6}
                  value={form.commandsText}
                  onChange={(e) => setForm((p) => ({ ...p, commandsText: e.target.value }))}
                  spellCheck={false}
                  disabled={!canUpdateBots}
                  required
                />
                <p className="text-xs text-zinc-600 mt-1">
                  Ex: {'[{"name": "ping", "response": "Pong!"}]'}
                </p>
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
                  disabled={!canUpdateBots}
                  className="w-4 h-4 rounded accent-blue-600"
                />
                <span className="text-sm text-zinc-300">Ativar bot</span>
              </label>

              {formError ? (
                <div className="px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {formError}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeEditorModal}
                  className="px-4 py-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 text-sm transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!canSubmitEditor || isFormSubmitting}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                >
                  {isFormSubmitting ? 'Salvando...' : editorState.mode === 'edit' ? 'Salvar' : 'Criar bot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Delete Modal */}
      {deleteTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="font-semibold text-zinc-100 mb-1">Excluir bot</h3>
              <p className="text-sm text-zinc-400">
                Confirma a exclusão de <span className="font-medium text-zinc-200">{deleteTarget.name}</span>?
                Esta ação não pode ser desfeita.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 text-sm transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(deleteTarget)}
                disabled={deleteBotMutation.isPending}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {deleteBotMutation.isPending ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Logs Modal */}
      {logsTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          onClick={() => setLogsTarget(null)}
        >
          <div
            className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl flex flex-col max-h-[80vh]"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
              <div className="flex items-center gap-2">
                <ScrollText className="w-4 h-4 text-zinc-400" />
                <h3 className="font-semibold text-zinc-100">Logs de {logsTarget.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setLogsTarget(null)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {botLogsQuery.isLoading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : botLogsQuery.isError ? (
                <div className="px-6 py-8 text-center text-sm text-red-400">
                  {extractError(botLogsQuery.error)}
                </div>
              ) : logs.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-zinc-500">
                  Sem logs recentes.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Horário</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Evento</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Detalhes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {logs.map((entry) => (
                      <tr key={entry.id} className="hover:bg-zinc-800/30">
                        <td className="px-4 py-2.5 text-zinc-500 text-xs whitespace-nowrap">
                          {formatDateTime(entry.timestamp)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-300">
                            <ChevronRight className="w-3 h-3 text-zinc-600" />
                            {entry.eventType}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-zinc-500 text-xs font-mono max-w-xs truncate">
                          {entry.details || '--'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
