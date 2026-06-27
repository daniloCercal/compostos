package handlers

import (
	"context"
	"log/slog"
	"runtime/debug"
	"strings"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/getsentry/sentry-go"
	"github.com/yourorg/rp-bot/internal/bot"
	"github.com/yourorg/rp-bot/internal/services"
)

// Register registra os handlers de interação e retorna os comandos e uma função
// StartPollers que deve ser chamada APÓS b.Open() para iniciar os goroutines
// que dependem da sessão Discord aberta.
func Register(b *bot.Bot) ([]*discordgo.ApplicationCommand, func(ctx context.Context)) {
	ps := services.NewPresenceService(b.Redis, b.Session, b.Log)
	cache := services.NewChannelCache()

	v := NewVerification(b)
	t := NewTickets(b, cache)
	al := NewAllowlist(b, cache)
	a := NewAdmin(b, ps)

	b.Session.AddHandler(func(s *discordgo.Session, m *discordgo.MessageCreate) {
		defer recoverMessage(b.Log)
		t.OnMessage(s, m)
		al.OnMessage(s, m)
	})

	b.Session.AddHandler(func(s *discordgo.Session, i *discordgo.InteractionCreate) {
		start := time.Now()
		defer func() {
			bot.MetricLatency.WithLabelValues(interactionType(i)).Observe(time.Since(start).Seconds())
		}()
		defer recoverInteraction(s, i, b.Log)

		switch i.Type {
		case discordgo.InteractionApplicationCommand:
			name := i.ApplicationCommandData().Name
			bot.MetricCommands.WithLabelValues(name, i.GuildID).Inc()
			switch name {
			case "verify":
				v.Verify(s, i)
			case "verification_panel":
				v.VerificationPanel(s, i)
			case "verification_stats":
				v.VerificationStats(s, i)
			case "tickets_panel":
				t.TicketsPanel(s, i)
			case "ticket_close":
				t.TicketClose(s, i)
			case "ticket_claim":
				t.TicketClaim(s, i)
			case "ticket_unclaim":
				t.TicketUnclaim(s, i)
			case "whitelist":
				al.HandleStartButton(s, i)
			case "whitelist_panel":
				al.WhitelistPanel(s, i)
			case "whitelist_pending":
				al.WhitelistPending(s, i)
			case "whitelist_skip":
				al.WhitelistSkip(s, i)
			case "config":
				a.Config(s, i)
			case "health":
				a.Health(s, i)
			case "audit_logs":
				a.AuditLogs(s, i)
			case "branding":
				a.Branding(s, i)
			case "sync":
				a.Sync(s, i)
			}

		case discordgo.InteractionMessageComponent:
			customID := i.MessageComponentData().CustomID
			switch {
			case customID == "verification:verify_button":
				v.HandleVerifyButton(s, i)
			case customID == "ticket:category_select":
				t.HandleCategorySelect(s, i)
			case strings.HasPrefix(customID, "ticket:close:"):
				t.HandleCloseButton(s, i)
			case strings.HasPrefix(customID, "ticket:claim:"):
				t.HandleClaimButton(s, i)
			case strings.HasPrefix(customID, "ticket:dm_toggle:"):
				t.HandleDmToggleButton(s, i)
			case customID == "whitelist:start_button":
				al.HandleStartButton(s, i)
			case strings.HasPrefix(customID, "whitelist:approve:"):
				al.HandleApproveButton(s, i)
			case strings.HasPrefix(customID, "whitelist:reject:"):
				al.HandleRejectButton(s, i)
			}

		case discordgo.InteractionModalSubmit:
			customID := i.ModalSubmitData().CustomID
			switch {
			case strings.HasPrefix(customID, "ticket:close_reason_modal:"):
				t.HandleCloseModal(s, i)
			}
		}
	})

	var cmds []*discordgo.ApplicationCommand
	cmds = append(cmds, v.Command(), v.PanelCommand(), v.StatsCommand())
	cmds = append(cmds, t.Commands()...)
	cmds = append(cmds, al.Commands()...)
	cmds = append(cmds, a.Commands()...)

	// Todos os comandos são guild-only: desabilita uso em DM, onde i.Member é
	// nil e os handlers entrariam em panic. Fix na raiz, no registro.
	for _, c := range cmds {
		if c.DMPermission == nil {
			c.DMPermission = boolPtr(false)
		}
	}

	// Permite que /sync refaça o bulk-overwrite dos comandos sem reiniciar.
	a.SetSync(func(ctx context.Context) error { return b.SyncCommands(ctx, cmds) })

	startPollers := func(ctx context.Context) {
		warmChannelCache(ctx, b, cache)
		_ = ps.Load(ctx)
		ps.StartUpdater(ctx)
		al.StartTimeoutWatcher(ctx, b.Log)
		StartActionsPoller(ctx, b, ps, b.Log)
	}

	return cmds, startPollers
}

// warmChannelCache popula o ChannelCache a partir do banco. Só marca o cache
// como pronto se ambas as leituras tiverem sucesso — em caso de erro, o cache
// permanece frio e os handlers caem no fallback ao banco (sem regressão).
func warmChannelCache(ctx context.Context, b *bot.Bot, cache *services.ChannelCache) {
	tickets, err := b.DB.ListOpenTicketChannelIDs(ctx)
	if err != nil {
		b.Log.Warn("warm channel cache: tickets", "err", err)
		return
	}
	apps, err := b.DB.ListActiveApplicationChannelIDs(ctx)
	if err != nil {
		b.Log.Warn("warm channel cache: applications", "err", err)
		return
	}
	cache.Warm(tickets, apps)
	b.Log.Info("channel cache aquecido", "tickets", len(tickets), "apps", len(apps))
}

// recoverInteraction captura panics em handlers de interação, reporta ao Sentry
// e tenta responder ao usuário com uma mensagem de erro (best-effort).
func recoverInteraction(s *discordgo.Session, i *discordgo.InteractionCreate, log *slog.Logger) {
	r := recover()
	if r == nil {
		return
	}
	log.Error("panic em handler de interação", "panic", r, "type", interactionType(i), "stack", string(debug.Stack()))
	if hub := sentry.CurrentHub(); hub != nil {
		hub.Recover(r)
		sentry.Flush(2 * time.Second)
	}
	// Pode falhar se a interação já foi respondida — é aceitável.
	_ = s.InteractionRespond(i.Interaction, ephemeral("Ocorreu um erro interno. Tente novamente."))
}

// recoverMessage captura panics em handlers de MessageCreate.
func recoverMessage(log *slog.Logger) {
	r := recover()
	if r == nil {
		return
	}
	log.Error("panic em handler de mensagem", "panic", r, "stack", string(debug.Stack()))
	if hub := sentry.CurrentHub(); hub != nil {
		hub.Recover(r)
		sentry.Flush(2 * time.Second)
	}
}

func interactionType(i *discordgo.InteractionCreate) string {
	switch i.Type {
	case discordgo.InteractionApplicationCommand:
		return "command"
	case discordgo.InteractionMessageComponent:
		return "component"
	case discordgo.InteractionModalSubmit:
		return "modal"
	default:
		return "other"
	}
}
