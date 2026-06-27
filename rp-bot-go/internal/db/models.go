package db

import "time"

type GuildConfig struct {
	GuildID               string
	LogChannelID          string
	TicketCategoryID      string
	TicketLogChannelID    string
	WhitelistChannelID    string
	WhitelistLogChannelID string
	WhitelistRoleID       string
	VerifiedRoleID        string
	StaffRoleID           string
	AdminRoleID           string
	MaxTicketsPerUser     int
	TicketPrefix          string
	WhitelistPassMessage  string
	WhitelistFailMessage  string
	WelcomeMessage        string
	WhitelistPassScore    int
	PanelConfigs          PanelConfigs
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

// ExtendedConfig contém as configurações visuais e de notificação gerenciadas
// pelo painel admin (schema site). Lidas separadamente do GuildConfig.
type ExtendedConfig struct {
	EmbedColor      int    // cor hex (ex: 0x8B0000)
	TicketImageURL  string
	WelcomeImageURL string
	DmNotifyDefault bool
}

type Ticket struct {
	ID           int64
	GuildID      string
	ChannelID    string
	UserID       string
	TicketNumber int
	Category     string
	Status       string
	ClaimedStaff []ClaimedStaffEntry
	DmNotify     bool
	CreatedAt    time.Time
	ClosedAt     *time.Time
	CloseReason  string
}

type TicketMessage struct {
	ID          int64
	TicketID    int64
	AuthorID    string
	AuthorName  string
	Content     string
	Attachments string
	CreatedAt   time.Time
}

type AllowlistApplication struct {
	ID                int64
	GuildID           string
	UserID            string
	ChannelID         string
	AppNumber         int
	Status            string
	Answers           map[string]string
	CurrentQuestion   int
	QuizState         QuizState
	StartedAt         *time.Time
	QuestionStartedAt *time.Time
	ReviewedBy        string
	ReviewNote        string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type AuditLog struct {
	ID        int64
	GuildID   string
	ActorID   string
	Action    string
	TargetID  *string
	Meta      map[string]any
	CreatedAt time.Time
}

type VerificationAttempt struct {
	ID        int64
	GuildID   string
	UserID    string
	Success   bool
	CreatedAt time.Time
}

type ClaimedStaffEntry struct {
	UserID    string    `json:"user_id"`
	ClaimedAt time.Time `json:"claimed_at"`
}

// PanelEmbed é a configuração de um embed de painel.
type PanelEmbed struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	ButtonLabel string `json:"button_label"`
	Placeholder string `json:"placeholder"`
}

// PanelConfigs agrupa as configs de embed de cada painel.
type PanelConfigs struct {
	Whitelist    PanelEmbed `json:"whitelist"`
	Tickets      PanelEmbed `json:"tickets"`
	Verification PanelEmbed `json:"verification"`
}

func (p *PanelConfigs) WhitelistEmbed() PanelEmbed {
	e := p.Whitelist
	if e.Title == "" {
		e.Title = "📋 Painel de Whitelist"
	}
	if e.Description == "" {
		e.Description = "Clique no botão abaixo para iniciar sua whitelist.\n\nVocê responderá a um formulário inicial e, em seguida, fará a prova teórica em um canal privado.\n\n**Como funciona**\n> Clique em Iniciar Whitelist\n> Preencha o nome do personagem e o ID do FiveM\n> Responda às perguntas teóricas configuradas no painel web\n> Se passar, aguarde a entrevista com a equipe"
	}
	if e.ButtonLabel == "" {
		e.ButtonLabel = "📝 Iniciar Whitelist"
	}
	return e
}

func (p *PanelConfigs) TicketsEmbed() PanelEmbed {
	e := p.Tickets
	if e.Title == "" {
		e.Title = "🎫 Suporte"
	}
	if e.Description == "" {
		e.Description = "Selecione uma categoria abaixo para abrir um ticket com a equipe."
	}
	if e.Placeholder == "" {
		e.Placeholder = "Escolha uma categoria..."
	}
	return e
}

func (p *PanelConfigs) VerificationEmbed() PanelEmbed {
	e := p.Verification
	if e.Title == "" {
		e.Title = "✅ Verificação"
	}
	if e.Description == "" {
		e.Description = "Clique no botão abaixo para verificar sua conta e obter acesso ao servidor."
	}
	if e.ButtonLabel == "" {
		e.ButtonLabel = "✅ Verificar"
	}
	return e
}

// QuizQuestion é uma pergunta do questionário de whitelist.
type QuizQuestion struct {
	Q            string
	Field        string
	Type         string   // "open" (padrão) ou "quiz"
	Options      []string // opções para perguntas do tipo quiz
	CorrectIndex int      // índice 0-based da opção correta
}

// QuizState guarda a ordem embaralhada das perguntas/opções e os resultados.
type QuizState struct {
	QuestionOrder []int            `json:"question_order"`
	OptionOrders  map[string][]int `json:"option_orders"`
	Results       map[string]bool  `json:"results"`
	PassScore     int              `json:"pass_score"`
}

// BotAction representa uma ação enfileirada pelo painel admin para o bot executar.
// Armazenada em site.bot_actions.
type BotAction struct {
	ID          int64
	GuildID     string
	ActionType  string         // "set_presence"
	Payload     map[string]any
	Status      string         // "pending" | "done" | "failed"
	Result      string
	CreatedAt   time.Time
	ProcessedAt *time.Time
}
