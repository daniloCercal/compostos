package handlers

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/redis/go-redis/v9"
	"github.com/yourorg/rp-bot/internal/config"
	"github.com/yourorg/rp-bot/internal/services"
)

// rateLimited aplica o limite por minuto de uma ação (guild+user) usando o
// RateLimiter Redis. Retorna true se o usuário excedeu o limite e NÃO deve
// prosseguir. Falha em modo aberto (não bloqueia) se o Redis estiver indisponível
// ou se o limite configurado for <= 0 (desligado).
func rateLimited(ctx context.Context, rdb *redis.Client, prefix, guildID, userID string, perMinute int) bool {
	if perMinute <= 0 {
		return false
	}
	rl := services.NewRateLimiter(rdb, prefix)
	allowed, _, _, err := rl.Check(ctx, guildID+":"+userID, perMinute, time.Minute)
	if err != nil {
		return false
	}
	return !allowed
}

// embedColor retorna a cor configurada ou o padrão (vermelho escuro) quando não definida.
func embedColor(c int) int {
	if c == 0 {
		return config.ColorDarkRed
	}
	return c
}

func ephemeral(content string) *discordgo.InteractionResponse {
	return &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Content: content,
			Flags:   discordgo.MessageFlagsEphemeral,
		},
	}
}

// deferEphemeral envia um ACK adiado (efêmero) dentro da janela de 3s do
// Discord, liberando o handler para fazer trabalho lento (DB, REST) sem
// estourar o prazo. Retorna false se o ACK falhou (ex.: já respondido).
// Após o defer, responda com editResponse — não com InteractionRespond.
func deferEphemeral(s *discordgo.Session, i *discordgo.InteractionCreate) bool {
	err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{Flags: discordgo.MessageFlagsEphemeral},
	})
	return err == nil
}

// editResponse edita a mensagem da resposta adiada com o conteúdo final.
func editResponse(s *discordgo.Session, i *discordgo.InteractionCreate, content string) {
	_, _ = s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{Content: &content})
}

// buildEmbed cria um MessageEmbed com cor, título, descrição e imagem opcionais.
func buildEmbed(color int, title, description, imageURL string) *discordgo.MessageEmbed {
	e := &discordgo.MessageEmbed{
		Color:       color,
		Description: description,
	}
	if title != "" {
		e.Title = title
	}
	if imageURL != "" {
		e.Image = &discordgo.MessageEmbedImage{URL: imageURL}
	}
	return e
}

func hasAdminPermission(s *discordgo.Session, i *discordgo.InteractionCreate, adminRoleID string) bool {
	if i.Member == nil {
		return false
	}
	perms := i.Member.Permissions
	if perms&discordgo.PermissionAdministrator != 0 {
		return true
	}
	if adminRoleID == "" {
		return false
	}
	for _, r := range i.Member.Roles {
		if r == adminRoleID {
			return true
		}
	}
	return false
}

func hasStaffPermission(s *discordgo.Session, i *discordgo.InteractionCreate, staffRoleID, adminRoleID string) bool {
	if hasAdminPermission(s, i, adminRoleID) {
		return true
	}
	if i.Member == nil || staffRoleID == "" {
		return false
	}
	for _, r := range i.Member.Roles {
		if r == staffRoleID {
			return true
		}
	}
	return false
}

func mustInt64(s string) int64 {
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}

func boolPtr(b bool) *bool { return &b }

func parseIDSuffix(customID, prefix string) string {
	return strings.TrimPrefix(customID, prefix)
}

func modalField(data discordgo.ModalSubmitInteractionData, customID string) string {
	for _, row := range data.Components {
		ar, ok := row.(*discordgo.ActionsRow)
		if !ok {
			continue
		}
		for _, comp := range ar.Components {
			ti, ok := comp.(*discordgo.TextInput)
			if ok && ti.CustomID == customID {
				return strings.TrimSpace(ti.Value)
			}
		}
	}
	return ""
}

func boolLabel(b bool) string {
	if b {
		return "Yes"
	}
	return "No"
}

func channelSummary(s *discordgo.Session, id string) string {
	if id == "" {
		return "not set"
	}
	ch, err := s.Channel(id)
	if err != nil {
		return fmt.Sprintf("<#%s>", id)
	}
	return fmt.Sprintf("<#%s> (%s)", id, ch.Name)
}

func roleSummary(s *discordgo.Session, guildID, id string) string {
	if id == "" {
		return "not set"
	}
	roles, err := s.GuildRoles(guildID)
	if err != nil {
		return fmt.Sprintf("<@&%s>", id)
	}
	for _, r := range roles {
		if r.ID == id {
			return fmt.Sprintf("<@&%s> (%s)", id, r.Name)
		}
	}
	return fmt.Sprintf("<@&%s>", id)
}

func parseConfigValue(field, raw string) (string, error) {
	switch field {
	case "max_tickets_per_user":
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return "", fmt.Errorf("must be positive integer")
		}
		return strconv.Itoa(n), nil
	default:
		return raw, nil
	}
}

// dmNotifyLabel retorna o label do botão de notificação baseado no estado atual.
func dmNotifyLabel(on bool) string {
	if on {
		return "🔔 Notificações ON"
	}
	return "🔕 Notificações OFF"
}

// dmNotifyStyle retorna o estilo do botão de notificação.
func dmNotifyStyle(on bool) discordgo.ButtonStyle {
	if on {
		return discordgo.SuccessButton
	}
	return discordgo.SecondaryButton
}
