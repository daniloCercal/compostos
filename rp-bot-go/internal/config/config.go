package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config holds all validated environment settings.
type Config struct {
	// Discord
	DiscordToken   string
	DiscordGuildID string

	// Database
	DatabaseURL string

	// Redis
	RedisURL string

	// License
	LicenseEnforcementEnabled bool
	LicensePublicKey          string

	// Observability
	SentryDSN      string
	PrometheusPort int
	MetricsPort    string

	// Bot
	Environment string
	LogLevel    string

	// Feature limits
	MaxOpenTicketsPerUser          int
	VerificationMaxAttempts        int
	VerificationLockoutMinutes     int
	MaxAllowlistApplicationsPerDay int

	// Rate limits (requests per minute)
	RateLimitTicketCreate int
	RateLimitVerification int
	RateLimitAllowlist    int

	// Transcripts
	TranscriptFormat      string
	TranscriptStoragePath string
}

// Load reads and validates all settings from environment variables.
func Load() (*Config, error) {
	c := &Config{
		DiscordToken:                   requireEnv("DISCORD_TOKEN"),
		DiscordGuildID:                 os.Getenv("DISCORD_GUILD_ID"),
		DatabaseURL:                    requireEnv("DATABASE_URL"),
		RedisURL:                       envOr("REDIS_URL", "redis://localhost:6379/0"),
		LicenseEnforcementEnabled:      envBool("LICENSE_ENFORCEMENT_ENABLED", false),
		LicensePublicKey:               os.Getenv("LICENSE_PUBLIC_KEY"),
		SentryDSN:                      os.Getenv("SENTRY_DSN"),
		PrometheusPort:                 envInt("PROMETHEUS_PORT", 8000),
		MetricsPort:                    envOr("METRICS_PORT", "9090"),
		Environment:                    envOr("ENVIRONMENT", "production"),
		LogLevel:                       envOr("LOG_LEVEL", "INFO"),
		MaxOpenTicketsPerUser:          envInt("MAX_OPEN_TICKETS_PER_USER", 3),
		VerificationMaxAttempts:        envInt("VERIFICATION_MAX_ATTEMPTS", 5),
		VerificationLockoutMinutes:     envInt("VERIFICATION_LOCKOUT_MINUTES", 30),
		MaxAllowlistApplicationsPerDay: envInt("MAX_ALLOWLIST_APPLICATIONS_PER_DAY", 5),
		RateLimitTicketCreate:          envInt("RATE_LIMIT_TICKET_CREATE", 5),
		RateLimitVerification:          envInt("RATE_LIMIT_VERIFICATION", 10),
		RateLimitAllowlist:             envInt("RATE_LIMIT_ALLOWLIST", 3),
		TranscriptFormat:               envOr("TRANSCRIPT_FORMAT", "html"),
		TranscriptStoragePath:          envOr("TRANSCRIPT_STORAGE_PATH", "./transcripts"),
	}
	return c, c.validate()
}

func (c *Config) validate() error {
	var errs []string
	if len(c.DiscordToken) < 50 {
		errs = append(errs, "DISCORD_TOKEN too short or missing")
	}
	if !strings.Contains(c.DatabaseURL, "postgres") {
		errs = append(errs, "DATABASE_URL must be a postgres:// DSN")
	}
	if c.LicenseEnforcementEnabled && len(strings.TrimSpace(c.LicensePublicKey)) < 32 {
		errs = append(errs, "LICENSE_PUBLIC_KEY required when enforcement enabled")
	}
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	return nil
}

func requireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		panic(fmt.Sprintf("required env var %s is not set", key))
	}
	return v
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envBool(key string, def bool) bool {
	switch strings.ToLower(os.Getenv(key)) {
	case "true", "1", "yes":
		return true
	case "false", "0", "no":
		return false
	}
	return def
}
