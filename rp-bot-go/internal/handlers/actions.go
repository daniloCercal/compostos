package handlers

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/yourorg/rp-bot/internal/bot"
	"github.com/yourorg/rp-bot/internal/services"
)

// StartActionsPoller inicia goroutine que consome site.bot_actions a cada 2 segundos.
func StartActionsPoller(ctx context.Context, b *bot.Bot, ps *services.PresenceService, log *slog.Logger) {
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				processActions(ctx, b, ps, log)
			}
		}
	}()
}

func processActions(ctx context.Context, b *bot.Bot, ps *services.PresenceService, log *slog.Logger) {
	actions, err := b.DB.FetchPendingActions(ctx)
	if err != nil {
		log.Error("fetch pending actions", "err", err)
		return
	}
	for _, action := range actions {
		var result string
		var success bool

		switch action.ActionType {
		case "set_presence":
			status, _ := action.Payload["status"].(string)
			name, _ := action.Payload["name"].(string)
			actType := 0
			if t, ok := action.Payload["type"].(float64); ok {
				actType = int(t)
			}
			p := services.PresencePayload{Status: status, Type: actType, Name: name}
			if err := ps.Persist(ctx, p); err != nil {
				result = fmt.Sprintf("redis error: %v", err)
				success = false
			} else {
				ps.Apply(b.Session.HeartbeatLatency().Milliseconds())
				result = "ok"
				success = true
			}

		case "verify_captcha":
			userID, _ := action.Payload["user_id"].(string)
			if userID == "" || action.GuildID == "" {
				result = "missing user_id or guild_id"
				success = false
				break
			}
			cfg, cErr := b.DB.GetGuildConfig(ctx, action.GuildID)
			if cErr != nil || cfg.VerifiedRoleID == "" {
				result = "no verified role configured"
				success = false
				break
			}
			if rErr := b.Session.GuildMemberRoleAdd(action.GuildID, userID, cfg.VerifiedRoleID); rErr != nil {
				result = fmt.Sprintf("role add error: %v", rErr)
				success = false
			} else {
				result = "verified role assigned"
				success = true
			}

		default:
			result = fmt.Sprintf("unknown action type: %s", action.ActionType)
			success = false
		}

		if err := b.DB.CompleteAction(ctx, action.ID, success, result); err != nil {
			log.Error("complete action", "id", action.ID, "err", err)
		} else {
			log.Info("processed action", "id", action.ID, "type", action.ActionType, "success", success)
		}
	}
}
