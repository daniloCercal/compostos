package bot

import (
	"context"
	"os"
	"time"
)

const heartbeatInterval = 30 * time.Second

// StartHeartbeat inicia goroutine que escreve em site.bot_status a cada 30s.
// botID é o UUID do bot na tabela site.bots (resolvido no startup pelo token).
func (b *Bot) StartHeartbeat(ctx context.Context, botID string, startedAt time.Time) {
	go func() {
		// O bot acabou de (re)iniciar: limpa qualquer pedido de restart pendente
		// (já honrado por este boot). Daqui em diante, restart_requested_at não-nulo
		// é um pedido NOVO a ser obedecido.
		_ = b.DB.ClearRestartRequest(ctx, botID)
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

	// Pedido de restart do painel: se marcado, sai com código 0 para o systemd
	// reiniciar (Restart=always). O startup já limpou pedidos antigos.
	if requested, err := b.DB.IsRestartRequested(ctx, botID); err == nil && requested {
		b.Log.Info("restart solicitado pelo painel — encerrando para o systemd reiniciar")
		_ = b.DB.SetBotOffline(ctx, botID)
		os.Exit(0)
	}
}
