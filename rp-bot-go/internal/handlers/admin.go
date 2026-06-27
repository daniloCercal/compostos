package handlers

import (
	"context"
	"fmt"
	"runtime"
	"strings"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/yourorg/rp-bot/internal/bot"
	"github.com/yourorg/rp-bot/internal/db"
	"github.com/yourorg/rp-bot/internal/services"
)

type Admin struct {
	b        *bot.Bot
	presence *services.PresenceService
	startAt  time.Time
	sync     func(context.Context) error
}

func NewAdmin(b *bot.Bot, ps *services.PresenceService) *Admin {
	return &Admin{b: b, presence: ps, startAt: time.Now()}
}

// SetSync injeta a função que refaz o bulk-overwrite dos slash commands.
// Definida em Register após a montagem da lista de comandos.
func (a *Admin) SetSync(fn func(context.Context) error) { a.sync = fn }

func (a *Admin) Commands() []*discordgo.ApplicationCommand {
	configOpts := []*discordgo.ApplicationCommandOption{
		{Type: discordgo.ApplicationCommandOptionSubCommand, Name: "show", Description: "Show config"},
		{Type: discordgo.ApplicationCommandOptionSubCommand, Name: "set", Description: "Set field",
			Options: []*discordgo.ApplicationCommandOption{
				{Type: discordgo.ApplicationCommandOptionString, Name: "field", Description: "Field", Required: true},
				{Type: discordgo.ApplicationCommandOptionString, Name: "value", Description: "Value", Required: true},
			}},
	}
	brandingOpts := []*discordgo.ApplicationCommandOption{
		{Type: discordgo.ApplicationCommandOptionSubCommand, Name: "show", Description: "Show branding"},
		{Type: discordgo.ApplicationCommandOptionSubCommand, Name: "presence", Description: "Set presence",
			Options: []*discordgo.ApplicationCommandOption{
				{Type: discordgo.ApplicationCommandOptionString, Name: "status", Description: "Status", Required: true},
				{Type: discordgo.ApplicationCommandOptionInteger, Name: "type", Description: "Type 0-5", Required: true},
				{Type: discordgo.ApplicationCommandOptionString, Name: "name", Description: "Name", Required: true},
			}},
		{Type: discordgo.ApplicationCommandOptionSubCommand, Name: "nickname", Description: "Set nickname",
			Options: []*discordgo.ApplicationCommandOption{
				{Type: discordgo.ApplicationCommandOptionString, Name: "nick", Description: "Nick", Required: true},
			}},
	}
	return []*discordgo.ApplicationCommand{
		{Name: "config", Description: "Bot configuration (admin only)",
			DefaultMemberPermissions: int64ptr(discordgo.PermissionAdministrator), Options: configOpts},
		{Name: "health", Description: "Health check (admin only)",
			DefaultMemberPermissions: int64ptr(discordgo.PermissionAdministrator)},
		{Name: "sync", Description: "Sync slash commands (admin only)",
			DefaultMemberPermissions: int64ptr(discordgo.PermissionAdministrator)},
		{Name: "audit_logs", Description: "View audit logs (admin only)",
			DefaultMemberPermissions: int64ptr(discordgo.PermissionAdministrator),
			Options: []*discordgo.ApplicationCommandOption{
				{Type: discordgo.ApplicationCommandOptionInteger, Name: "limit", Description: "Entries"},
			}},
		{Name: "branding", Description: "Bot branding (admin only)",
			DefaultMemberPermissions: int64ptr(discordgo.PermissionAdministrator), Options: brandingOpts},
	}
}

func (a *Admin) Config(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ctx, cancel := a.b.OpContext(15 * time.Second); defer cancel()
	guildID := i.GuildID
	sub := i.ApplicationCommandData().Options[0]
	switch sub.Name {
	case "show":
		cfg, err := a.b.DB.GetGuildConfig(ctx, guildID)
		if err != nil {
			_ = s.InteractionRespond(i.Interaction, ephemeral("No config found."))
			return
		}
		msg := fmt.Sprintf(
			"**Config**\nLog: %s\nTicket Cat: %s\nTicket Log: %s\n"+
			"WL: %s\nWL Log: %s\nWL Role: %s\n"+
			"Verified: %s\nStaff: %s\nAdmin: %s\nMax Tickets: %d\nPrefix: %s",
			channelSummary(s, cfg.LogChannelID), channelSummary(s, cfg.TicketCategoryID),
			channelSummary(s, cfg.TicketLogChannelID), channelSummary(s, cfg.WhitelistChannelID),
			channelSummary(s, cfg.WhitelistLogChannelID), roleSummary(s, guildID, cfg.WhitelistRoleID),
			roleSummary(s, guildID, cfg.VerifiedRoleID), roleSummary(s, guildID, cfg.StaffRoleID),
			roleSummary(s, guildID, cfg.AdminRoleID), cfg.MaxTicketsPerUser, cfg.TicketPrefix,
		)
		_ = s.InteractionRespond(i.Interaction, ephemeral(msg))
	case "set":
		opts := sub.Options
		if len(opts) < 2 {
			_ = s.InteractionRespond(i.Interaction, ephemeral("Provide field and value."))
			return
		}
		field := opts[0].StringValue()
		value := opts[1].StringValue()
		parsed, err := parseConfigValue(field, value)
		if err != nil {
			_ = s.InteractionRespond(i.Interaction, ephemeral("Invalid value: "+err.Error()))
			return
		}
		if err := a.b.DB.SetGuildConfigField(ctx, guildID, field, parsed); err != nil {
			_ = s.InteractionRespond(i.Interaction, ephemeral("DB error: "+err.Error()))
			return
		}
		_ = s.InteractionRespond(i.Interaction, ephemeral(fmt.Sprintf("Set %s = %s", field, parsed)))
	}
}

func (a *Admin) Health(s *discordgo.Session, i *discordgo.InteractionCreate) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	msg := fmt.Sprintf("Uptime: %s | Latency: %dms | Goroutines: %d | Heap: %.1fMB",
		time.Since(a.startAt).Round(time.Second),
		a.b.Session.HeartbeatLatency().Milliseconds(),
		runtime.NumGoroutine(), float64(m.HeapAlloc)/1024/1024)
	_ = s.InteractionRespond(i.Interaction, ephemeral(msg))
}

func (a *Admin) AuditLogs(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ctx, cancel := a.b.OpContext(15 * time.Second); defer cancel()
	limit := 10
	opts := i.ApplicationCommandData().Options
	if len(opts) > 0 {
		limit = int(opts[0].IntValue())
		if limit > 20 { limit = 20 }
	}
	logs, err := a.b.DB.GetRecentAuditLogs(ctx, i.GuildID, limit)
	if err != nil {
		_ = s.InteractionRespond(i.Interaction, ephemeral("DB error."))
		return
	}
	if len(logs) == 0 {
		_ = s.InteractionRespond(i.Interaction, ephemeral("No audit log entries."))
		return
	}
	sb := &strings.Builder{}
	for _, l := range logs {
		target := ""
		if l.TargetID != nil { target = " -> " + *l.TargetID }
		fmt.Fprintf(sb, "%s <@%s> %s%s\n", l.CreatedAt.Format("01/02 15:04"), l.ActorID, l.Action, target)
	}
	_ = s.InteractionRespond(i.Interaction, ephemeral(sb.String()))
}

func (a *Admin) Branding(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ctx, cancel := a.b.OpContext(15 * time.Second); defer cancel()
	sub := i.ApplicationCommandData().Options[0]
	switch sub.Name {
	case "show":
		a.presence.Apply(a.b.Session.HeartbeatLatency().Milliseconds())
		_ = s.InteractionRespond(i.Interaction, ephemeral("Presence refreshed."))
	case "presence":
		opts := sub.Options
		if len(opts) < 3 {
			_ = s.InteractionRespond(i.Interaction, ephemeral("Provide status, type, name."))
			return
		}
		p := services.PresencePayload{Status: opts[0].StringValue(), Type: int(opts[1].IntValue()), Name: opts[2].StringValue()}
		if err := a.presence.Persist(ctx, p); err != nil {
			_ = s.InteractionRespond(i.Interaction, ephemeral("Redis error."))
			return
		}
		a.presence.Apply(a.b.Session.HeartbeatLatency().Milliseconds())
		_ = s.InteractionRespond(i.Interaction, ephemeral("Presence updated."))
	case "nickname":
		if len(sub.Options) == 0 {
			_ = s.InteractionRespond(i.Interaction, ephemeral("Provide nickname."))
			return
		}
		nick := sub.Options[0].StringValue()
		if err := s.GuildMemberNickname(i.GuildID, "@me", nick); err != nil {
			_ = s.InteractionRespond(i.Interaction, ephemeral("Failed to set nickname."))
			return
		}
		_ = a.b.LogDBErr("InsertAuditLog", a.b.DB.InsertAuditLog(ctx, &db.AuditLog{
			GuildID: i.GuildID, ActorID: i.Member.User.ID,
			Action: "branding.nickname", Meta: map[string]any{"nick": nick},
		}))
		_ = s.InteractionRespond(i.Interaction, ephemeral("Nickname updated."))
	}
}

// Sync refaz o registro (bulk-overwrite) dos slash commands no Discord.
func (a *Admin) Sync(s *discordgo.Session, i *discordgo.InteractionCreate) {
	if a.sync == nil {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Sincronização indisponível."))
		return
	}
	ctx, cancel := a.b.OpContext(15 * time.Second)
	defer cancel()
	if err := a.sync(ctx); err != nil {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Falha ao sincronizar: "+err.Error()))
		return
	}
	_ = s.InteractionRespond(i.Interaction, ephemeral("Comandos sincronizados."))
}
