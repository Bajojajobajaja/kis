package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

type client struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Type        string    `json:"type"`
	Phone       string    `json:"phone"`
	Email       string    `json:"email"`
	Preferences []string  `json:"preferences,omitempty"`
	Tags        []string  `json:"tags,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type contact struct {
	ID       string `json:"id"`
	ClientID string `json:"client_id"`
	Name     string `json:"name"`
	Position string `json:"position"`
	Phone    string `json:"phone"`
	Email    string `json:"email"`
}

type interaction struct {
	ID        string    `json:"id"`
	ClientID  string    `json:"client_id"`
	ContactID string    `json:"contact_id,omitempty"`
	Channel   string    `json:"channel,omitempty"`
	Kind      string    `json:"kind"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

type clientCard struct {
	Client       client        `json:"client"`
	Contacts     []contact     `json:"contacts"`
	Interactions []interaction `json:"interactions"`
	Summary      struct {
		ContactsCount     int    `json:"contacts_count"`
		InteractionsCount int    `json:"interactions_count"`
		LastInteractionAt string `json:"last_interaction_at,omitempty"`
	} `json:"summary"`
}

var crmContactsStore = struct {
	sync.RWMutex
	clientSeq      int
	contactSeq     int
	interactionSeq int
	clients        []client
	contacts       []contact
	interactions   []interaction
}{}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)

	mux.HandleFunc("/clients", clientsHandler)
	mux.HandleFunc("/clients/", clientByIDHandler)
	mux.HandleFunc("/contacts", contactsHandler)
	mux.HandleFunc("/interactions", interactionsHandler)
}

func clientsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		crmContactsStore.RLock()
		defer crmContactsStore.RUnlock()
		tagFilter := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("tag")))
		if tagFilter == "" {
			respondJSON(w, http.StatusOK, crmContactsStore.clients)
			return
		}

		filtered := make([]client, 0)
		for _, entity := range crmContactsStore.clients {
			if containsCaseInsensitive(entity.Tags, tagFilter) {
				filtered = append(filtered, entity)
			}
		}
		respondJSON(w, http.StatusOK, filtered)
	case http.MethodPost:
		var req struct {
			Name        string   `json:"name"`
			Type        string   `json:"type"`
			Phone       string   `json:"phone"`
			Email       string   `json:"email"`
			Preferences []string `json:"preferences"`
			Tags        []string `json:"tags"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.Name == "" {
			respondError(w, http.StatusBadRequest, "name is required")
			return
		}

		now := time.Now().UTC()
		crmContactsStore.Lock()
		defer crmContactsStore.Unlock()
		crmContactsStore.clientSeq++
		entity := client{
			ID:          fmt.Sprintf("cl-%04d", crmContactsStore.clientSeq),
			Name:        req.Name,
			Type:        defaultValue(req.Type, "individual"),
			Phone:       normalizePhone(req.Phone),
			Email:       normalizeEmail(req.Email),
			Preferences: normalizeUniqueList(req.Preferences),
			Tags:        normalizeUniqueList(req.Tags),
			CreatedAt:   now,
			UpdatedAt:   now,
		}
		crmContactsStore.clients = append(crmContactsStore.clients, entity)
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func clientByIDHandler(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 2 || parts[0] != "clients" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}

	clientID := parts[1]
	switch r.Method {
	case http.MethodGet:
		getClientCardHandler(w, clientID)
	case http.MethodPut:
		updateClientHandler(w, r, clientID)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func getClientCardHandler(w http.ResponseWriter, clientID string) {
	crmContactsStore.RLock()
	defer crmContactsStore.RUnlock()

	clientIndex := findClientIndex(clientID)
	if clientIndex < 0 {
		respondError(w, http.StatusNotFound, "client not found")
		return
	}

	card := clientCard{
		Client:       crmContactsStore.clients[clientIndex],
		Contacts:     make([]contact, 0),
		Interactions: make([]interaction, 0),
	}
	var lastInteraction time.Time
	for _, entity := range crmContactsStore.contacts {
		if entity.ClientID == clientID {
			card.Contacts = append(card.Contacts, entity)
		}
	}
	for _, entity := range crmContactsStore.interactions {
		if entity.ClientID == clientID {
			card.Interactions = append(card.Interactions, entity)
			if entity.CreatedAt.After(lastInteraction) {
				lastInteraction = entity.CreatedAt
			}
		}
	}
	card.Summary.ContactsCount = len(card.Contacts)
	card.Summary.InteractionsCount = len(card.Interactions)
	if !lastInteraction.IsZero() {
		card.Summary.LastInteractionAt = lastInteraction.Format(time.RFC3339)
	}
	respondJSON(w, http.StatusOK, card)
}

func updateClientHandler(w http.ResponseWriter, r *http.Request, clientID string) {
	var req struct {
		Name        string   `json:"name"`
		Type        string   `json:"type"`
		Phone       string   `json:"phone"`
		Email       string   `json:"email"`
		Preferences []string `json:"preferences"`
		Tags        []string `json:"tags"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	crmContactsStore.Lock()
	defer crmContactsStore.Unlock()
	clientIndex := findClientIndex(clientID)
	if clientIndex < 0 {
		respondError(w, http.StatusNotFound, "client not found")
		return
	}

	entity := crmContactsStore.clients[clientIndex]
	if req.Name != "" {
		entity.Name = req.Name
	}
	if req.Type != "" {
		entity.Type = req.Type
	}
	if req.Phone != "" {
		entity.Phone = normalizePhone(req.Phone)
	}
	if req.Email != "" {
		entity.Email = normalizeEmail(req.Email)
	}
	if req.Preferences != nil {
		entity.Preferences = normalizeUniqueList(req.Preferences)
	}
	if req.Tags != nil {
		entity.Tags = normalizeUniqueList(req.Tags)
	}
	entity.UpdatedAt = time.Now().UTC()
	crmContactsStore.clients[clientIndex] = entity
	respondJSON(w, http.StatusOK, entity)
}

func contactsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		crmContactsStore.RLock()
		defer crmContactsStore.RUnlock()
		clientIDFilter := strings.TrimSpace(r.URL.Query().Get("client_id"))
		if clientIDFilter == "" {
			respondJSON(w, http.StatusOK, crmContactsStore.contacts)
			return
		}

		filtered := make([]contact, 0)
		for _, entity := range crmContactsStore.contacts {
			if entity.ClientID == clientIDFilter {
				filtered = append(filtered, entity)
			}
		}
		respondJSON(w, http.StatusOK, filtered)
	case http.MethodPost:
		var req struct {
			ClientID string `json:"client_id"`
			Name     string `json:"name"`
			Position string `json:"position"`
			Phone    string `json:"phone"`
			Email    string `json:"email"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.ClientID == "" || req.Name == "" {
			respondError(w, http.StatusBadRequest, "client_id and name are required")
			return
		}

		crmContactsStore.Lock()
		defer crmContactsStore.Unlock()
		if findClientIndex(req.ClientID) < 0 {
			respondError(w, http.StatusNotFound, "client not found")
			return
		}
		crmContactsStore.contactSeq++
		entity := contact{
			ID:       fmt.Sprintf("ct-%04d", crmContactsStore.contactSeq),
			ClientID: req.ClientID,
			Name:     req.Name,
			Position: req.Position,
			Phone:    normalizePhone(req.Phone),
			Email:    normalizeEmail(req.Email),
		}
		crmContactsStore.contacts = append(crmContactsStore.contacts, entity)
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func interactionsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		crmContactsStore.RLock()
		defer crmContactsStore.RUnlock()
		clientIDFilter := strings.TrimSpace(r.URL.Query().Get("client_id"))
		if clientIDFilter == "" {
			respondJSON(w, http.StatusOK, crmContactsStore.interactions)
			return
		}

		filtered := make([]interaction, 0)
		for _, entity := range crmContactsStore.interactions {
			if entity.ClientID == clientIDFilter {
				filtered = append(filtered, entity)
			}
		}
		respondJSON(w, http.StatusOK, filtered)
	case http.MethodPost:
		var req struct {
			ClientID  string `json:"client_id"`
			ContactID string `json:"contact_id"`
			Channel   string `json:"channel"`
			Kind      string `json:"kind"`
			Note      string `json:"note"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.ClientID == "" || req.Kind == "" {
			respondError(w, http.StatusBadRequest, "client_id and kind are required")
			return
		}

		crmContactsStore.Lock()
		defer crmContactsStore.Unlock()
		clientIndex := findClientIndex(req.ClientID)
		if clientIndex < 0 {
			respondError(w, http.StatusNotFound, "client not found")
			return
		}
		if req.ContactID != "" && findContactIndex(req.ContactID, req.ClientID) < 0 {
			respondError(w, http.StatusNotFound, "contact not found")
			return
		}
		crmContactsStore.interactionSeq++
		now := time.Now().UTC()
		entity := interaction{
			ID:        fmt.Sprintf("in-%04d", crmContactsStore.interactionSeq),
			ClientID:  req.ClientID,
			ContactID: req.ContactID,
			Channel:   defaultValue(strings.ToLower(strings.TrimSpace(req.Channel)), "manual"),
			Kind:      req.Kind,
			Note:      req.Note,
			CreatedAt: now,
		}
		crmContactsStore.interactions = append(crmContactsStore.interactions, entity)
		crmContactsStore.clients[clientIndex].UpdatedAt = now
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "crm-contacts",
		"status":  "ok",
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "crm-contacts",
		"status":  "ready",
	})
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return fmt.Errorf("invalid json: %w", err)
	}
	return nil
}

func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, map[string]string{"error": message})
}

func respondJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func defaultValue(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func findClientIndex(id string) int {
	for i := range crmContactsStore.clients {
		if crmContactsStore.clients[i].ID == id {
			return i
		}
	}
	return -1
}

func findContactIndex(contactID, clientID string) int {
	for i := range crmContactsStore.contacts {
		if crmContactsStore.contacts[i].ID == contactID && crmContactsStore.contacts[i].ClientID == clientID {
			return i
		}
	}
	return -1
}

func normalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func normalizePhone(value string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(value) {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func normalizeUniqueList(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, raw := range values {
		value := strings.ToLower(strings.TrimSpace(raw))
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func containsCaseInsensitive(values []string, filter string) bool {
	for _, value := range values {
		if strings.EqualFold(value, filter) {
			return true
		}
	}
	return false
}
