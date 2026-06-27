package services

import "sync"

// ChannelKind identifica o tipo de canal ativo rastreado pelo bot.
type ChannelKind int

const (
	ChannelTicket ChannelKind = iota
	ChannelApp
)

// ChannelCache mantém em memória os canais "ativos" (tickets abertos e
// aplicações de whitelist em preenchimento) para evitar uma query ao banco a
// cada mensagem recebida.
//
// Invariante: um canal está no cache iff há trabalho ativo nele
//   - ChannelTicket  -> ticket com status open/claimed
//   - ChannelApp     -> aplicação com status 'pending' (coletando respostas)
//
// Enquanto Ready() for false (cache ainda não aquecido), os handlers devem
// cair no fallback ao banco. Assim o cache nunca descarta uma mensagem legítima
// por estar frio — ele é uma otimização de performance, não um gate de
// correção.
type ChannelCache struct {
	mu    sync.RWMutex
	m     map[string]ChannelKind
	ready bool
}

func NewChannelCache() *ChannelCache {
	return &ChannelCache{m: make(map[string]ChannelKind)}
}

// Add registra um canal ativo.
func (c *ChannelCache) Add(id string, kind ChannelKind) {
	if id == "" {
		return
	}
	c.mu.Lock()
	c.m[id] = kind
	c.mu.Unlock()
}

// Remove descarta um canal que deixou de ser ativo (idempotente).
func (c *ChannelCache) Remove(id string) {
	if id == "" {
		return
	}
	c.mu.Lock()
	delete(c.m, id)
	c.mu.Unlock()
}

// Ready indica se o cache já foi populado e pode ser usado como autoritativo.
func (c *ChannelCache) Ready() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.ready
}

// Is retorna true se o canal está no cache com o tipo informado.
func (c *ChannelCache) Is(id string, kind ChannelKind) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	k, ok := c.m[id]
	return ok && k == kind
}

// Warm popula o cache a partir das listas fornecidas e o marca como pronto.
// Deve ser chamado uma vez, no startup, somente quando as listas foram lidas
// com sucesso do banco.
func (c *ChannelCache) Warm(ticketChannelIDs, appChannelIDs []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, id := range ticketChannelIDs {
		if id != "" {
			c.m[id] = ChannelTicket
		}
	}
	for _, id := range appChannelIDs {
		if id != "" {
			c.m[id] = ChannelApp
		}
	}
	c.ready = true
}
