package handlers

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/yourorg/rp-bot/internal/bot"
	"github.com/yourorg/rp-bot/internal/db"
	"github.com/yourorg/rp-bot/internal/services"
)

type Tickets struct {
	b     *bot.Bot
	cache *services.ChannelCache
}

func NewTickets(b *bot.Bot, cache *services.ChannelCache) *Tickets {
	return &Tickets{b: b, cache: cache}
}

func (t *Tickets) Commands() []*discordgo.ApplicationCommand {
	return []*discordgo.ApplicationCommand{
		{Name: "tickets_panel", Description: "Post ticket panel (admin only)",
			DefaultMemberPermissions: int64ptr(discordgo.PermissionAdministrator)},
		{Name: "ticket_close", Description: "Close current ticket",
			Options: []*discordgo.ApplicationCommandOption{
				{Type: discordgo.ApplicationCommandOptionString, Name: "reason", Description: "Close reason"},
			}},
		{Name: "ticket_claim", Description: "Claim current ticket"},
		{Name: "ticket_unclaim", Description: "Unclaim current ticket"},
	}
}

func (t *Tickets) TicketsPanel(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ctx, cancel := t.b.OpContext(15 * time.Second)
	defer cancel()
	cfg, err := t.b.DB.GetGuildConfig(ctx, i.GuildID)
	if err != nil || cfg.TicketCategoryID == "" {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Sistema de tickets não configurado."))
		return
	}
	e := cfg.PanelConfigs.TicketsEmbed()

	ext := t.b.DB.GetExtendedConfig(ctx, i.GuildID)
	color := embedColor(ext.EmbedColor)
	embed := buildEmbed(color, e.Title, e.Description, "")

	categories := []string{"Suporte", "Report", "Apelação", "Outro"}
	opts := make([]discordgo.SelectMenuOption, len(categories))
	for idx, cat := range categories {
		opts[idx] = discordgo.SelectMenuOption{Label: cat, Value: strings.ToLower(cat)}
	}
	_ = s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Embeds: []*discordgo.MessageEmbed{embed},
			Components: []discordgo.MessageComponent{
				discordgo.ActionsRow{Components: []discordgo.MessageComponent{
					discordgo.SelectMenu{
						CustomID:    "ticket:category_select",
						Placeholder: e.Placeholder,
						Options:     opts,
					},
				}},
			},
		},
	})
}

func (t *Tickets) HandleCategorySelect(s *discordgo.Session, i *discordgo.InteractionCreate) {
	data := i.MessageComponentData()
	if len(data.Values) == 0 {
		return
	}
	category := data.Values[0]
	ctx, cancel := t.b.OpContext(15 * time.Second)
	defer cancel()
	guildID := i.GuildID
	userID := i.Member.User.ID

	// ACK imediato: criar canal de ticket é uma chamada REST que pode passar dos 3s.
	if !deferEphemeral(s, i) {
		return
	}

	if rateLimited(ctx, t.b.Redis, "ratelimit:ticket", guildID, userID, t.b.Cfg.RateLimitTicketCreate) {
		editResponse(s, i, "Você está abrindo tickets rápido demais. Aguarde um minuto.")
		return
	}

	cfg, err := t.b.DB.GetGuildConfig(ctx, guildID)
	if err != nil {
		editResponse(s, i, "Configuration error.")
		return
	}
	max := cfg.MaxTicketsPerUser
	if max == 0 {
		max = 3
	}
	count, _ := t.b.DB.CountOpenTicketsForUser(ctx, guildID, userID)
	if count >= max {
		editResponse(s, i, fmt.Sprintf("You already have %d open ticket(s). Close one first.", count))
		return
	}
	ch, err := t.createTicket(ctx, s, guildID, userID, category, cfg)
	if err != nil {
		editResponse(s, i, "Failed to create ticket: "+err.Error())
		return
	}
	bot.MetricTickets.WithLabelValues(category, guildID).Inc()
	editResponse(s, i, fmt.Sprintf("Ticket created: <#%s>", ch.ID))
}

func (t *Tickets) createTicket(ctx context.Context, s *discordgo.Session, guildID, userID, category string, cfg *db.GuildConfig) (*discordgo.Channel, error) {
	num, err := t.b.DB.NextTicketNumber(ctx, guildID)
	if err != nil {
		return nil, err
	}
	prefix := cfg.TicketPrefix
	if prefix == "" {
		prefix = "ticket"
	}
	chName := fmt.Sprintf("%s-%04d", prefix, num)
	overwrite := []*discordgo.PermissionOverwrite{
		{ID: guildID, Type: discordgo.PermissionOverwriteTypeRole, Deny: discordgo.PermissionViewChannel},
		{ID: userID, Type: discordgo.PermissionOverwriteTypeMember, Allow: discordgo.PermissionViewChannel | discordgo.PermissionSendMessages},
	}
	if cfg.StaffRoleID != "" {
		overwrite = append(overwrite, &discordgo.PermissionOverwrite{
			ID: cfg.StaffRoleID, Type: discordgo.PermissionOverwriteTypeRole,
			Allow: discordgo.PermissionViewChannel | discordgo.PermissionSendMessages,
		})
	}
	ch, err := s.GuildChannelCreateComplex(guildID, discordgo.GuildChannelCreateData{
		Name:                 chName,
		Type:                 discordgo.ChannelTypeGuildText,
		ParentID:             cfg.TicketCategoryID,
		PermissionOverwrites: overwrite,
	})
	if err != nil {
		return nil, err
	}

	// Lê extended config para imagem e cor
	ext := t.b.DB.GetExtendedConfig(ctx, guildID)
	color := embedColor(ext.EmbedColor)

	ticket := &db.Ticket{
		GuildID: guildID, ChannelID: ch.ID, UserID: userID,
		TicketNumber: num, Category: category, Status: "open",
		DmNotify: ext.DmNotifyDefault,
	}
	ticketID, err := t.b.DB.InsertTicket(ctx, ticket)
	if err != nil {
		_, _ = s.ChannelDelete(ch.ID)
		return nil, err
	}
	ticket.ID = ticketID
	t.cache.Add(ch.ID, services.ChannelTicket)

	// Embed de abertura do ticket
	embed := buildEmbed(
		color,
		fmt.Sprintf("Ticket #%04d — %s", num, strings.Title(category)),
		fmt.Sprintf("Olá <@%s>! A equipe estará com você em breve.\n\nCategoria: **%s**", userID, strings.Title(category)),
		ext.TicketImageURL,
	)

	_, _ = s.ChannelMessageSendComplex(ch.ID, &discordgo.MessageSend{
		Embeds: []*discordgo.MessageEmbed{embed},
		Components: []discordgo.MessageComponent{
			discordgo.ActionsRow{Components: []discordgo.MessageComponent{
				discordgo.Button{
					Label:    "Fechar",
					Style:    discordgo.DangerButton,
					CustomID: fmt.Sprintf("ticket:close:%d", ticketID),
				},
				discordgo.Button{
					Label:    "Assumir",
					Style:    discordgo.SuccessButton,
					CustomID: fmt.Sprintf("ticket:claim:%d", ticketID),
				},
				discordgo.Button{
					Label:    dmNotifyLabel(ext.DmNotifyDefault),
					Style:    dmNotifyStyle(ext.DmNotifyDefault),
					CustomID: fmt.Sprintf("ticket:dm_toggle:%d", ticketID),
				},
			}},
		},
	})
	return ch, nil
}

func (t *Tickets) HandleDmToggleButton(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ctx, cancel := t.b.OpContext(15 * time.Second)
	defer cancel()
	idStr := parseIDSuffix(i.MessageComponentData().CustomID, "ticket:dm_toggle:")
	ticket, err := t.b.DB.GetTicketByID(ctx, mustInt64(idStr))
	if err != nil {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Ticket não encontrado."))
		return
	}
	// Só o dono do ticket pode alterar
	if i.Member.User.ID != ticket.UserID {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Apenas o dono do ticket pode alterar notificações."))
		return
	}
	newState := !ticket.DmNotify
	_ = t.b.DB.SetTicketDmNotify(ctx, ticket.ID, newState)

	// Atualiza o botão na mensagem original
	msg := i.Message
	if msg != nil {
		newComponents := updateDmToggleButton(msg.Components, ticket.ID, newState)
		_, _ = s.ChannelMessageEditComplex(&discordgo.MessageEdit{
			Channel:    msg.ChannelID,
			ID:         msg.ID,
			Components: &newComponents,
		})
	}

	label := "ativadas"
	if !newState {
		label = "desativadas"
	}
	_ = s.InteractionRespond(i.Interaction, ephemeral(fmt.Sprintf("Notificações por DM %s.", label)))
}

// updateDmToggleButton percorre os components e atualiza o botão dm_toggle.
func updateDmToggleButton(components []discordgo.MessageComponent, ticketID int64, newState bool) []discordgo.MessageComponent {
	targetID := fmt.Sprintf("ticket:dm_toggle:%d", ticketID)
	result := make([]discordgo.MessageComponent, len(components))
	for i, row := range components {
		ar, ok := row.(discordgo.ActionsRow)
		if !ok {
			result[i] = row
			continue
		}
		newButtons := make([]discordgo.MessageComponent, len(ar.Components))
		for j, comp := range ar.Components {
			btn, ok := comp.(discordgo.Button)
			if ok && btn.CustomID == targetID {
				btn.Label = dmNotifyLabel(newState)
				btn.Style = dmNotifyStyle(newState)
			}
			newButtons[j] = btn
		}
		result[i] = discordgo.ActionsRow{Components: newButtons}
	}
	return result
}

func (t *Tickets) TicketClose(s *discordgo.Session, i *discordgo.InteractionCreate) {
	reason := ""
	opts := i.ApplicationCommandData().Options
	if len(opts) > 0 {
		reason = opts[0].StringValue()
	}
	ctx, cancel := t.b.OpContext(15 * time.Second)
	defer cancel()
	ticket, err := t.b.DB.GetTicketByChannelID(ctx, i.ChannelID)
	if err != nil {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Not a ticket channel."))
		return
	}
	t.closeTicketImpl(ctx, s, i, ticket, reason)
}

func (t *Tickets) HandleCloseButton(s *discordgo.Session, i *discordgo.InteractionCreate) {
	_ = s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseModal,
		Data: &discordgo.InteractionResponseData{
			CustomID: "ticket:close_reason_modal:" + parseIDSuffix(i.MessageComponentData().CustomID, "ticket:close:"),
			Title:    "Fechar Ticket",
			Components: []discordgo.MessageComponent{
				discordgo.ActionsRow{Components: []discordgo.MessageComponent{
					discordgo.TextInput{CustomID: "reason", Label: "Motivo do fechamento",
						Style: discordgo.TextInputShort, Required: false},
				}},
			},
		},
	})
}

func (t *Tickets) HandleCloseModal(s *discordgo.Session, i *discordgo.InteractionCreate) {
	data := i.ModalSubmitData()
	reason := modalField(data, "reason")
	idStr := parseIDSuffix(data.CustomID, "ticket:close_reason_modal:")
	ctx, cancel := t.b.OpContext(15 * time.Second)
	defer cancel()
	ticket, err := t.b.DB.GetTicketByID(ctx, mustInt64(idStr))
	if err != nil {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Ticket not found."))
		return
	}
	t.closeTicketImpl(ctx, s, i, ticket, reason)
}

func (t *Tickets) closeTicketImpl(ctx context.Context, s *discordgo.Session, i *discordgo.InteractionCreate, ticket *db.Ticket, reason string) {
	if err := t.b.DB.CloseTicket(ctx, ticket.ID, reason); err != nil {
		_ = s.InteractionRespond(i.Interaction, ephemeral("DB error: "+err.Error()))
		return
	}
	t.cache.Remove(ticket.ChannelID)
	cfg, _ := t.b.DB.GetGuildConfig(ctx, ticket.GuildID)
	if cfg != nil && cfg.TicketLogChannelID != "" {
		actorID := ""
		if i.Member != nil {
			actorID = i.Member.User.ID
		}
		_, _ = s.ChannelMessageSend(cfg.TicketLogChannelID, fmt.Sprintf(
			"Ticket #%04d fechado por <@%s>. Motivo: %s", ticket.TicketNumber, actorID, reason))
	}

	// Envia DM ao dono do ticket se habilitado
	if ticket.DmNotify {
		t.sendCloseDM(s, ticket, reason)
	}

	_ = s.InteractionRespond(i.Interaction, ephemeral("Ticket será fechado em 10 segundos..."))
	go func() {
		time.Sleep(10 * time.Second)
		_, _ = s.ChannelDelete(ticket.ChannelID)
	}()
}

func (t *Tickets) sendCloseDM(s *discordgo.Session, ticket *db.Ticket, reason string) {
	ch, err := s.UserChannelCreate(ticket.UserID)
	if err != nil {
		return
	}
	ctx, cancel := t.b.OpContext(15 * time.Second)
	defer cancel()
	ext := t.b.DB.GetExtendedConfig(ctx, ticket.GuildID)
	color := embedColor(ext.EmbedColor)
	desc := fmt.Sprintf("Seu ticket **#%04d** foi fechado.", ticket.TicketNumber)
	if reason != "" {
		desc += fmt.Sprintf("\n**Motivo:** %s", reason)
	}
	embed := buildEmbed(color, "Ticket Fechado", desc, "")
	_, _ = s.ChannelMessageSendEmbed(ch.ID, embed)
}

func (t *Tickets) TicketClaim(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ctx, cancel := t.b.OpContext(15 * time.Second)
	defer cancel()
	ticket, err := t.b.DB.GetTicketByChannelID(ctx, i.ChannelID)
	if err != nil {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Not a ticket channel."))
		return
	}
	t.claimTicketImpl(ctx, s, i, ticket)
}

func (t *Tickets) HandleClaimButton(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ctx, cancel := t.b.OpContext(15 * time.Second)
	defer cancel()
	idStr := parseIDSuffix(i.MessageComponentData().CustomID, "ticket:claim:")
	ticket, err := t.b.DB.GetTicketByID(ctx, mustInt64(idStr))
	if err != nil {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Ticket not found."))
		return
	}
	t.claimTicketImpl(ctx, s, i, ticket)
}

func (t *Tickets) claimTicketImpl(ctx context.Context, s *discordgo.Session, i *discordgo.InteractionCreate, ticket *db.Ticket) {
	userID := i.Member.User.ID
	for _, e := range ticket.ClaimedStaff {
		if e.UserID == userID {
			_ = s.InteractionRespond(i.Interaction, ephemeral("Already claimed by you."))
			return
		}
	}
	ticket.ClaimedStaff = append(ticket.ClaimedStaff, db.ClaimedStaffEntry{UserID: userID, ClaimedAt: time.Now()})
	if err := t.b.DB.UpdateTicketClaimedStaff(ctx, ticket.ID, ticket.ClaimedStaff); err != nil {
		_ = s.InteractionRespond(i.Interaction, ephemeral("DB error."))
		return
	}
	_ = s.InteractionRespond(i.Interaction, ephemeral(fmt.Sprintf("Assumiu o ticket #%04d.", ticket.TicketNumber)))
}

func (t *Tickets) TicketUnclaim(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ctx, cancel := t.b.OpContext(15 * time.Second)
	defer cancel()
	ticket, err := t.b.DB.GetTicketByChannelID(ctx, i.ChannelID)
	if err != nil {
		_ = s.InteractionRespond(i.Interaction, ephemeral("Not a ticket channel."))
		return
	}
	userID := i.Member.User.ID
	filtered := ticket.ClaimedStaff[:0]
	for _, e := range ticket.ClaimedStaff {
		if e.UserID != userID {
			filtered = append(filtered, e)
		}
	}
	if len(filtered) == len(ticket.ClaimedStaff) {
		_ = s.InteractionRespond(i.Interaction, ephemeral("You have not claimed this ticket."))
		return
	}
	if err := t.b.DB.UpdateTicketClaimedStaff(ctx, ticket.ID, filtered); err != nil {
		_ = s.InteractionRespond(i.Interaction, ephemeral("DB error."))
		return
	}
	_ = s.InteractionRespond(i.Interaction, ephemeral("Unclaimed."))
}

func (t *Tickets) OnMessage(s *discordgo.Session, m *discordgo.MessageCreate) {
	if m.Author.Bot {
		return
	}
	// Fast path: se o cache está pronto e o canal não é um ticket, não consulta o banco.
	if t.cache.Ready() && !t.cache.Is(m.ChannelID, services.ChannelTicket) {
		return
	}
	ctx, cancel := t.b.OpContext(15 * time.Second)
	defer cancel()
	ticket, err := t.b.DB.GetTicketByChannelID(ctx, m.ChannelID)
	if err != nil {
		return
	}
	attachments := ""
	if len(m.Attachments) > 0 {
		urls := make([]string, len(m.Attachments))
		for idx, a := range m.Attachments {
			urls[idx] = a.URL
		}
		attachments = strings.Join(urls, " ")
	}
	_ = t.b.LogDBErr("InsertTicketMessage", t.b.DB.InsertTicketMessage(ctx, &db.TicketMessage{
		TicketID: ticket.ID, AuthorID: m.Author.ID, AuthorName: m.Author.Username,
		Content: m.Content, Attachments: attachments,
	}))
}
