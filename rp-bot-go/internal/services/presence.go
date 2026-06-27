package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/redis/go-redis/v9"
)

const presenceKey = "bot:presence"

type PresencePayload struct {
	Status    string `json:"status"`
	Type      int    `json:"type"`
	Name      string `json:"name"`
	URL       string `json:"url,omitempty"`
	UpdatedAt int64  `json:"updated_at"`
}

type PresenceService struct {
	rdb     *redis.Client
	session *discordgo.Session
	log     *slog.Logger
	mu      sync.RWMutex
	current PresencePayload
	startAt time.Time
}

func NewPresenceService(rdb *redis.Client, s *discordgo.Session, log *slog.Logger) *PresenceService {
	return &PresenceService{rdb: rdb, session: s, log: log, startAt: time.Now()}
}

func (ps *PresenceService) Load(ctx context.Context) error {
	data, err := ps.rdb.Get(ctx, presenceKey).Bytes()
	if err == redis.Nil {
		ps.current = PresencePayload{Status: "online", Type: 0, Name: "RP Server"}
		return nil
	}
	if err != nil {
		return err
	}
	ps.mu.Lock()
	defer ps.mu.Unlock()
	return json.Unmarshal(data, &ps.current)
}

func (ps *PresenceService) Persist(ctx context.Context, p PresencePayload) error {
	p.UpdatedAt = time.Now().Unix()
	data, _ := json.Marshal(p)
	ps.mu.Lock()
	ps.current = p
	ps.mu.Unlock()
	return ps.rdb.Set(ctx, presenceKey, data, 0).Err()
}

func (ps *PresenceService) Apply(latencyMs int64) {
	ps.mu.RLock()
	p := ps.current
	ps.mu.RUnlock()

	uptime := time.Since(ps.startAt).Round(time.Second)
	name := p.Name
	name = strings.ReplaceAll(name, "{latency_ms}", fmt.Sprintf("%d", latencyMs))
	name = strings.ReplaceAll(name, "{uptime}", uptime.String())

	statusType := discordgo.Status(p.Status)
	if statusType == "" {
		statusType = discordgo.StatusOnline
	}
	if err := ps.session.UpdateStatusComplex(discordgo.UpdateStatusData{
		Status: string(statusType),
		Activities: []*discordgo.Activity{
			{Name: name, Type: discordgo.ActivityType(p.Type), URL: p.URL},
		},
	}); err != nil {
		ps.log.Error("UpdateStatusComplex failed", "err", err)
	}
}

func (ps *PresenceService) StartUpdater(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				latency := ps.session.HeartbeatLatency().Milliseconds()
				ps.Apply(latency)
			}
		}
	}()
}
