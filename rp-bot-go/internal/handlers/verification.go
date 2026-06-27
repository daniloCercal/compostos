package handlers

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/yourorg/rp-bot/internal/bot"
	"github.com/yourorg/rp-bot/internal/db"
)

type Verification struct{ b *bot.Bot }

func NewVerification(b *bot.Bot) *Verification { return &Verification{b: b} }

func (v *Verification) Command() *discordgo.ApplicationCommand {
	return &discordgo.ApplicationCommand{
		Name:        "verify",
		Description: "Verify your account to access the server",
	}
}

func (v *Verification) PanelCommand() *discordgo.ApplicationCommand {
	return &discordgo.ApplicationCommand{
		Name:                     "verification_panel",
		Description:              "Post verification panel (admin only)",
		DefaultMemberPermissions: int64ptr(discordgo.PermissionAdministrator),
	}
}

func (v *Verification) StatsCommand() *discordgo.ApplicationCommand {
	return &discordgo.ApplicationCommand{
		Name:                     "verification_stats",
		Description:              "Show verification stats for a user (admin only)",
		DefaultMemberPermissions: int64ptr(discordgo.PermissionAdministrator),
		Options: []*discordgo.ApplicationCommandOption{
			{
				Type:        discordgo.ApplicationCommandOptionUser,
				Name:        "user",
				Description: "Target user",
				Required:    true,
			},
		},
	}
}

func (v *Verification) Verify(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ctx, cancel := v.b.OpContext(15 * time.Second); defer cancel()
	guildID := i.GuildID
	userID := i.Member.User.ID

	// ACK imediato: atribuir cargo é uma chamada REST que pode passar dos 3s.
	if !deferEphemeral(s, i) {
		return
	}

	if rateLimited(ctx, v.b.Redis, "ratelimit:verify", guildID, userID, v.b.Cfg.RateLimitVerification) {
		editResponse(s, i, "Muitas tentativas de verificação. Aguarde um minuto.")
		return
	}

	cfg, err := v.b.DB.GetGuildConfig(ctx, guildID)
	if err != nil {
		editResponse(s, i, "Configuration not set up. Contact an admin.")
		return
	}

	maxAttempts := v.b.Cfg.VerificationMaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = 5
	}
	since := time.Now().Add(-24 * time.Hour)
	count, err := v.b.DB.CountVerificationAttempts(ctx, guildID, userID, since)
	if err == nil && count >= maxAttempts {
		editResponse(s, i, "You have reached the verification attempt limit. Try again tomorrow.")
		return
	}

	for _, r := range i.Member.Roles {
		if r == cfg.VerifiedRoleID {
			editResponse(s, i, "You are already verified.")
			return
		}
	}

	err = s.GuildMemberRoleAdd(guildID, userID, cfg.VerifiedRoleID)
	success := err == nil
	_ = v.b.LogDBErr("InsertVerificationAttempt", v.b.DB.InsertVerificationAttempt(ctx, &db.VerificationAttempt{
		GuildID: guildID,
		UserID:  userID,
		Success: success,
	}))

	bot.MetricVerifications.WithLabelValues(boolLabel(success), guildID).Inc()

	if !success {
		editResponse(s, i, fmt.Sprintf("Failed to assign verified role: %v", err))
		return
	}

	v.persistResult(ctx, s, i, cfg)
	editResponse(s, i, "You have been verified! Welcome.")
}

func (v *Verification) persistResult(ctx context.Context, s *discordgo.Session, i *discordgo.InteractionCreate, cfg *db.GuildConfig) {
	if cfg.LogChannelID == "" {
		return
	}
	msg := cfg.WelcomeMessage
	if msg == "" {
		msg = fmt.Sprintf("<@%s> foi verificado(a). Bem-vindo(a)!", i.Member.User.ID)
	}
	msg = strings.ReplaceAll(msg, "{user}", "<@"+i.Member.User.ID+">")
	msg = strings.ReplaceAll(msg, "{username}", i.Member.User.Username)

	ext := v.b.DB.GetExtendedConfig(ctx, i.GuildID)
	color := embedColor(ext.EmbedColor)
	embed := buildEmbed(color, "✅ Bem-vindo(a)!", msg, ext.WelcomeImageURL)
	_, _ = s.ChannelMessageSendEmbed(cfg.LogChannelID, embed)
}

func (v *Verification) VerificationPanel(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ctx, cancel := v.b.OpContext(15 * time.Second); defer cancel()
	cfg, _ := v.b.DB.GetGuildConfig(ctx, i.GuildID)
	var pc db.PanelConfigs
	if cfg != nil {
		pc = cfg.PanelConfigs
	}
	e := pc.VerificationEmbed()

	ext := v.b.DB.GetExtendedConfig(ctx, i.GuildID)
	color := embedColor(ext.EmbedColor)
	embed := buildEmbed(color, e.Title, e.Description, "")

	_ = s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Embeds: []*discordgo.MessageEmbed{embed},
			Components: []discordgo.MessageComponent{
				discordgo.ActionsRow{Components: []discordgo.MessageComponent{
					discordgo.Button{
						Label:    e.ButtonLabel,
						Style:    discordgo.PrimaryButton,
						CustomID: "verification:verify_button",
					},
				}},
			},
		},
	})
}

func (v *Verification) HandleVerifyButton(s *discordgo.Session, i *discordgo.InteractionCreate) {
	v.Verify(s, i)
}

func (v *Verification) VerificationStats(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ctx, cancel := v.b.OpContext(15 * time.Second); defer cancel()
	guildID := i.GuildID
	user := i.ApplicationCommandData().Options[0].UserValue(s)
	since := time.Now().Add(-24 * time.Hour)
	count, err := v.b.DB.CountVerificationAttempts(ctx, guildID, user.ID, since)
	if err != nil {
		_ = s.InteractionRespond(i.Interaction, ephemeral("DB error: "+err.Error()))
		return
	}
	_ = s.InteractionRespond(i.Interaction, ephemeral(fmt.Sprintf(
		"<@%s> verification attempts in last 24h: **%d**", user.ID, count,
	)))
}

func int64ptr(v int64) *int64 { return &v }
