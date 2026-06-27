import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, GripVertical, Save, CheckCircle } from 'lucide-react'
import { listBots, listWhitelistQuestions, saveWhitelistQuestions } from '../api/admin'
import { ApiError } from '../api/client'
import type { SessionResponse, WhitelistQuestion } from '../types'

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

      {/* Questions editor */}
      {selectedBotId && (
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
                    <div key={q.tempId} className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex items-center gap-2 pt-1 text-zinc-600">
                          <GripVertical className="w-4 h-4" />
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
