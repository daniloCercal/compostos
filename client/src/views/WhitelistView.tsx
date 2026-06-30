import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, GripVertical, Save, CheckCircle, Clock, XCircle, RefreshCw, FileText, Inbox } from 'lucide-react'
import { listBots, listWhitelistQuestions, saveWhitelistQuestions, listWhitelistApplications } from '../api/admin'
import { ApiError } from '../api/client'
import type { SessionResponse, WhitelistQuestion, WhitelistApplication, WhitelistApplicationStatus } from '../types'

function extractError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'erro inesperado'
}

interface QuestionDraft {
  tempId: string
  fieldKey: string
  questionText: string
  correctAnswer: string
  questionType: 'open' | 'quiz'
  options: string[]
  correctIndex: number
}

function toDraft(q: WhitelistQuestion): QuestionDraft {
  return {
    tempId: q.id,
    fieldKey: q.fieldKey,
    questionText: q.questionText,
    correctAnswer: q.correctAnswer,
    questionType: q.questionType === 'quiz' ? 'quiz' : 'open',
    options: q.options ?? [],
    correctIndex: q.correctIndex ?? 0,
  }
}

function newDraft(): QuestionDraft {
  return {
    tempId: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    fieldKey: '',
    questionText: '',
    correctAnswer: '',
    questionType: 'open',
    options: ['', '', '', ''],
    correctIndex: 0,
  }
}

interface WhitelistViewProps {
  session: SessionResponse | null
}

export function WhitelistView({ session }: WhitelistViewProps) {
  const queryClient = useQueryClient()
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<QuestionDraft[] | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [grabEnabled, setGrabEnabled] = useState(false)
  const [tab, setTab] = useState<'questions' | 'applications'>('questions')

  const permissions = session?.permissions
  const canEdit = Boolean(permissions?.canUpdateBots)

  const botsQuery = useQuery({ queryKey: ['bots'], queryFn: listBots })
  const bots = botsQuery.data ?? []
  const sessionBotIds = session?.botIds ?? []
  const visibleBots = session?.user?.scope === 'all'
    ? bots
    : bots.filter((b) => sessionBotIds.includes(b.id))

  const questionsQuery = useQuery({
    queryKey: ['whitelist-questions', selectedBotId ?? 'none'],
    queryFn: () => selectedBotId ? listWhitelistQuestions(selectedBotId) : Promise.resolve([]),
    enabled: Boolean(selectedBotId),
  })

  const serverQuestions = questionsQuery.data ?? []
  const activeDrafts: QuestionDraft[] = drafts ?? serverQuestions.map(toDraft)

  const applicationsQuery = useQuery({
    queryKey: ['whitelist-applications', selectedBotId ?? 'none'],
    queryFn: () => selectedBotId ? listWhitelistApplications(selectedBotId) : Promise.resolve([]),
    enabled: Boolean(selectedBotId) && tab === 'applications',
  })
  const applications = applicationsQuery.data ?? []

  const saveMutation = useMutation({
    mutationFn: ({ botId, qs }: { botId: string; qs: QuestionDraft[] }) =>
      saveWhitelistQuestions(
        botId,
        qs.map((q, i) => ({
          fieldKey: q.fieldKey,
          questionText: q.questionText,
          correctAnswer: q.correctAnswer,
          orderIndex: i,
          questionType: q.questionType,
          options: q.questionType === 'quiz' ? q.options.filter((o) => o.trim()) : [],
          correctIndex: q.correctIndex,
        })),
      ),
    onSuccess: (saved) => {
      setDrafts(saved.map(toDraft))
      setFeedback('Perguntas salvas com sucesso.')
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['whitelist-questions', selectedBotId] })
    },
    onError: (err) => {
      setError(extractError(err))
    },
  })

  function handleSelectBot(botId: string) {
    setSelectedBotId(botId)
    setDrafts(null)
    setFeedback(null)
    setError(null)
  }

  function addQuestion() {
    setDrafts([...activeDrafts, newDraft()])
  }

  function removeQuestion(tempId: string) {
    setDrafts(activeDrafts.filter((q) => q.tempId !== tempId))
  }

  function updateDraft<K extends keyof QuestionDraft>(tempId: string, field: K, value: QuestionDraft[K]) {
    setDrafts(activeDrafts.map((q) => q.tempId === tempId ? { ...q, [field]: value } : q))
  }

  function updateOption(tempId: string, optIdx: number, value: string) {
    setDrafts(activeDrafts.map((q) => {
      if (q.tempId !== tempId) return q
      const options = [...q.options]
      options[optIdx] = value
      return { ...q, options }
    }))
  }

  function reorderDrafts(from: number, to: number) {
    if (from === to) return
    const next = [...activeDrafts]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setDrafts(next)
  }

  function handleDragStart(index: number) {
    setDragIndex(index)
    setOverIndex(index)
  }

  function handleDragEnter(index: number) {
    if (dragIndex === null) return
    setOverIndex(index)
  }

  function handleDragEnd() {
    if (dragIndex !== null && overIndex !== null) {
      reorderDrafts(dragIndex, overIndex)
    }
    setDragIndex(null)
    setOverIndex(null)
    setGrabEnabled(false)
  }

  function handleSave() {
    if (!selectedBotId) return
    setError(null)
    setFeedback(null)

    const invalid = activeDrafts.findIndex((q) => !q.fieldKey.trim() || !q.questionText.trim())
    if (invalid >= 0) {
      setError(`Pergunta ${invalid + 1}: campo-chave e texto são obrigatórios.`)
      return
    }

    for (let i = 0; i < activeDrafts.length; i++) {
      const q = activeDrafts[i]
      if (q.questionType === 'quiz') {
        const filled = q.options.filter((o) => o.trim())
        if (filled.length < 2) {
          setError(`Pergunta ${i + 1}: perguntas quiz precisam de pelo menos 2 opções.`)
          return
        }
      }
    }

    const keys = activeDrafts.map((q) => q.fieldKey.trim().toLowerCase())
    if (keys.length !== new Set(keys).size) {
      setError('Cada pergunta deve ter um campo-chave único.')
      return
    }

    saveMutation.mutate({ botId: selectedBotId, qs: activeDrafts })
  }

  const isDirty = drafts !== null
  const inputCls = 'w-full bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm disabled:opacity-50'

  // Mapa campo-chave -> pergunta, para exibir respostas legíveis e identificar quizzes.
  const questionMap = new Map(serverQuestions.map((q) => [q.fieldKey, q]))

  const inProgress = applications.filter((a) => a.status === 'pending' || a.status === 'theory_passed')
  const approved = applications.filter((a) => a.status === 'approved')
  const rejected = applications.filter((a) => a.status === 'rejected' || a.status === 'cancelled' || a.status === 'timed_out')

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Whitelist</p>
        <h2 className="text-lg font-semibold text-zinc-100">Perguntas da Whitelist</h2>
        <p className="text-sm text-zinc-500 mt-0.5">
          Configure perguntas abertas ou quiz de múltipla escolha. A pontuação mínima é configurável em Configurações → Whitelist.
        </p>
      </div>

      {/* Bot selector */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
        <label className="block text-xs font-medium text-zinc-400 mb-2">Selecionar bot</label>
        {botsQuery.isLoading ? (
          <p className="text-sm text-zinc-500">Carregando bots...</p>
        ) : visibleBots.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhum bot disponível.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {visibleBots.map((bot) => (
              <button
                key={bot.id}
                type="button"
                onClick={() => handleSelectBot(bot.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedBotId === bot.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100'
                }`}
              >
                {bot.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tabs */}
      {selectedBotId && (
        <div className="flex items-center gap-1 border-b border-zinc-800">
          <button
            type="button"
            onClick={() => setTab('questions')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'questions'
                ? 'border-blue-500 text-zinc-100'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <FileText className="w-4 h-4" />
            Perguntas
          </button>
          <button
            type="button"
            onClick={() => setTab('applications')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'applications'
                ? 'border-blue-500 text-zinc-100'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Inbox className="w-4 h-4" />
            Aplicações
          </button>
        </div>
      )}

      {/* Applications board */}
      {selectedBotId && tab === 'applications' && (
        <ApplicationsBoard
          isLoading={applicationsQuery.isLoading}
          isError={applicationsQuery.isError}
          isFetching={applicationsQuery.isFetching}
          onRefresh={() => applicationsQuery.refetch()}
          inProgress={inProgress}
          approved={approved}
          rejected={rejected}
          questionMap={questionMap}
        />
      )}

      {/* Questions editor */}
      {selectedBotId && tab === 'questions' && (
        <div className="space-y-4">
          {feedback && (
            <div className="px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">
              {feedback}
            </div>
          )}
          {error && (
            <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
              {error}
            </div>
          )}

          {questionsQuery.isLoading ? (
            <div className="text-sm text-zinc-500 text-center py-8">Carregando perguntas...</div>
          ) : (
            <>
              {activeDrafts.length === 0 ? (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 text-center">
                  <p className="text-sm text-zinc-500 mb-3">Nenhuma pergunta configurada.</p>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={addQuestion}
                      className="flex items-center gap-2 mx-auto px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Adicionar pergunta
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {activeDrafts.map((q, index) => (
                    <div
                      key={q.tempId}
                      draggable={canEdit && grabEnabled}
                      onDragStart={() => handleDragStart(index)}
                      onDragEnter={() => handleDragEnter(index)}
                      onDragOver={(e) => e.preventDefault()}
                      onDragEnd={handleDragEnd}
                      onDrop={(e) => e.preventDefault()}
                      className={`bg-zinc-900 rounded-xl border p-4 transition-colors ${
                        dragIndex === index
                          ? 'border-blue-500/60 opacity-60'
                          : overIndex === index && dragIndex !== null
                            ? 'border-blue-500/40'
                            : 'border-zinc-800'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex items-center gap-2 pt-1 text-zinc-600">
                          <button
                            type="button"
                            disabled={!canEdit}
                            onMouseDown={() => setGrabEnabled(true)}
                            onMouseUp={() => setGrabEnabled(false)}
                            onTouchStart={() => setGrabEnabled(true)}
                            onTouchEnd={() => setGrabEnabled(false)}
                            title="Arraste para reordenar"
                            className="touch-none cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 disabled:cursor-not-allowed disabled:hover:text-zinc-600"
                          >
                            <GripVertical className="w-4 h-4" />
                          </button>
                          <span className="text-xs font-mono text-zinc-500 w-5 text-center">{index + 1}</span>
                        </div>

                        <div className="flex-1 space-y-3">
                          {/* Type toggle + field key */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-zinc-500 mb-1">Tipo</label>
                              <div className="flex rounded-lg overflow-hidden border border-zinc-800">
                                <button
                                  type="button"
                                  onClick={() => canEdit && updateDraft(q.tempId, 'questionType', 'open')}
                                  disabled={!canEdit}
                                  className={`flex-1 py-2 text-xs font-medium transition-colors ${
                                    q.questionType === 'open'
                                      ? 'bg-blue-600 text-white'
                                      : 'bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                                  }`}
                                >
                                  Resposta Livre
                                </button>
                                <button
                                  type="button"
                                  onClick={() => canEdit && updateDraft(q.tempId, 'questionType', 'quiz')}
                                  disabled={!canEdit}
                                  className={`flex-1 py-2 text-xs font-medium transition-colors ${
                                    q.questionType === 'quiz'
                                      ? 'bg-blue-600 text-white'
                                      : 'bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                                  }`}
                                >
                                  Quiz
                                </button>
                              </div>
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-zinc-500 mb-1">Campo-chave</label>
                              <input
                                type="text"
                                value={q.fieldKey}
                                onChange={(e) => updateDraft(q.tempId, 'fieldKey', e.target.value)}
                                disabled={!canEdit}
                                placeholder="ex: nome_personagem"
                                className={`${inputCls} font-mono`}
                              />
                            </div>
                          </div>

                          {/* Question text */}
                          <div>
                            <label className="block text-xs font-medium text-zinc-500 mb-1">Pergunta</label>
                            <textarea
                              value={q.questionText}
                              onChange={(e) => updateDraft(q.tempId, 'questionText', e.target.value)}
                              disabled={!canEdit}
                              placeholder="Digite a pergunta que o bot vai fazer..."
                              rows={2}
                              className={`${inputCls} resize-none`}
                            />
                          </div>

                          {/* Quiz options */}
                          {q.questionType === 'quiz' ? (
                            <div>
                              <label className="block text-xs font-medium text-zinc-500 mb-2">
                                Opções <span className="text-zinc-600">(marque a correta)</span>
                              </label>
                              <div className="space-y-2">
                                {['a', 'b', 'c', 'd'].map((letter, optIdx) => (
                                  <div key={optIdx} className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => canEdit && updateDraft(q.tempId, 'correctIndex', optIdx)}
                                      disabled={!canEdit}
                                      className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                                        q.correctIndex === optIdx
                                          ? 'bg-emerald-500 text-white'
                                          : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'
                                      }`}
                                      title="Marcar como correta"
                                    >
                                      {q.correctIndex === optIdx
                                        ? <CheckCircle className="w-3.5 h-3.5" />
                                        : <span className="text-xs font-medium">{letter}</span>
                                      }
                                    </button>
                                    <input
                                      type="text"
                                      value={q.options[optIdx] ?? ''}
                                      onChange={(e) => updateOption(q.tempId, optIdx, e.target.value)}
                                      disabled={!canEdit}
                                      placeholder={`Opção ${letter}`}
                                      className={inputCls}
                                    />
                                  </div>
                                ))}
                              </div>
                              <p className="text-xs text-zinc-600 mt-1">
                                Opções vazias não serão mostradas ao usuário. Mínimo 2 opções.
                              </p>
                            </div>
                          ) : (
                            <div>
                              <label className="block text-xs font-medium text-zinc-500 mb-1">
                                Resposta esperada <span className="text-zinc-600">(opcional, apenas para referência)</span>
                              </label>
                              <input
                                type="text"
                                value={q.correctAnswer}
                                onChange={(e) => updateDraft(q.tempId, 'correctAnswer', e.target.value)}
                                disabled={!canEdit}
                                placeholder="Deixe vazio para resposta livre"
                                className={inputCls}
                              />
                            </div>
                          )}
                        </div>

                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => removeQuestion(q.tempId)}
                            className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors mt-0.5 shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {canEdit && (
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={addQuestion}
                    className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Adicionar pergunta
                  </button>

                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saveMutation.isPending || !isDirty}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    {saveMutation.isPending ? 'Salvando...' : 'Salvar perguntas'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Applications board
// ---------------------------------------------------------------------------

const STATUS_META: Record<WhitelistApplicationStatus, { label: string; badge: string }> = {
  pending:       { label: 'Em andamento', badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  theory_passed: { label: 'Teórica aprovada', badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  approved:      { label: 'Aprovado', badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  rejected:      { label: 'Reprovado', badge: 'bg-red-500/15 text-red-400 border-red-500/30' },
  cancelled:     { label: 'Cancelado', badge: 'bg-zinc-700/40 text-zinc-400 border-zinc-600/40' },
  timed_out:     { label: 'Expirado', badge: 'bg-zinc-700/40 text-zinc-400 border-zinc-600/40' },
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

interface ApplicationsBoardProps {
  isLoading: boolean
  isError: boolean
  isFetching: boolean
  onRefresh: () => void
  inProgress: WhitelistApplication[]
  approved: WhitelistApplication[]
  rejected: WhitelistApplication[]
  questionMap: Map<string, WhitelistQuestion>
}

function ApplicationsBoard({ isLoading, isError, isFetching, onRefresh, inProgress, approved, rejected, questionMap }: ApplicationsBoardProps) {
  if (isLoading) {
    return <div className="text-sm text-zinc-500 text-center py-8">Carregando aplicações...</div>
  }
  if (isError) {
    return (
      <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
        Não foi possível carregar as aplicações.
      </div>
    )
  }

  const total = inProgress.length + approved.length + rejected.length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          {total} {total === 1 ? 'aplicação' : 'aplicações'} no total
        </p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isFetching}
          className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ApplicationColumn
          title="Em andamento"
          icon={<Clock className="w-4 h-4 text-amber-400" />}
          accent="border-t-amber-500/40"
          apps={inProgress}
          questionMap={questionMap}
        />
        <ApplicationColumn
          title="Aprovado"
          icon={<CheckCircle className="w-4 h-4 text-emerald-400" />}
          accent="border-t-emerald-500/40"
          apps={approved}
          questionMap={questionMap}
        />
        <ApplicationColumn
          title="Reprovado"
          icon={<XCircle className="w-4 h-4 text-red-400" />}
          accent="border-t-red-500/40"
          apps={rejected}
          questionMap={questionMap}
        />
      </div>
    </div>
  )
}

interface ApplicationColumnProps {
  title: string
  icon: ReactNode
  accent: string
  apps: WhitelistApplication[]
  questionMap: Map<string, WhitelistQuestion>
}

function ApplicationColumn({ title, icon, accent, apps, questionMap }: ApplicationColumnProps) {
  return (
    <div className={`bg-zinc-900/50 rounded-xl border border-zinc-800 border-t-2 ${accent} p-3 space-y-3`}>
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
          {icon}
          {title}
        </div>
        <span className="text-xs font-mono text-zinc-500 bg-zinc-800 rounded-full px-2 py-0.5">{apps.length}</span>
      </div>
      {apps.length === 0 ? (
        <div className="text-xs text-zinc-600 text-center py-6">Nenhuma aplicação.</div>
      ) : (
        <div className="space-y-2">
          {apps.map((app) => (
            <ApplicationCard key={app.id} app={app} questionMap={questionMap} />
          ))}
        </div>
      )}
    </div>
  )
}

function ApplicationCard({ app, questionMap }: { app: WhitelistApplication; questionMap: Map<string, WhitelistQuestion> }) {
  const [open, setOpen] = useState(false)
  const meta = STATUS_META[app.status]
  const answerEntries = Object.entries(app.answers ?? {})

  // Correção do quiz: quantas/quais erradas.
  const quizEntries = Object.entries(app.quizResults ?? {})
  const quizTotal = quizEntries.length
  const wrongCount = quizEntries.filter(([, ok]) => !ok).length

  const handle = app.username ? `@${app.username}` : null

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-zinc-100">
            #{app.appNumber || app.id}
          </span>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${meta.badge}`}>
            {meta.label}
          </span>
        </div>
        {handle ? (
          <p className="text-xs text-zinc-200 mt-1 font-medium truncate">
            {handle}
            {app.displayName && <span className="text-zinc-500 font-normal"> · {app.displayName}</span>}
          </p>
        ) : null}
        <p className="text-[11px] text-zinc-600 mt-0.5 font-mono truncate">ID: {app.userId}</p>
        {quizTotal > 0 && (
          <p className={`text-[11px] mt-1 font-medium ${wrongCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            {wrongCount > 0
              ? `Errou ${wrongCount} de ${quizTotal} ${quizTotal === 1 ? 'questão' : 'questões'}`
              : `Acertou todas as ${quizTotal} ${quizTotal === 1 ? 'questão' : 'questões'}`}
          </p>
        )}
        <p className="text-[11px] text-zinc-600 mt-0.5">{formatDate(app.updatedAt || app.createdAt)}</p>
      </button>

      {open && (
        <div className="mt-3 pt-3 border-t border-zinc-800 space-y-2">
          {answerEntries.length === 0 ? (
            <p className="text-xs text-zinc-600">Nenhuma resposta registrada.</p>
          ) : (
            answerEntries.map(([key, value]) => {
              const question = questionMap.get(key)
              const graded = question?.questionType === 'quiz' && key in app.quizResults
              const correct = app.quizResults[key]
              return (
                <div key={key}>
                  <div className="flex items-start gap-1.5">
                    {graded && (correct
                      ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-px" />
                      : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-px" />
                    )}
                    <p className="text-[11px] font-medium text-zinc-500">{question?.questionText ?? key}</p>
                  </div>
                  <p className={`text-xs whitespace-pre-wrap break-words ${graded ? 'pl-5' : ''} ${graded ? (correct ? 'text-emerald-300' : 'text-red-300') : 'text-zinc-300'}`}>
                    {String(value)}
                  </p>
                  {graded && !correct && question?.options?.[question.correctIndex] && (
                    <p className="text-[11px] text-emerald-400/80 pl-5">Correta: {question.options[question.correctIndex]}</p>
                  )}
                </div>
              )
            })
          )}
          {app.reviewNote && (
            <div className="pt-1">
              <p className="text-[11px] font-medium text-zinc-500">Nota da revisão</p>
              <p className="text-xs text-zinc-300 whitespace-pre-wrap break-words">{app.reviewNote}</p>
            </div>
          )}
          {app.reviewedBy && (
            <p className="text-[11px] text-zinc-600">Revisado por: <span className="font-mono">{app.reviewedBy}</span></p>
          )}
        </div>
      )}
    </div>
  )
}
