package config

// Ticket statuses
const (
	TicketStatusOpen    = "open"
	TicketStatusClaimed = "claimed"
	TicketStatusClosed  = "closed"
)

// Application statuses
const (
	AppStatusPending  = "pending"
	AppStatusApproved = "approved"
	AppStatusRejected = "rejected"
)

// Audit actions
const (
	AuditConfigUpdated            = "config_updated"
	AuditCommandsSynced           = "commands_synced"
	AuditVerificationPanelCreated = "verification_panel_created"
	AuditAllowlistPanelCreated    = "allowlist_panel_created"
	AuditTicketPanelCreated       = "ticket_panel_created"
	AuditVerificationSuccess      = "verification_success"
	AuditVerificationFailure      = "verification_failure"
	AuditAllowlistSubmitted       = "allowlist_submitted"
	AuditAllowlistApproved        = "allowlist_approved"
	AuditAllowlistRejected        = "allowlist_rejected"
	AuditTicketCreated            = "ticket_created"
	AuditTicketClaimed            = "ticket_claimed"
	AuditTicketClosed             = "ticket_closed"
)

// Redis key templates (use fmt.Sprintf to fill placeholders)
const (
	RedisKeyRateLimit        = "ratelimit:%d:%d:%s"
	RedisKeyVerifyAttempts   = "verification:%d:%d:attempts"
	RedisKeyVerifyLockout    = "verification:%d:%d:lockout"
	RedisKeyTicketLock       = "ticket:lock:%d:%d"
	RedisKeyTicketQueue      = "ticket_queue:%d:%s"
	RedisKeyEscalateLock     = "ticket:escalate:%d"
	RedisKeyAllowlistDaily   = "allowlist:daily:%d:%d"
	RedisKeyBotPresence      = "bot:presence:config"
	RedisKeyWhitelistSession = "whitelist:session:%d"
)

// Embed colours (hex)
const (
	ColorSuccess = 0x00FF00
	ColorError   = 0xFF0000
	ColorWarning = 0xFFA500
	ColorInfo    = 0x0099FF
	ColorNeutral = 0x95A5A6
	ColorDarkRed = 0x8B0000 // padrão para todos os embeds do bot
)
