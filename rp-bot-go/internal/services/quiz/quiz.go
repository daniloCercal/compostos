// Package quiz contém a lógica de negócio do questionário de whitelist:
// embaralhamento de perguntas/opções, avaliação de respostas e pontuação.
// É puro (sem Discord nem banco), portanto testável isoladamente.
package quiz

import (
	"fmt"
	"math/rand"
	"strconv"
	"strings"

	"github.com/yourorg/rp-bot/internal/db"
)

// DefaultPassScore é a pontuação mínima usada quando o estado não define uma.
const DefaultPassScore = 90

// BuildState embaralha perguntas e opções, criando o estado para uma aplicação.
func BuildState(questions []db.QuizQuestion, passScore int) db.QuizState {
	order := rand.Perm(len(questions))
	optOrders := make(map[string][]int)
	for _, q := range questions {
		if isQuiz(q) {
			optOrders[q.Field] = rand.Perm(len(q.Options))
		}
	}
	return db.QuizState{
		QuestionOrder: order,
		OptionOrders:  optOrders,
		Results:       make(map[string]bool),
		PassScore:     passScore,
	}
}

// Resolve retorna o índice real da pergunta na posição pos do quiz embaralhado.
func Resolve(qs *db.QuizState, questions []db.QuizQuestion, pos int) (int, db.QuizQuestion) {
	idx := pos
	if len(qs.QuestionOrder) == len(questions) {
		idx = qs.QuestionOrder[pos]
	}
	return idx, questions[idx]
}

// FormatQuestion formata a mensagem da pergunta para envio no Discord.
func FormatQuestion(num int, q db.QuizQuestion, qs *db.QuizState) string {
	var sb strings.Builder
	if isQuiz(q) {
		fmt.Fprintf(&sb, "**P%d (Quiz):** %s\n", num, q.Q)
		optOrder := optionOrder(qs, q)
		letters := []string{"a", "b", "c", "d", "e"}
		for i, origIdx := range optOrder {
			if i < len(letters) && origIdx < len(q.Options) {
				fmt.Fprintf(&sb, "%s) %s\n", letters[i], q.Options[origIdx])
			}
		}
		fmt.Fprintf(&sb, "\n_Responda com a letra ou número (ex: a, b, 1, 2)._")
	} else {
		fmt.Fprintf(&sb, "**P%d:** %s", num, q.Q)
	}
	return sb.String()
}

// ParseChoice converte a resposta do usuário num índice 0-based de opção.
// Retorna -1 se inválido.
func ParseChoice(answer string, numOptions int) int {
	answer = strings.TrimSpace(strings.ToLower(answer))

	// Letra: a, b, c, d
	if len(answer) == 1 && answer[0] >= 'a' && int(answer[0]-'a') < numOptions {
		return int(answer[0] - 'a')
	}

	// Número: 1, 2, 3, 4
	if n, err := strconv.Atoi(answer); err == nil && n >= 1 && n <= numOptions {
		return n - 1
	}

	// Palavras em português
	ptWords := [][]string{
		{"um", "uma", "primeiro", "primeira"},
		{"dois", "duas", "segundo", "segunda"},
		{"três", "tres", "terceiro", "terceira"},
		{"quatro", "quarto", "quarta"},
	}
	for i, variants := range ptWords {
		if i >= numOptions {
			break
		}
		for _, v := range variants {
			if answer == v {
				return i
			}
		}
	}
	return -1
}

// Grade avalia a resposta a uma pergunta de quiz, considerando o embaralhamento
// das opções. valid=false significa que a resposta não pôde ser interpretada
// (nesse caso correct é irrelevante).
func Grade(q db.QuizQuestion, qs *db.QuizState, answer string) (correct bool, valid bool) {
	if !isQuiz(q) {
		return false, false
	}
	choice := ParseChoice(answer, len(q.Options))
	if choice < 0 {
		return false, false
	}
	// Posição (já embaralhada) onde está a opção correta original.
	correctPos := -1
	for i, origIdx := range optionOrder(qs, q) {
		if origIdx == q.CorrectIndex {
			correctPos = i
			break
		}
	}
	return choice == correctPos, true
}

// Score conta os acertos das perguntas de quiz e decide a aprovação.
// pct é 100 quando não há perguntas de quiz (aprovação automática na teoria).
func Score(questions []db.QuizQuestion, qs *db.QuizState) (correct, total, pct int, passed bool) {
	for _, q := range questions {
		if isQuiz(q) {
			total++
			if qs.Results[q.Field] {
				correct++
			}
		}
	}
	passPct := qs.PassScore
	if passPct <= 0 {
		passPct = DefaultPassScore
	}
	if total == 0 {
		return 0, 0, 100, true
	}
	pct = correct * 100 / total
	return correct, total, pct, pct >= passPct
}

// isQuiz indica se a pergunta é de múltipla escolha (pontuável).
func isQuiz(q db.QuizQuestion) bool {
	return q.Type == "quiz" && len(q.Options) > 0
}

// optionOrder retorna a ordem (possivelmente embaralhada) das opções, com
// fallback para a ordem identidade quando o estado é inconsistente.
func optionOrder(qs *db.QuizState, q db.QuizQuestion) []int {
	order := qs.OptionOrders[q.Field]
	if len(order) != len(q.Options) {
		order = make([]int, len(q.Options))
		for i := range order {
			order[i] = i
		}
	}
	return order
}
