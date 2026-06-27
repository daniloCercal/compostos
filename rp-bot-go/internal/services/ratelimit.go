package services

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type RateLimiter struct {
	rdb    *redis.Client
	prefix string
}

func NewRateLimiter(rdb *redis.Client, prefix string) *RateLimiter {
	return &RateLimiter{rdb: rdb, prefix: prefix}
}

// Check returns (allowed, remaining, resetIn, error).
// Uses sliding window via sorted set.
func (r *RateLimiter) Check(ctx context.Context, key string, limit int, window time.Duration) (bool, int, time.Duration, error) {
	now := time.Now()
	windowStart := now.Add(-window).UnixMilli()
	redisKey := fmt.Sprintf("%s:%s", r.prefix, key)

	pipe := r.rdb.Pipeline()
	pipe.ZRemRangeByScore(ctx, redisKey, "0", fmt.Sprintf("%d", windowStart))
	pipe.ZCard(ctx, redisKey)
	pipe.ZAdd(ctx, redisKey, redis.Z{Score: float64(now.UnixMilli()), Member: now.UnixMilli()})
	pipe.Expire(ctx, redisKey, window+time.Second)
	cmds, err := pipe.Exec(ctx)
	if err != nil {
		return false, 0, 0, err
	}
	count := cmds[1].(*redis.IntCmd).Val()
	allowed := count < int64(limit)
	remaining := limit - int(count)
	if remaining < 0 {
		remaining = 0
	}
	resetIn := window
	return allowed, remaining, resetIn, nil
}

type DistributedLock struct {
	rdb *redis.Client
	key string
	ttl time.Duration
}

func NewDistributedLock(rdb *redis.Client, key string, ttl time.Duration) *DistributedLock {
	return &DistributedLock{rdb: rdb, key: key, ttl: ttl}
}

// Acquire tries to acquire the lock. Returns release func and true on success.
func (l *DistributedLock) Acquire(ctx context.Context) (release func(), acquired bool, err error) {
	ok, err := l.rdb.SetNX(ctx, l.key, "1", l.ttl).Result()
	if err != nil {
		return nil, false, err
	}
	if !ok {
		return nil, false, nil
	}
	release = func() {
		_ = l.rdb.Del(context.Background(), l.key).Err()
	}
	return release, true, nil
}

// AcquireWait tenta adquirir o lock repetidamente, com intervalo fixo, até
// `attempts` tentativas. Útil para serializar operações concorrentes curtas
// (ex.: mensagens consecutivas do mesmo usuário) sem descartá-las.
func (l *DistributedLock) AcquireWait(ctx context.Context, attempts int, interval time.Duration) (release func(), acquired bool, err error) {
	for i := 0; i < attempts; i++ {
		rel, ok, err := l.Acquire(ctx)
		if err != nil {
			return nil, false, err
		}
		if ok {
			return rel, true, nil
		}
		select {
		case <-ctx.Done():
			return nil, false, ctx.Err()
		case <-time.After(interval):
		}
	}
	return nil, false, nil
}
