package handlers

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/yourorg/rp-bot/internal/bot"
	"github.com/yourorg/rp-bot/internal/db"
	"github.com/yourorg/rp-bot/internal/services"
	"github.com/yourorg/rp-bot/internal/services/quiz"
)

// Timeouts do fluxo de whitelist.
const (
	// Antes de digitar "iniciar": aviso aos 3min, cancela aos 5min.
	preStartWarnAfter = 3 * time.Minute
	preStartKillAfter = 5 * time.Minute
	// Entre perguntas: aviso após 1min de silêncio, cancela aos 2min.
	answerWarnAfter = 1 * time.Minute
	answerKillAfter = 2 * time.Minute
	// Exclusão do canal após o término.
	deleteAfterTimeout = 30 * time.Second
	deleteAfterResult  = 1 * time.Minute
)

// Cargos atribuídos conforme o resultado.
const (
	approvedRoleName = "Entrevistado"
	rejectedRoleName = "Reprovado"
)

type Allowlist struct {
	b     *bot.Bot
	cache *services.ChannelCache

	mu sync.Mutex
	// warnedAt guarda, por aplicação, o QuestionStartedAt vigente quando o
	// aviso de inatividade foi enviado. Se o usuário responder, o timestamp
	// muda no banco e o aviso "reseta" automaticamente.
	warnedAt map[int64]time.Time
}

func NewAllowlist(b *bot.Bot, cache *services.ChannelCache) *Allowlist {
	return &Allowlist{b: b, cache: cache, warnedAt: map[int64]time.Time{}}
}

func (a *Allowlist) wasWarned(appID int64, questionStartedAt time.Time) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	t, ok := a.warnedAt[appID]
	return ok && t.Equal(questionStartedAt)
}

func (a *Allowlist) markWarned(appID int64, questionStartedAt time.Time) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.warnedAt[appID] = questionStartedAt
}

func (a *Allowlist) clearWarned(appID int64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.warnedAt, appID)
}

// touchActivity atualiza question_started_at para "agora", resetando o timer
// de inatividade sem alterar respostas nem a pergunta atual.
func (a *Allowlist) touchActivity(ctx context.Context, app *db.AllowlistApplication) {
	now := time.Now()
	_ = a.b.LogDBErr("UpdateApplicationProgress",
		a.b.DB.UpdateApplicationProgress(ctx, app.ID, app.Answers, app.CurrentQuestion, &now))
}

// deleteChannelAfter agenda a exclusão do canal de aplicação.
func (a *Allowlist) deleteChannelAfter(s *discordgo.Session, channelID string, d time.Duration) {
	time.AfterFunc(d, func() {
		if _, err := s.ChannelDelete(channelID); err != nil {
			a.b.Log.Warn("excluir canal de aplicação", "channel", channelID, "err", err)
		}
	})
}

// roleIDByName localiza um cargo do guild pelo nome (case-insensitive).
func (a *Allowlist) roleIDByName(s *discordgo.Session, guildID, name string) string {
	var roles []*discordgo.Role
	if g, err := s.State.Guild(guildID); err == nil && g != nil {
		roles = g.Roles
	}
	if len(roles) == 0 {
		roles, _ = s.GuildRoles(guildID)
	}
	for _, r := range roles {
		if strings.EqualFold(r.Name, name) {
			return r.ID
		}
	}
	return ""
}

// characterName extrai o nome do personagem das respostas da aplicação.
func characterName(questions []db.QuizQuestion, app *db.AllowlistApplication) string {
	for _, f := range []string{"personagem", "character", "char_name", "nome", "ign"} {
		if v := strings.TrimSpace(app.Answers[f]); v != "" {
			return v
		}
	}
	for _, q := range questions {
		if q.Type != "quiz" {
			if v := strings.TrimSpace(app.Answers[q.Field]); v != "" {
				return v
			}
		}
	}
	return "—"
}

// canReview indica se o autor da interação é staff/admin do guild.
func (a *Allowlist) canReview(s *discordgo.Session, i *discordgo.InteractionCreate, cfg *db.GuildConfig) bool {
	staffRole, adminRole := "", ""
	if cfg != nil {
		staffRole, adminRole = cfg.StaffRoleID, cfg.AdminRoleID
	}
	return hasStaffPermission(s, i, staffRole, adminRole)
}

func (a *Allowlist) Commands() []*discordgo.ApplicationCommand {
	return []*discordgo.ApplicationCommand{
		{Name: "whitelist", Description: "Start or continue whitelist application"},
		{Name: "whitelist_panel", Description: "Post whitelist panel (admin only)",
			DefaultMemberPermissions: int64ptr(discordgo.PermissionAdministrator)},
		{Name: "whitelist_pending", Description: "List pending applications (staff only)"},
		{Name: "whitelist_skip", Description: "Skip current question (admin only)",
			DefaultMemberPermissions: int64ptr(discordgo.PermissionAdministrator),
			Options: []*discordgo.ApplicationCommandOption{
				{Type: discordgo.ApplicationCommandOptionUser, Name: "user", Description: "User", Required: true},
			}},
	}
}

var defaultQuestions = []db.QuizQuestion{
	{Q: "Qual o seu nome no jogo?", Field: "ign", Type: "open"},
	{Q: "Como ficou sabendo de nós?", Field: "referral", Type: "open"},
	{Q: "Descreva sua experiência com roleplay:", Field: "experience", Type: "open"},
	{Q: "Por que quer entrar?", Field: "motivation", Type: "open"},
	{Q: "Leu e aceita as regras? (sim/não):", Field: "rules_confirmed", Type: "open"},
}

func (a *Allowlist) getQuestions(ctx context.Context, guildID string) []db.QuizQuestion {
	qs, err := a.b.DB.GetWhitelistQuestionsByGuild(ctx, guildID)
	if err != nil || len(qs) == 0 {
		return defaultQuestions
	}
	return qs
}

func (a *Allowlist) WhitelistPanel(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ctx, cancel := a.b.OpContext(15 * time.Second)
	defer cancel()
	cfg, _ := a.b.DB.GetGuildConfig(ctx, i.GuildID)
	var pc db.PanelConfigs
	if cfg != nil {
		pc = cfg.PanelConfigs
	}
	e := pc.WhitelistEmbed()

	ext := a.b.DB.GetExtendedConfig(ctx, i.GuildID)
	color := embedColor(ext.EmbedColor)
	embed := buildEmbed(color, e.Title, e.Description, "")

	_ = s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Embeds: []*discordgo.MessageEmbed{embed},
			Components: []discordgo.MessageComponent{
				discordgo.ActionsRow{Components: []discordgo.MessageComponent{
					discordgo.Button{Label: e.ButtonLabel, Style: discordgo.PrimaryButton, CustomID: "whitelist:start_button"},
				}},
			},
		},
	})
}

func (a *Allowlist) HandleStartButton(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ctx, cancel := a.b.OpContext(15 * time.Second)
	defer cancel()
	guildID := i.GuildID
	userID := i.Member.User.ID

	// ACK imediato: criar canal + várias queries pode passar dos 3s do Discord.
	if !deferEphemeral(s, i) {
		return
	}

	if rateLimited(ctx, a.b.Redis, "ratelimit:allowlist", guildID, userID, a.b.Cfg.RateLimitAllowlist) {
		editResponse(s, i, "Muitas tentativas de whitelist. Aguarde um minuto.")
		return
	}

	existing, _ := a.b.DB.GetPendingApplication(ctx, guildID, userID)
	if existing != nil {
		editResponse(s, i, "Você já tem uma aplicação pendente.")
		return
	}

	// Lock por usuário/guild (não global) para evitar duplo-start sem serializar todos.
	lock := services.NewDistributedLock(a.b.Redis, fmt.Sprintf("whitelist:lock:%s:%s", guildID, userID), 30*time.Second)
	rel, acquired, err := lock.Acquire(ctx)
	if err != nil || !acquired {
		editResponse(s, i, "Sua aplicação já está sendo criada. Aguarde.")
		return
	}
	defer rel()

	questions := a.getQuestions(ctx, guildID)

	// Determinar pontuação mínima do guild config
	passScore := 90
	cfg, _ := a.b.DB.GetGuildConfig(ctx, guildID)
	if cfg != nil && cfg.WhitelistPassScore > 0 {
		passScore = cfg.WhitelistPassScore
	}

	num, _ := a.b.DB.NextWhitelistNumber(ctx, guildID)
	parentID := ""
	if cfg != nil {
		parentID = cfg.WhitelistChannelID
	}

	chData := discordgo.GuildChannelCreateData{
		Name:     fmt.Sprintf("app-%04d-%s", num, strings.ToLower(i.Member.User.Username)),
		Type:     discordgo.ChannelTypeGuildText,
		ParentID: parentID,
		PermissionOverwrites: []*discordgo.PermissionOverwrite{
			{ID: guildID, Type: discordgo.PermissionOverwriteTypeRole, Deny: discordgo.PermissionViewChannel},
			{ID: userID, Type: discordgo.PermissionOverwriteTypeMember, Allow: discordgo.PermissionViewChannel | discordgo.PermissionSendMessages},
		},
	}
	ch, err := s.GuildChannelCreateComplex(guildID, chData)
	if err != nil && parentID != "" {
		a.b.Log.Warn("criar canal com parentID falhou, tentando sem categoria", "err", err, "parentID", parentID)
		chData.ParentID = ""
		ch, err = s.GuildChannelCreateComplex(guildID, chData)
	}
	if err != nil {
		a.b.Log.Error("criar canal de aplicacao", "err", err, "guild", guildID)
		editResponse(s, i, "Falha ao criar canal de aplicação: "+err.Error())
		return
	}

	// Embaralhar perguntas e opções
	quizState := quiz.BuildState(questions, passScore)

	now := time.Now()
	app := &db.AllowlistApplication{
		GuildID: guildID, UserID: userID, ChannelID: ch.ID,
		AppNumber: num, Status: "pending",
		Answers:           map[string]string{},
		CurrentQuestion:   -1, // aguardando "iniciar"
		QuizState:         quizState,
		StartedAt:         &now,
		QuestionStartedAt: &now,
	}
	appID, err := a.b.DB.InsertApplication(ctx, app)
	if err != nil {
		_, _ = s.ChannelDelete(ch.ID)
		editResponse(s, i, "DB error.")
		return
	}
	app.ID = appID
	a.cache.Add(ch.ID, services.ChannelApp)

	introMsg := fmt.Sprintf("Olá, <@%s>! Bem-vindo(a) ao processo de whitelist.\n\n", userID)
	introMsg += "**Como funciona:**\n"
	introMsg += "• Você responderá uma série de perguntas.\n"
	introMsg += "• **Perguntas de quiz** (múltipla escolha): responda com a letra da opção (**a**, **b**, **c** ou **d**).\n"
	introMsg += "• **Perguntas abertas**: responda livremente — não são pontuadas.\n"
	introMsg += fmt.Sprintf("• Para ser aprovado, você precisa acertar pelo menos **%d%%** das questões de quiz.\n\n", passScore)
	introMsg += "Quando estiver pronto, digite **iniciar** para começar."
	_, _ = s.ChannelMessageSend(ch.ID, introMsg)
	editResponse(s, i, fmt.Sprintf("Aplicação iniciada: <#%s>", ch.ID))
}

func (a *Allowlist) OnMessage(s *discordgo.Session, m *discordgo.MessageCreate) {
	if m.Author.Bot {
		return
	}
	// Fast path: se o cache está pronto e o canal não é uma aplicação ativa, ignora.
	if a.cache.Ready() && !a.cache.Is(m.ChannelID, services.ChannelApp) {
		return
	}
	ctx, cancel := a.b.OpContext(15 * time.Second)
	defer cancel()

	// Serializa o processamento de mensagens por canal de aplicação. Sem isto,
	// duas mensagens rápidas do mesmo usuário são processadas em goroutines
	// concorrentes (discordgo despacha cada evento numa goroutine) e fazem
	// read-modify-write na mesma linha → respostas perdidas / avanço duplo.
	lock := services.NewDistributedLock(a.b.Redis, "whitelist:msg:"+m.ChannelID, 15*time.Second)
	rel, ok, err := lock.AcquireWait(ctx, 40, 50*time.Millisecond) // ~2s
	if err != nil || !ok {
		if err == nil {
			_, _ = s.ChannelMessageSend(m.ChannelID, "Aguarde um instante antes de enviar a próxima resposta.")
		}
		return
	}
	defer rel()

	// Carrega o estado fresco DENTRO do lock para que leitura→escrita seja atômica.
	app, err := a.b.DB.GetApplicationByChannelAndUser(ctx, m.ChannelID, m.Author.ID)
	if err != nil || app == nil {
		return
	}

	// Aguardando o usuário digitar "iniciar"
	if app.CurrentQuestion == -1 {
		if strings.TrimSpace(strings.ToLower(m.Content)) == "iniciar" {
			questions := a.getQuestions(ctx, app.GuildID)
			qs := app.QuizState
			now := time.Now()
			_ = a.b.LogDBErr("UpdateApplicationProgress", a.b.DB.UpdateApplicationProgress(ctx, app.ID, app.Answers, 0, &now))
			_, firstQ := quiz.Resolve(&qs, questions, 0)
			_, _ = s.ChannelMessageSend(m.ChannelID, quiz.FormatQuestion(1, firstQ, &qs))
		} else {
			// Qualquer mensagem reseta o timer de inatividade da fase pré-início.
			a.touchActivity(ctx, app)
			_, _ = s.ChannelMessageSend(m.ChannelID, "Digite **iniciar** para começar as perguntas.")
		}
		return
	}

	questions := a.getQuestions(ctx, app.GuildID)
	if app.CurrentQuestion >= len(questions) {
		return
	}

	qs := app.QuizState
	_, q := quiz.Resolve(&qs, questions, app.CurrentQuestion)

	// Validação e correção para perguntas do tipo quiz
	if q.Type == "quiz" && len(q.Options) > 0 {
		correct, valid := quiz.Grade(q, &qs, m.Content)
		if !valid {
			// Mensagem inválida ainda conta como atividade: reseta o timer.
			a.touchActivity(ctx, app)
			letters := []string{"a", "b", "c", "d"}
			validLetters := strings.Join(letters[:len(q.Options)], ", ")
			_, _ = s.ChannelMessageSend(m.ChannelID, fmt.Sprintf(
				"Resposta inválida. Use a letra (%s) ou número (1-%d).", validLetters, len(q.Options)))
			return
		}
		qs.Results[q.Field] = correct
	}

	app.Answers[q.Field] = m.Content
	next := app.CurrentQuestion + 1
	now := time.Now()

	_ = a.b.LogDBErr("UpdateApplicationProgress", a.b.DB.UpdateApplicationProgress(ctx, app.ID, app.Answers, next, &now))
	_ = a.b.LogDBErr("UpdateApplicationQuizState", a.b.DB.UpdateApplicationQuizState(ctx, app.ID, &qs))

	if next >= len(questions) {
		app.QuizState = qs
		a.finishApplication(ctx, s, app, questions)
		return
	}

	_, nextQ := quiz.Resolve(&qs, questions, next)
	_, _ = s.ChannelMessageSend(m.ChannelID, quiz.FormatQuestion(next+1, nextQ, &qs))
}

// finishApplication calcula a pontuação e aprova ou rejeita automaticamente.
func (a *Allowlist) finishApplication(ctx context.Context, s *discordgo.Session, app *db.AllowlistApplication, questions []db.QuizQuestion) {
	// A aplicação deixa de estar 'pending' (vira approved ou rejected),
	// então sai do cache de coleta de respostas.
	a.cache.Remove(app.ChannelID)
	a.clearWarned(app.ID)
	qs := app.QuizState
	correct, quizCount, _, passed := quiz.Score(questions, &qs)
	passPct := qs.PassScore
	if passPct <= 0 {
		passPct = quiz.DefaultPassScore
	}
	minCorrect := (passPct*quizCount + 99) / 100

	cfg, _ := a.b.DB.GetGuildConfig(ctx, app.GuildID)

	if passed {
		_ = a.b.DB.FinalizeApplicationReview(ctx, app.ID, "approved", "auto",
			fmt.Sprintf("%d/%d acertos (mínimo: %d)", correct, quizCount, minCorrect))

		roleID := ""
		if cfg != nil {
			roleID = cfg.WhitelistRoleID
		}
		if roleID == "" {
			roleID = a.roleIDByName(s, app.GuildID, approvedRoleName)
		}
		if roleID != "" {
			_ = s.GuildMemberRoleAdd(app.GuildID, app.UserID, roleID)
		} else {
			a.b.Log.Warn("cargo de aprovado não encontrado", "guild", app.GuildID, "role", approvedRoleName)
		}

		passMsg := "✅ **Whitelist aprovada!** Você foi aprovado para seguir no servidor."
		if cfg != nil && cfg.WhitelistPassMessage != "" {
			passMsg = cfg.WhitelistPassMessage
		}
		_, _ = s.ChannelMessageSend(app.ChannelID,
			fmt.Sprintf("<@%s> %s\nEste canal será apagado em **1 minuto**.", app.UserID, passMsg))
		a.sendWhitelistDM(s, app.GuildID, app.UserID, true, passMsg)
		a.sendResultEmbed(ctx, s, app, questions, true, correct, quizCount, minCorrect, "")
	} else {
		failMsg := fmt.Sprintf(
			"Você não atingiu a nota mínima de %d/%d acertos na fase teórica. Tente novamente em outro momento.",
			minCorrect, quizCount)
		if cfg != nil && cfg.WhitelistFailMessage != "" {
			failMsg = cfg.WhitelistFailMessage
		}
		_ = a.b.DB.FinalizeApplicationReview(ctx, app.ID, "rejected", "auto",
			fmt.Sprintf("%d/%d acertos (mínimo: %d)", correct, quizCount, minCorrect))

		roleID := ""
		if cfg != nil {
			roleID = cfg.WhitelistRejectedRoleID
		}
		if roleID == "" {
			roleID = a.roleIDByName(s, app.GuildID, rejectedRoleName)
		}
		if roleID != "" {
			_ = s.GuildMemberRoleAdd(app.GuildID, app.UserID, roleID)
		} else {
			a.b.Log.Warn("cargo de reprovado não encontrado", "guild", app.GuildID, "role", rejectedRoleName)
		}

		_, _ = s.ChannelMessageSend(app.ChannelID,
			fmt.Sprintf("<@%s> ❌ **Whitelist reprovada.** %s\nEste canal será apagado em **1 minuto**.", app.UserID, failMsg))
		a.sendWhitelistDM(s, app.GuildID, app.UserID, false, failMsg)
		a.sendResultEmbed(ctx, s, app, questions, false, correct, quizCount, minCorrect, failMsg)
	}

	a.deleteChannelAfter(s, app.ChannelID, deleteAfterResult)
}

// sendResultEmbed publica o resultado final no canal de aprovados/reprovados
// (fallback: canal de log da whitelist).
func (a *Allowlist) sendResultEmbed(ctx context.Context, s *discordgo.Session, app *db.AllowlistApplication, questions []db.QuizQuestion, approved bool, correct, quizCount, minCorrect int, reason string) {
	cfg, _ := a.b.DB.GetGuildConfig(ctx, app.GuildID)
	if cfg == nil {
		return
	}

	title, desc, color := "❌ Whitelist reprovada", "A whitelist foi encerrada sem aprovação.", 0xE74C3C
	channelID := cfg.WhitelistRejectedChannelID
	if approved {
		title, desc, color = "✅ Whitelist aprovada", "Aprovado para seguir no servidor.", 0x2ECC71
		channelID = cfg.WhitelistApprovedChannelID
	}
	if channelID == "" {
		channelID = cfg.WhitelistLogChannelID
	}
	if channelID == "" {
		return
	}

	fields := []*discordgo.MessageEmbedField{
		{Name: "Usuário", Value: fmt.Sprintf("<@%s>", app.UserID)},
		{Name: "Personagem", Value: characterName(questions, app)},
	}
	if approved {
		fields = append(fields,
			&discordgo.MessageEmbedField{Name: "Etapa", Value: "Entrevista final"},
			&discordgo.MessageEmbedField{Name: "Pontuação", Value: fmt.Sprintf("%d/%d acertos (mínimo: %d)", correct, quizCount, minCorrect)},
			&discordgo.MessageEmbedField{Name: "Responsável", Value: "Automático"},
		)
	} else {
		fields = append(fields,
			&discordgo.MessageEmbedField{Name: "Etapa", Value: "Whitelist teórica"},
			&discordgo.MessageEmbedField{Name: "Pontuação", Value: fmt.Sprintf("%d/%d acertos (mínimo: %d)", correct, quizCount, minCorrect)},
			&discordgo.MessageEmbedField{Name: "Motivo", Value: reason},
		)
	}

	embed := &discordgo.MessageEmbed{
		Title:       title,
		Description: desc,
		Color:       color,
		Fields:      fields,
		Footer:      &discordgo.MessageEmbedFooter{Text: fmt.Sprintf("Whitelist #%04d", app.AppNumber)},
		Timestamp:   time.Now().Format(time.RFC3339),
	}
	_, _ = s.ChannelMessageSendComplex(channelID, &discordgo.MessageSend{
		Content: fmt.Sprintf("<@%s>", app.UserID),
		Embeds:  []*discordgo.MessageEmbed{embed},
	})
}

func (a *Allowlist) HandleApproveButton(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ctx, cancel := a.b.OpContext(15 * time.Second)
	defer cancel()
	idStr := parseIDSuffix(i.MessageComponentData().CustomID, "whitelist:approve:")
	app, err := a.b.DB.GetApplicationByID(ctx, mustInt64(idStr))
	if err != nil {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Aplicação não encontrada."))
		return
	}
	cfg, _ := a.b.DB.GetGuildConfig(ctx, app.GuildID)
	if !a.canReview(s, i, cfg) {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Apenas a equipe pode revisar aplicações."))
		return
	}
	if app.Status != "theory_passed" {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Esta aplicação já foi revisada."))
		return
	}
	actorID := i.Member.User.ID
	_ = a.b.DB.FinalizeApplicationReview(ctx, app.ID, "approved", actorID, "")
	a.cache.Remove(app.ChannelID)
	if cfg != nil && cfg.WhitelistRoleID != "" {
		_ = s.GuildMemberRoleAdd(app.GuildID, app.UserID, cfg.WhitelistRoleID)
	}
	msg := "Parabéns! Sua aplicação foi aprovada."
	if cfg != nil && cfg.WhitelistPassMessage != "" {
		msg = cfg.WhitelistPassMessage
	}
	_, _ = s.ChannelMessageSend(app.ChannelID, fmt.Sprintf("<@%s> %s", app.UserID, msg))
	a.sendWhitelistDM(s, app.GuildID, app.UserID, true, msg)
	_ = s.InteractionRespond(i.Interaction, ephemeral("Aprovado."))
}

func (a *Allowlist) HandleRejectButton(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ctx, cancel := a.b.OpContext(15 * time.Second)
	defer cancel()
	idStr := parseIDSuffix(i.MessageComponentData().CustomID, "whitelist:reject:")
	app, err := a.b.DB.GetApplicationByID(ctx, mustInt64(idStr))
	if err != nil {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Aplicação não encontrada."))
		return
	}
	cfg, _ := a.b.DB.GetGuildConfig(ctx, app.GuildID)
	if !a.canReview(s, i, cfg) {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Apenas a equipe pode revisar aplicações."))
		return
	}
	if app.Status != "theory_passed" {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Esta aplicação já foi revisada."))
		return
	}
	actorID := i.Member.User.ID
	_ = a.b.DB.FinalizeApplicationReview(ctx, app.ID, "rejected", actorID, "")
	a.cache.Remove(app.ChannelID)
	msg := "Infelizmente, sua aplicação foi reprovada."
	if cfg != nil && cfg.WhitelistFailMessage != "" {
		msg = cfg.WhitelistFailMessage
	}
	_, _ = s.ChannelMessageSend(app.ChannelID, fmt.Sprintf("<@%s> %s", app.UserID, msg))
	a.sendWhitelistDM(s, app.GuildID, app.UserID, false, msg)
	_ = s.InteractionRespond(i.Interaction, ephemeral("Reprovado."))
}

func (a *Allowlist) sendWhitelistDM(s *discordgo.Session, guildID, userID string, approved bool, customMsg string) {
	ch, err := s.UserChannelCreate(userID)
	if err != nil {
		return
	}
	ctx, cancel := a.b.OpContext(15 * time.Second)
	defer cancel()
	ext := a.b.DB.GetExtendedConfig(ctx, guildID)
	color := embedColor(ext.EmbedColor)
	embed := buildEmbed(color, "Resultado da Whitelist", customMsg, "")
	_, _ = s.ChannelMessageSendEmbed(ch.ID, embed)
}

func (a *Allowlist) WhitelistPending(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ctx, cancel := a.b.OpContext(15 * time.Second)
	defer cancel()
	cfg, _ := a.b.DB.GetGuildConfig(ctx, i.GuildID)
	if !a.canReview(s, i, cfg) {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Apenas a equipe pode ver aplicações pendentes."))
		return
	}
	ids, err := a.b.DB.GetPendingTheoryPassedApplicationIDs(ctx, i.GuildID)
	if err != nil {
		_ = s.InteractionRespond(i.Interaction, ephemeral("DB error."))
		return
	}
	if len(ids) == 0 {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Nenhuma aplicação pendente."))
		return
	}
	sb := &strings.Builder{}
	fmt.Fprintf(sb, "Aplicações pendentes: %d\n", len(ids))
	for _, id := range ids {
		fmt.Fprintf(sb, "- ID %d\n", id)
	}
	_ = s.InteractionRespond(i.Interaction, ephemeral(sb.String()))
}

func (a *Allowlist) WhitelistSkip(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ctx, cancel := a.b.OpContext(15 * time.Second)
	defer cancel()
	opts := i.ApplicationCommandData().Options
	if len(opts) == 0 {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Especifique o usuário."))
		return
	}
	userID := opts[0].UserValue(s).ID
	app, err := a.b.DB.GetPendingApplication(ctx, i.GuildID, userID)
	if err != nil || app == nil {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Nenhuma aplicação ativa para esse usuário."))
		return
	}
	questions := a.getQuestions(ctx, i.GuildID)
	now := time.Now()
	next := app.CurrentQuestion + 1

	// Marcar quiz pulado como errado
	qs := app.QuizState
	_, q := quiz.Resolve(&qs, questions, app.CurrentQuestion)
	if q.Type == "quiz" && len(q.Options) > 0 {
		qs.Results[q.Field] = false
		_ = a.b.LogDBErr("UpdateApplicationQuizState", a.b.DB.UpdateApplicationQuizState(ctx, app.ID, &qs))
	}

	if next >= len(questions) {
		app.QuizState = qs
		_, _ = s.ChannelMessageSend(app.ChannelID, "Pergunta pulada.")
		a.finishApplication(ctx, s, app, questions)
	} else {
		_ = a.b.LogDBErr("UpdateApplicationProgress", a.b.DB.UpdateApplicationProgress(ctx, app.ID, app.Answers, next, &now))
		_, nextQ := quiz.Resolve(&qs, questions, next)
		msg := "Pergunta pulada.\n" + quiz.FormatQuestion(next+1, nextQ, &qs)
		_, _ = s.ChannelMessageSend(app.ChannelID, msg)
	}
	_ = s.InteractionRespond(i.Interaction, ephemeral("Pulado."))
}

func (a *Allowlist) StartTimeoutWatcher(ctx context.Context, log *slog.Logger) {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				a.checkTimeouts(ctx, log)
			}
		}
	}()
}

func (a *Allowlist) checkTimeouts(ctx context.Context, log *slog.Logger) {
	guilds := a.b.Session.State.Guilds
	for _, g := range guilds {
		ids, err := a.b.DB.GetPendingTheoryPassedApplicationIDs(ctx, g.ID)
		if err != nil {
			continue
		}
		for _, id := range ids {
			app, err := a.b.DB.GetApplicationByID(ctx, id)
			if err != nil || app == nil {
				continue
			}
			// Apenas aplicações ainda em preenchimento expiram.
			if app.Status != "pending" {
				continue
			}
			if app.QuestionStartedAt == nil {
				continue
			}

			// Antes do "iniciar" o prazo é maior; durante as perguntas o timer
			// reseta a cada mensagem do usuário (question_started_at é tocado).
			warnAfter, killAfter := answerWarnAfter, answerKillAfter
			warnMsg := fmt.Sprintf(
				"⚠️ <@%s> Você está há **1 minuto** sem responder. Em **1 minuto**, este chat será apagado e você terá que tentar novamente.",
				app.UserID)
			if app.CurrentQuestion == -1 {
				warnAfter, killAfter = preStartWarnAfter, preStartKillAfter
				warnMsg = fmt.Sprintf(
					"⚠️ <@%s> Você ainda não iniciou a whitelist. Este canal será fechado em **2 minutos** se você não digitar **iniciar**.",
					app.UserID)
			}

			idle := time.Since(*app.QuestionStartedAt)
			switch {
			case idle > killAfter:
				if err := a.b.DB.UpdateApplicationStatus(ctx, app.ID, "timed_out"); err != nil {
					log.Error("falha ao expirar aplicação", "id", app.ID, "err", err)
					continue
				}
				a.cache.Remove(app.ChannelID)
				a.clearWarned(app.ID)
				_, _ = a.b.Session.ChannelMessageSend(app.ChannelID, fmt.Sprintf(
					"⏳ <@%s> Sua whitelist foi cancelada por inatividade. Este canal será apagado em **30 segundos**. Você poderá tentar novamente.",
					app.UserID))
				a.deleteChannelAfter(a.b.Session, app.ChannelID, deleteAfterTimeout)
				log.Info("application timed out", "id", app.ID, "user", app.UserID)
			case idle > warnAfter:
				if !a.wasWarned(app.ID, *app.QuestionStartedAt) {
					a.markWarned(app.ID, *app.QuestionStartedAt)
					_, _ = a.b.Session.ChannelMessageSend(app.ChannelID, warnMsg)
				}
			}
		}
	}
}
