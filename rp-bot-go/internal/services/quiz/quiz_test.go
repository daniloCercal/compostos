package quiz

import (
	"strings"
	"testing"

	"github.com/yourorg/rp-bot/internal/db"
)

func TestParseChoice(t *testing.T) {
	cases := []struct {
		name    string
		answer  string
		options int
		want    int
	}{
		{"letra a", "a", 4, 0},
		{"letra d maiuscula com espaco", " D ", 4, 3},
		{"letra fora do range", "e", 4, -1},
		{"numero 1", "1", 4, 0},
		{"numero 4", "4", 4, 3},
		{"numero fora do range", "5", 4, -1},
		{"palavra dois", "dois", 4, 1},
		{"palavra terceiro", "terceiro", 4, 2},
		{"palavra alem do range", "quatro", 3, -1},
		{"lixo", "talvez", 4, -1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := ParseChoice(c.answer, c.options); got != c.want {
				t.Fatalf("ParseChoice(%q, %d) = %d, want %d", c.answer, c.options, got, c.want)
			}
		})
	}
}

func quizQuestion(field string, correct int) db.QuizQuestion {
	return db.QuizQuestion{
		Q:            "Pergunta " + field,
		Field:        field,
		Type:         "quiz",
		Options:      []string{"Op0", "Op1", "Op2", "Op3"},
		CorrectIndex: correct,
	}
}

func TestGradeRespectsShuffledOptions(t *testing.T) {
	q := quizQuestion("f", 2) // a opção correta é a original de índice 2
	// Ordem embaralhada: posição exibida -> índice original.
	// pos0=3, pos1=2, pos2=0, pos3=1  => a correta (orig 2) aparece em "b".
	qs := &db.QuizState{OptionOrders: map[string][]int{"f": {3, 2, 0, 1}}}

	if correct, valid := Grade(q, qs, "b"); !valid || !correct {
		t.Fatalf("resposta 'b' deveria ser correta; got correct=%v valid=%v", correct, valid)
	}
	if correct, valid := Grade(q, qs, "a"); !valid || correct {
		t.Fatalf("resposta 'a' deveria ser incorreta; got correct=%v valid=%v", correct, valid)
	}
	if _, valid := Grade(q, qs, "zzz"); valid {
		t.Fatalf("resposta inválida deveria retornar valid=false")
	}
}

func TestGradeIdentityWhenNoShuffle(t *testing.T) {
	q := quizQuestion("f", 1)
	qs := &db.QuizState{} // sem OptionOrders -> ordem identidade
	if correct, valid := Grade(q, qs, "b"); !valid || !correct {
		t.Fatalf("com ordem identidade, 'b' (índice 1) deveria ser correta; got %v/%v", correct, valid)
	}
}

func TestGradeOpenQuestionIsNotGradable(t *testing.T) {
	open := db.QuizQuestion{Q: "Nome?", Field: "ign", Type: "open"}
	if _, valid := Grade(open, &db.QuizState{}, "qualquer"); valid {
		t.Fatalf("pergunta aberta não deveria ser pontuável")
	}
}

func TestScore(t *testing.T) {
	questions := []db.QuizQuestion{
		quizQuestion("f1", 0),
		quizQuestion("f2", 0),
		{Q: "aberta", Field: "o1", Type: "open"},
	}

	t.Run("acima do corte aprova", func(t *testing.T) {
		qs := &db.QuizState{Results: map[string]bool{"f1": true, "f2": true}, PassScore: 80}
		correct, total, pct, passed := Score(questions, qs)
		if correct != 2 || total != 2 || pct != 100 || !passed {
			t.Fatalf("got %d/%d %d%% passed=%v", correct, total, pct, passed)
		}
	})

	t.Run("no corte exato aprova", func(t *testing.T) {
		qs := &db.QuizState{Results: map[string]bool{"f1": true, "f2": false}, PassScore: 50}
		if _, _, pct, passed := Score(questions, qs); pct != 50 || !passed {
			t.Fatalf("50%% com corte 50 deveria aprovar; got %d%% passed=%v", pct, passed)
		}
	})

	t.Run("abaixo do corte reprova", func(t *testing.T) {
		qs := &db.QuizState{Results: map[string]bool{"f1": true, "f2": false}, PassScore: 60}
		if _, _, _, passed := Score(questions, qs); passed {
			t.Fatalf("50%% com corte 60 deveria reprovar")
		}
	})

	t.Run("sem perguntas de quiz aprova com 100", func(t *testing.T) {
		only := []db.QuizQuestion{{Field: "o1", Type: "open"}}
		_, total, pct, passed := Score(only, &db.QuizState{PassScore: 90})
		if total != 0 || pct != 100 || !passed {
			t.Fatalf("sem quiz deveria aprovar 100%%; got total=%d pct=%d passed=%v", total, pct, passed)
		}
	})

	t.Run("PassScore zero usa default", func(t *testing.T) {
		qs := &db.QuizState{Results: map[string]bool{"f1": true, "f2": false}, PassScore: 0}
		// default é 90; 50% reprova
		if _, _, _, passed := Score(questions, qs); passed {
			t.Fatalf("com PassScore=0 (default %d) 50%% deveria reprovar", DefaultPassScore)
		}
	})
}

func TestResolve(t *testing.T) {
	questions := []db.QuizQuestion{
		{Field: "a"}, {Field: "b"}, {Field: "c"},
	}
	qs := &db.QuizState{QuestionOrder: []int{2, 0, 1}}
	if idx, q := Resolve(qs, questions, 0); idx != 2 || q.Field != "c" {
		t.Fatalf("Resolve pos0 com ordem [2,0,1] deveria dar idx2/c; got %d/%s", idx, q.Field)
	}

	identity := &db.QuizState{} // QuestionOrder vazio -> identidade
	if idx, q := Resolve(identity, questions, 1); idx != 1 || q.Field != "b" {
		t.Fatalf("Resolve identidade pos1 deveria dar idx1/b; got %d/%s", idx, q.Field)
	}
}

func TestFormatQuestion(t *testing.T) {
	open := db.QuizQuestion{Q: "Qual seu nome?", Field: "ign", Type: "open"}
	if got := FormatQuestion(1, open, &db.QuizState{}); got != "**P1:** Qual seu nome?" {
		t.Fatalf("formato de pergunta aberta inesperado: %q", got)
	}

	q := quizQuestion("f", 0)
	qs := &db.QuizState{OptionOrders: map[string][]int{"f": {1, 0, 2, 3}}}
	got := FormatQuestion(2, q, qs)
	if !strings.Contains(got, "P2 (Quiz)") {
		t.Fatalf("deveria marcar como Quiz: %q", got)
	}
	// pos0 exibe a opção original 1, pos1 a original 0.
	if !strings.Contains(got, "a) Op1") || !strings.Contains(got, "b) Op0") {
		t.Fatalf("opções embaralhadas mal formatadas: %q", got)
	}
}
