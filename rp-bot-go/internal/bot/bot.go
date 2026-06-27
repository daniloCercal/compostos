package bot

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/getsentry/sentry-go"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/redis/go-redis/v9"
	"github.com/yourorg/rp-bot/internal/config"
	"github.com/yourorg/rp-bot/internal/db"
)

var (
	MetricCommands = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "bot_commands_total",
		Help: "Slash commands invoked",
	}, []string{"command", "guild"})

	MetricTickets = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "bot_tickets_total",
		Help: "Tickets created",
	}, []string{"category", "guild"})

	MetricVerifications = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "bot_verifications_total",
		Help: "Verification attempts",
	}, []string{"result", "guild"})

	MetricLatency = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "bot_interaction_duration_seconds",
		Help:    "Interaction handler latency",
		Buckets: prometheus.DefBuckets,
	}, []string{"type"})
)

type Bot struct {
	Session *discordgo.Session
	DB      *db.Pool
	Redis   *redis.Client
	Cfg     *config.Config
	Log     *slog.Logger
	// Ctx é o contexto-raiz do processo, cancelado no shutdown. Operações de
	// handlers derivam dele (via OpContext) para que sejam canceladas ao sair.
	Ctx context.Context
}

// OpContext deriva um contexto com timeout a partir do contexto-raiz do bot.
// Garante que chamadas de DB/REST não fiquem penduradas indefinidamente e que
// sejam canceladas no shutdown. Use sempre com `defer cancel()`.
func (b *Bot) OpContext(timeout time.Duration) (context.Context, context.CancelFunc) {
	base := b.Ctx
	if base == nil {
		base = context.Background()
	}
	return context.WithTimeout(base, timeout)
}

// LogDBErr registra (e reporta ao Sentry) uma falha de escrita no banco que de
// outra forma seria engolida. Retorna o próprio erro para encadear. No-op se err==nil.
func (b *Bot) LogDBErr(op string, err error) error {
	if err == nil {
		return nil
	}
	b.Log.Error("falha em operação de banco", "op", op, "err", err)
	if hub := sentry.CurrentHub(); hub != nil {
		hub.CaptureException(err)
	}
	return err
}

func New(cfg *config.Config, database *db.Pool, rdb *redis.Client, log *slog.Logger) (*Bot, error) {
	s, err := discordgo.New("Bot " + cfg.DiscordToken)
	if err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}
	s.Identify.Intents = discordgo.IntentsGuilds |
		discordgo.IntentsGuildMembers |
		discordgo.IntentsGuildMessages |
		discordgo.IntentsGuildMessageReactions |
		discordgo.IntentsDirectMessages |
		discordgo.IntentsGuildPresences |
		discordgo.IntentMessageContent // necessário p/ ler respostas do quiz e logar mensagens de ticket
	s.State.TrackChannels = true
	s.State.TrackMembers = true
	return &Bot{Session: s, DB: database, Redis: rdb, Cfg: cfg, Log: log}, nil
}

func (b *Bot) Open() error {
	return b.Session.Open()
}

func (b *Bot) Close() error {
	return b.Session.Close()
}

func (b *Bot) SyncCommands(ctx context.Context, cmds []*discordgo.ApplicationCommand) error {
	_, err := b.Session.ApplicationCommandBulkOverwrite(b.Session.State.User.ID, "", cmds)
	if err != nil {
		return fmt.Errorf("bulk overwrite commands: %w", err)
	}
	b.Log.Info("commands synced", "count", len(cmds))
	return nil
}
