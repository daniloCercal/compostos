package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/joho/godotenv"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"github.com/yourorg/rp-bot/internal/bot"
	"github.com/yourorg/rp-bot/internal/config"
	"github.com/yourorg/rp-bot/internal/db"
	"github.com/yourorg/rp-bot/internal/handlers"
)

func main() {
	_ = godotenv.Load()

	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := config.Load()
	if err != nil {
		log.Error("load config", "err", err)
		os.Exit(1)
	}

	if cfg.SentryDSN != "" {
		if err := sentry.Init(sentry.ClientOptions{
			Dsn:         cfg.SentryDSN,
			Environment: cfg.Environment,
		}); err != nil {
			log.Warn("sentry init falhou", "err", err)
		} else {
			defer sentry.Flush(2 * time.Second)
			log.Info("sentry inicializado")
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := db.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("connect db", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	opt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		log.Error("parse redis url", "err", err)
		os.Exit(1)
	}
	rdb := redis.NewClient(opt)
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Error("connect redis", "err", err)
		os.Exit(1)
	}
	defer rdb.Close()

	b, err := bot.New(cfg, pool, rdb, log)
	if err != nil {
		log.Error("create bot", "err", err)
		os.Exit(1)
	}
	b.Ctx = ctx // contexto-raiz para timeouts/cancelamento de handlers

	cmds, startPollers := handlers.Register(b)

	startedAt := time.Now()

	if err := b.Open(); err != nil {
		log.Error("open session", "err", err)
		os.Exit(1)
	}
	defer b.Close()

	startPollers(ctx)

	if err := b.SyncCommands(ctx, cmds); err != nil {
		log.Error("sync commands", "err", err)
		os.Exit(1)
	}

	var resolvedBotID string
	if botID, err := pool.ResolveBotID(ctx, cfg.DiscordToken); err != nil {
		log.Warn("heartbeat desativado — bot nao encontrado em site.bots", "err", err)
	} else {
		resolvedBotID = botID
		pool.SetBotID(botID)
		b.StartHeartbeat(ctx, botID, startedAt)
		log.Info("heartbeat iniciado", "bot_id", botID)
	}

	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	metricsSrv := &http.Server{Addr: ":" + cfg.MetricsPort, Handler: mux}
	go func() {
		log.Info("metrics listening", "addr", metricsSrv.Addr)
		if err := metricsSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("metrics server", "err", err)
		}
	}()

	log.Info("bot ready", "user", b.Session.State.User.Username)

	sc := make(chan os.Signal, 1)
	signal.Notify(sc, syscall.SIGINT, syscall.SIGTERM)
	<-sc
	log.Info("shutting down")

	// Shutdown gracioso (usa contexto próprio com timeout — o ctx-raiz será cancelado a seguir).
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutCancel()

	// Marca offline antes de cancelar o contexto-raiz.
	if resolvedBotID != "" {
		if err := pool.SetBotOffline(shutCtx, resolvedBotID); err != nil {
			log.Warn("falha ao marcar bot offline", "err", err)
		}
	}

	if err := metricsSrv.Shutdown(shutCtx); err != nil {
		log.Warn("metrics server shutdown", "err", err)
	}

	cancel()
}
