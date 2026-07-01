package db

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Pool struct {
	pool  *pgxpool.Pool
	botID string
}

func (p *Pool) SetBotID(id string) { p.botID = id }

func New(ctx context.Context, dsn string) (*Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse dsn: %w", err)
	}
	cfg.MaxConns = 20
	cfg.MinConns = 2
	cfg.MaxConnLifetime = 30 * time.Minute
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}
	if err := p.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return &Pool{pool: p}, nil
}

func (p *Pool) Close() { p.pool.Close() }

// ---------------------------------------------------------------------------
// Guild config (public schema — gerenciado pelo bot via /config)
// ---------------------------------------------------------------------------

func (p *Pool) GetGuildConfig(ctx context.Context, guildID string) (*GuildConfig, error) {
	row := p.pool.QueryRow(ctx, `
		SELECT guild_id, log_channel_id, ticket_category_id, ticket_log_channel_id,
		       whitelist_channel_id, whitelist_log_channel_id,
		       COALESCE(whitelist_approved_channel_id, ''),
		       COALESCE(whitelist_rejected_channel_id, ''),
		       whitelist_role_id,
		       COALESCE(whitelist_rejected_role_id, ''),
		       verified_role_id, staff_role_id, admin_role_id,
		       max_tickets_per_user, ticket_prefix, whitelist_pass_message,
		       whitelist_fail_message, welcome_message,
		       COALESCE(whitelist_pass_score, 80),
		       COALESCE(panel_configs, '{}'),
		       created_at, updated_at
		FROM guild_configs WHERE guild_id = $1`, guildID)
	var g GuildConfig
	var panelJSON []byte
	err := row.Scan(
		&g.GuildID, &g.LogChannelID, &g.TicketCategoryID, &g.TicketLogChannelID,
		&g.WhitelistChannelID, &g.WhitelistLogChannelID,
		&g.WhitelistApprovedChannelID, &g.WhitelistRejectedChannelID,
		&g.WhitelistRoleID, &g.WhitelistRejectedRoleID,
		&g.VerifiedRoleID, &g.StaffRoleID, &g.AdminRoleID,
		&g.MaxTicketsPerUser, &g.TicketPrefix, &g.WhitelistPassMessage,
		&g.WhitelistFailMessage, &g.WelcomeMessage, &g.WhitelistPassScore,
		&panelJSON, &g.CreatedAt, &g.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(panelJSON, &g.PanelConfigs)
	return &g, nil
}

func (p *Pool) SetGuildConfigField(ctx context.Context, guildID, field, value string) error {
	allowed := map[string]bool{
		"log_channel_id": true, "ticket_category_id": true, "ticket_log_channel_id": true,
		"whitelist_channel_id": true, "whitelist_log_channel_id": true, "whitelist_role_id": true,
		"verified_role_id": true, "staff_role_id": true, "admin_role_id": true,
		"max_tickets_per_user": true, "ticket_prefix": true, "whitelist_pass_message": true,
		"whitelist_fail_message": true, "welcome_message": true,
	}
	if !allowed[field] {
		return fmt.Errorf("unknown field: %s", field)
	}
	_, err := p.pool.Exec(ctx, fmt.Sprintf(`
		INSERT INTO guild_configs (guild_id, %s, created_at, updated_at)
		VALUES ($1, $2, NOW(), NOW())
		ON CONFLICT (guild_id) DO UPDATE SET %s = EXCLUDED.%s, updated_at = NOW()`,
		field, field, field), guildID, value)
	return err
}

// ---------------------------------------------------------------------------
// Extended config (site schema — gerenciado pelo painel admin)
// ---------------------------------------------------------------------------

// GetExtendedConfig lê as configurações visuais/DM da tabela site.guild_configs.
// Retorna valores padrão se não encontrado.
func (p *Pool) GetExtendedConfig(ctx context.Context, guildID string) ExtendedConfig {
	const defaultColor = 0x8B0000
	cfg := ExtendedConfig{EmbedColor: defaultColor, DmNotifyDefault: true}

	row := p.pool.QueryRow(ctx, `
		SELECT
			COALESCE(embed_color, $2),
			COALESCE(ticket_image_url, ''),
			COALESCE(welcome_image_url, ''),
			COALESCE(dm_notify_default, true)
		FROM site.guild_configs
		WHERE guild_id = $1
		LIMIT 1`, guildID, defaultColor)

	_ = row.Scan(&cfg.EmbedColor, &cfg.TicketImageURL, &cfg.WelcomeImageURL, &cfg.DmNotifyDefault)
	return cfg
}

// ---------------------------------------------------------------------------
// Bot actions (site schema — enfileiradas pelo painel, consumidas pelo bot)
// ---------------------------------------------------------------------------

func (p *Pool) FetchPendingActions(ctx context.Context) ([]BotAction, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id, guild_id, action_type, payload, status, result, created_at, processed_at
		FROM site.bot_actions
		WHERE status = 'pending'
		ORDER BY created_at ASC
		LIMIT 20`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var actions []BotAction
	for rows.Next() {
		var a BotAction
		var payloadJSON []byte
		if err := rows.Scan(&a.ID, &a.GuildID, &a.ActionType, &payloadJSON,
			&a.Status, &a.Result, &a.CreatedAt, &a.ProcessedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(payloadJSON, &a.Payload)
		actions = append(actions, a)
	}
	return actions, rows.Err()
}

func (p *Pool) CompleteAction(ctx context.Context, id int64, success bool, result string) error {
	status := "done"
	if !success {
		status = "failed"
	}
	_, err := p.pool.Exec(ctx, `
		UPDATE site.bot_actions
		SET status = $2, result = $3, processed_at = NOW()
		WHERE id = $1`, id, status, result)
	return err
}

// ---------------------------------------------------------------------------
// Whitelist questions (lidas da tabela site.whitelist_questions via guild_id)
// ---------------------------------------------------------------------------

// GetWhitelistQuestionsByGuild retorna as perguntas configuradas no painel para
// o bot. Retorna lista vazia se bot_id não foi resolvido ou não há perguntas.
func (p *Pool) GetWhitelistQuestionsByGuild(ctx context.Context, _ string) ([]QuizQuestion, error) {
	if p.botID == "" {
		return nil, nil
	}
	rows, err := p.pool.Query(ctx, `
		SELECT question_text, field_key,
		       COALESCE(question_type, 'open'),
		       COALESCE(options, '[]'::jsonb),
		       COALESCE(correct_index, 0)
		FROM site.whitelist_questions
		WHERE bot_id = $1
		ORDER BY order_index ASC`, p.botID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var qs []QuizQuestion
	for rows.Next() {
		var q QuizQuestion
		var optionsJSON []byte
		if err := rows.Scan(&q.Q, &q.Field, &q.Type, &optionsJSON, &q.CorrectIndex); err != nil {
			continue
		}
		_ = json.Unmarshal(optionsJSON, &q.Options)
		qs = append(qs, q)
	}
	return qs, rows.Err()
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

func (p *Pool) GetTicketByChannelID(ctx context.Context, channelID string) (*Ticket, error) {
	row := p.pool.QueryRow(ctx, `
		SELECT id, guild_id, channel_id, user_id, ticket_number, category,
		       status, claimed_staff, dm_notify, created_at, closed_at, close_reason
		FROM tickets WHERE channel_id = $1`, channelID)
	return scanTicket(row)
}

func (p *Pool) GetTicketByID(ctx context.Context, id int64) (*Ticket, error) {
	row := p.pool.QueryRow(ctx, `
		SELECT id, guild_id, channel_id, user_id, ticket_number, category,
		       status, claimed_staff, dm_notify, created_at, closed_at, close_reason
		FROM tickets WHERE id = $1`, id)
	return scanTicket(row)
}

func (p *Pool) NextTicketNumber(ctx context.Context, guildID string) (int, error) {
	var n int
	err := p.pool.QueryRow(ctx,
		`SELECT COALESCE(MAX(ticket_number), 0) + 1 FROM tickets WHERE guild_id = $1`,
		guildID).Scan(&n)
	return n, err
}

func (p *Pool) InsertTicket(ctx context.Context, t *Ticket) (int64, error) {
	staffJSON, err := EncodeClaimedStaff(t.ClaimedStaff)
	if err != nil {
		return 0, err
	}
	var id int64
	err = p.pool.QueryRow(ctx, `
		INSERT INTO tickets (guild_id, channel_id, user_id, ticket_number, category,
		                     status, claimed_staff, dm_notify, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING id`,
		t.GuildID, t.ChannelID, t.UserID, t.TicketNumber, t.Category,
		t.Status, staffJSON, t.DmNotify).Scan(&id)
	return id, err
}

func (p *Pool) CloseTicket(ctx context.Context, id int64, reason string) error {
	_, err := p.pool.Exec(ctx,
		`UPDATE tickets SET status='closed', closed_at=NOW(), close_reason=$2 WHERE id=$1`,
		id, reason)
	return err
}

func (p *Pool) SetTicketDmNotify(ctx context.Context, id int64, notify bool) error {
	_, err := p.pool.Exec(ctx,
		`UPDATE tickets SET dm_notify=$2 WHERE id=$1`, id, notify)
	return err
}

func (p *Pool) UpdateTicketClaimedStaff(ctx context.Context, id int64, staff []ClaimedStaffEntry) error {
	staffJSON, err := EncodeClaimedStaff(staff)
	if err != nil {
		return err
	}
	_, err = p.pool.Exec(ctx,
		`UPDATE tickets SET claimed_staff=$2 WHERE id=$1`, id, staffJSON)
	return err
}

// ListOpenTicketChannelIDs retorna os channel_id de todos os tickets ainda
// abertos/assumidos (usado para aquecer o ChannelCache no startup).
func (p *Pool) ListOpenTicketChannelIDs(ctx context.Context) ([]string, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT channel_id FROM tickets WHERE status IN ('open','claimed') AND channel_id <> ''`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanStringColumn(rows)
}

func (p *Pool) CountOpenTicketsForUser(ctx context.Context, guildID, userID string) (int, error) {
	var n int
	err := p.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM tickets WHERE guild_id=$1 AND user_id=$2 AND status IN ('open','claimed')`,
		guildID, userID).Scan(&n)
	return n, err
}

func (p *Pool) InsertTicketMessage(ctx context.Context, m *TicketMessage) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO ticket_messages (ticket_id, author_id, author_name, content, attachments, created_at)
		VALUES ($1,$2,$3,$4,$5,NOW())`,
		m.TicketID, m.AuthorID, m.AuthorName, m.Content, m.Attachments)
	return err
}

// ListTicketMessages retorna o histórico de mensagens de um ticket (para transcript).
func (p *Pool) ListTicketMessages(ctx context.Context, ticketID int64) ([]TicketMessage, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id, ticket_id, author_id, author_name, content, attachments, created_at
		FROM ticket_messages WHERE ticket_id=$1 ORDER BY created_at ASC`, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TicketMessage
	for rows.Next() {
		var m TicketMessage
		if err := rows.Scan(&m.ID, &m.TicketID, &m.AuthorID, &m.AuthorName, &m.Content, &m.Attachments, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Allowlist applications
// ---------------------------------------------------------------------------

func (p *Pool) GetPendingApplication(ctx context.Context, guildID, userID string) (*AllowlistApplication, error) {
	row := p.pool.QueryRow(ctx, `
		SELECT id, guild_id, user_id, channel_id, app_number, status,
		       answers, current_question, COALESCE(quiz_state, '{}'),
		       started_at, question_started_at,
		       reviewed_by, review_note, created_at, updated_at
		FROM allowlist_applications
		WHERE guild_id=$1 AND user_id=$2 AND status IN ('pending','theory_passed')
		ORDER BY created_at DESC LIMIT 1`, guildID, userID)
	return scanApplication(row)
}

func (p *Pool) GetApplicationByID(ctx context.Context, id int64) (*AllowlistApplication, error) {
	row := p.pool.QueryRow(ctx, `
		SELECT id, guild_id, user_id, channel_id, app_number, status,
		       answers, current_question, COALESCE(quiz_state, '{}'),
		       started_at, question_started_at,
		       reviewed_by, review_note, created_at, updated_at
		FROM allowlist_applications WHERE id=$1`, id)
	return scanApplication(row)
}

func (p *Pool) GetApplicationByChannelAndUser(ctx context.Context, channelID, userID string) (*AllowlistApplication, error) {
	row := p.pool.QueryRow(ctx, `
		SELECT id, guild_id, user_id, channel_id, app_number, status,
		       answers, current_question, COALESCE(quiz_state, '{}'),
		       started_at, question_started_at,
		       reviewed_by, review_note, created_at, updated_at
		FROM allowlist_applications
		WHERE channel_id=$1 AND user_id=$2 AND status IN ('pending','theory_passed')
		ORDER BY created_at DESC LIMIT 1`, channelID, userID)
	return scanApplication(row)
}

func (p *Pool) GetPendingTheoryPassedApplicationIDs(ctx context.Context, guildID string) ([]int64, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT id FROM allowlist_applications WHERE guild_id=$1 AND status IN ('pending','theory_passed')`,
		guildID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ListActiveApplicationChannelIDs retorna os channel_id de aplicações ainda em
// preenchimento (status 'pending'). Usado para aquecer o ChannelCache.
func (p *Pool) ListActiveApplicationChannelIDs(ctx context.Context) ([]string, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT channel_id FROM allowlist_applications WHERE status = 'pending' AND channel_id <> ''`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanStringColumn(rows)
}

func (p *Pool) NextWhitelistNumber(ctx context.Context, guildID string) (int, error) {
	var n int
	err := p.pool.QueryRow(ctx,
		`SELECT COALESCE(MAX(app_number),0)+1 FROM allowlist_applications WHERE guild_id=$1`,
		guildID).Scan(&n)
	return n, err
}

func (p *Pool) InsertApplication(ctx context.Context, a *AllowlistApplication) (int64, error) {
	answersJSON, _ := json.Marshal(a.Answers)
	quizJSON, _ := json.Marshal(a.QuizState)
	var id int64
	err := p.pool.QueryRow(ctx, `
		INSERT INTO allowlist_applications
		  (guild_id, user_id, channel_id, app_number, status, answers,
		   current_question, quiz_state, started_at, question_started_at, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) RETURNING id`,
		a.GuildID, a.UserID, a.ChannelID, a.AppNumber, a.Status, answersJSON,
		a.CurrentQuestion, quizJSON, a.StartedAt, a.QuestionStartedAt).Scan(&id)
	return id, err
}

func (p *Pool) UpdateApplicationQuizState(ctx context.Context, id int64, qs *QuizState) error {
	data, _ := json.Marshal(qs)
	_, err := p.pool.Exec(ctx,
		`UPDATE allowlist_applications SET quiz_state=$2, updated_at=NOW() WHERE id=$1`,
		id, data)
	return err
}

func (p *Pool) UpdateApplicationProgress(ctx context.Context, id int64, answers map[string]string, currentQuestion int, questionStartedAt *time.Time) error {
	answersJSON, _ := json.Marshal(answers)
	_, err := p.pool.Exec(ctx, `
		UPDATE allowlist_applications
		SET answers=$2, current_question=$3, question_started_at=$4, updated_at=NOW()
		WHERE id=$1`, id, answersJSON, currentQuestion, questionStartedAt)
	return err
}

func (p *Pool) UpdateApplicationStatus(ctx context.Context, id int64, status string) error {
	_, err := p.pool.Exec(ctx,
		`UPDATE allowlist_applications SET status=$2, updated_at=NOW() WHERE id=$1`,
		id, status)
	return err
}

func (p *Pool) FinalizeApplicationReview(ctx context.Context, id int64, status, reviewedBy, reviewNote string) error {
	_, err := p.pool.Exec(ctx, `
		UPDATE allowlist_applications
		SET status=$2, reviewed_by=$3, review_note=$4, updated_at=NOW()
		WHERE id=$1`, id, status, reviewedBy, reviewNote)
	return err
}

// ---------------------------------------------------------------------------
// Bot status heartbeat (site schema — escrito pelo bot, lido pelo painel)
// ---------------------------------------------------------------------------

// CreateCaptchaVerification cria uma verificação pendente em site.captcha_verifications.
// O usuário resolve o captcha em auth.daniloc.work/v/<token>; o backend marca
// verificado e enfileira a ação verify_captcha que dá o cargo.
func (p *Pool) CreateCaptchaVerification(ctx context.Context, token, guildID, userID, username string) error {
	_, err := p.pool.Exec(ctx,
		`INSERT INTO site.captcha_verifications (token, guild_id, user_id, username) VALUES ($1, $2, $3, $4)`,
		token, guildID, userID, username)
	return err
}

// ResolveBotID resolve o UUID do bot na tabela site.bots pelo token Discord.
func (p *Pool) ResolveBotID(ctx context.Context, token string) (string, error) {
	// Lookup primário por hash determinístico (a coluna `token` pode estar
	// encriptada em repouso, então não dá para comparar texto puro com ela).
	sum := sha256.Sum256([]byte(token))
	hash := hex.EncodeToString(sum[:])
	var id string
	if err := p.pool.QueryRow(ctx,
		`SELECT id FROM site.bots WHERE token_hash = $1 LIMIT 1`, hash).Scan(&id); err == nil {
		return id, nil
	}
	// Fallback para linhas legadas (token em texto puro, sem token_hash) ou
	// caso a coluna token_hash ainda não exista no banco.
	if err := p.pool.QueryRow(ctx,
		`SELECT id FROM site.bots WHERE token = $1 LIMIT 1`, token).Scan(&id); err != nil {
		return "", fmt.Errorf("resolve bot id: %w", err)
	}
	return id, nil
}

// UpsertBotStatus atualiza last_seen_at e métricas do bot em site.bot_status.
func (p *Pool) UpsertBotStatus(ctx context.Context, botID string, startedAt time.Time, latencyMs int64, guildsCount int) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO site.bot_status (bot_id, status, last_seen_at, started_at, latency_ms, guilds_count)
		VALUES ($1, 'online', NOW(), $2, $3, $4)
		ON CONFLICT (bot_id) DO UPDATE SET
			status       = 'online',
			last_seen_at = NOW(),
			started_at   = EXCLUDED.started_at,
			latency_ms   = EXCLUDED.latency_ms,
			guilds_count = EXCLUDED.guilds_count`,
		botID, startedAt, int(latencyMs), guildsCount)
	return err
}

// ClearRestartRequest zera o pedido de restart. Chamado no startup: o bot acabou
// de (re)iniciar, então qualquer pedido anterior já foi honrado. Imune a skew de
// relógio (não compara timestamps).
func (p *Pool) ClearRestartRequest(ctx context.Context, botID string) error {
	_, err := p.pool.Exec(ctx,
		`UPDATE site.bot_status SET restart_requested_at = NULL WHERE bot_id = $1`, botID)
	return err
}

// IsRestartRequested retorna true se o painel marcou restart_requested_at depois
// que o bot subiu (após o ClearRestartRequest do startup) — ou seja, pedido novo.
func (p *Pool) IsRestartRequested(ctx context.Context, botID string) (bool, error) {
	var requested bool
	err := p.pool.QueryRow(ctx,
		`SELECT restart_requested_at IS NOT NULL FROM site.bot_status WHERE bot_id = $1`,
		botID).Scan(&requested)
	if err != nil {
		return false, err
	}
	return requested, nil
}

// SetBotOffline marca o bot como offline em public.bot_status (chamado no
// shutdown gracioso para que o painel não precise esperar a janela de stale).
func (p *Pool) SetBotOffline(ctx context.Context, botID string) error {
	_, err := p.pool.Exec(ctx, `
		UPDATE site.bot_status
		SET status = 'offline', last_seen_at = NOW()
		WHERE bot_id = $1`, botID)
	return err
}

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------

func (p *Pool) InsertAuditLog(ctx context.Context, l *AuditLog) error {
	metaJSON, _ := json.Marshal(l.Meta)
	_, err := p.pool.Exec(ctx, `
		INSERT INTO audit_logs (guild_id, actor_id, action, target_id, meta, created_at)
		VALUES ($1,$2,$3,$4,$5,NOW())`,
		l.GuildID, l.ActorID, l.Action, l.TargetID, metaJSON)
	return err
}

func (p *Pool) GetRecentAuditLogs(ctx context.Context, guildID string, limit int) ([]AuditLog, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id, guild_id, actor_id, action, target_id, meta, created_at
		FROM audit_logs WHERE guild_id=$1 ORDER BY created_at DESC LIMIT $2`,
		guildID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var logs []AuditLog
	for rows.Next() {
		var l AuditLog
		var metaJSON []byte
		if err := rows.Scan(&l.ID, &l.GuildID, &l.ActorID, &l.Action, &l.TargetID, &metaJSON, &l.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(metaJSON, &l.Meta)
		logs = append(logs, l)
	}
	return logs, rows.Err()
}

// ---------------------------------------------------------------------------
// Verification attempts
// ---------------------------------------------------------------------------

func (p *Pool) CountVerificationAttempts(ctx context.Context, guildID, userID string, since time.Time) (int, error) {
	var n int
	err := p.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM verification_attempts WHERE guild_id=$1 AND user_id=$2 AND created_at>=$3`,
		guildID, userID, since).Scan(&n)
	return n, err
}

func (p *Pool) InsertVerificationAttempt(ctx context.Context, v *VerificationAttempt) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO verification_attempts (guild_id, user_id, success, created_at)
		VALUES ($1,$2,$3,NOW())`,
		v.GuildID, v.UserID, v.Success)
	return err
}

// ---------------------------------------------------------------------------
// Scan helpers
// ---------------------------------------------------------------------------

type scannable interface {
	Scan(dest ...any) error
}

type rowsScanner interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}

// scanStringColumn lê uma única coluna text de todas as linhas.
func scanStringColumn(rows rowsScanner) ([]string, error) {
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func scanTicket(row scannable) (*Ticket, error) {
	var t Ticket
	var staffJSON []byte
	err := row.Scan(
		&t.ID, &t.GuildID, &t.ChannelID, &t.UserID, &t.TicketNumber, &t.Category,
		&t.Status, &staffJSON, &t.DmNotify, &t.CreatedAt, &t.ClosedAt, &t.CloseReason,
	)
	if err != nil {
		return nil, err
	}
	t.ClaimedStaff, _ = DecodeClaimedStaff(staffJSON)
	return &t, nil
}

func scanApplication(row scannable) (*AllowlistApplication, error) {
	var a AllowlistApplication
	var answersJSON []byte
	var quizJSON []byte
	err := row.Scan(
		&a.ID, &a.GuildID, &a.UserID, &a.ChannelID, &a.AppNumber, &a.Status,
		&answersJSON, &a.CurrentQuestion, &quizJSON,
		&a.StartedAt, &a.QuestionStartedAt,
		&a.ReviewedBy, &a.ReviewNote, &a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(answersJSON, &a.Answers)
	_ = json.Unmarshal(quizJSON, &a.QuizState)
	if a.QuizState.Results == nil {
		a.QuizState.Results = make(map[string]bool)
	}
	if a.QuizState.OptionOrders == nil {
		a.QuizState.OptionOrders = make(map[string][]int)
	}
	return &a, nil
}

func DecodeClaimedStaff(data []byte) ([]ClaimedStaffEntry, error) {
	if len(data) == 0 {
		return nil, nil
	}
	var entries []ClaimedStaffEntry
	err := json.Unmarshal(data, &entries)
	return entries, err
}

func EncodeClaimedStaff(entries []ClaimedStaffEntry) ([]byte, error) {
	if entries == nil {
		return []byte("[]"), nil
	}
	return json.Marshal(entries)
}
