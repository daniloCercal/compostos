package bot

import (
	"context"
	"time"
)

const heartbeatInterval = 30 * time.Second

// StartHeartbeat inicia goroutine que escreve em site.bot_status a cada 30s.
// botID é o UUID do bot na tabela site.bots (resolvido no startup pelo token).
func (b *Bot) StartHeartbeat(ctx context.Context, botID string, startedAt time.Time) {
	go func() {
		b.sendHeartbeat(ctx, botID, startedAt)
		ticker := time.NewTicker(heartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				b.sendHeartbeat(ctx, botID, startedAt)
			}
		}
	}()
}

func (b *Bot) sendHeartbeat(ctx context.Context, botID string, startedAt time.Time) {
	latencyMs := b.Session.HeartbeatLatency().Milliseconds()
	guildsCount := len(b.Session.State.Guilds)
	if err := b.DB.UpsertBotStatus(ctx, botID, startedAt, latencyMs, guildsCount); err != nil {
		b.Log.Warn("heartbeat failed", "err", err)
	}
}
