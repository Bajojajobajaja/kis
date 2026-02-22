package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

type lead struct {
	ID            string    `json:"id"`
	Title         string    `json:"title"`
	Source        string    `json:"source"`
	Channel       string    `json:"channel"`
	Route         string    `json:"route"`
	Status        string    `json:"status"`
	Owner         string    `json:"owner"`
	ClientID      string    `json:"client_id,omitempty"`
	ContactPhone  string    `json:"contact_phone,omitempty"`
	ContactEmail  string    `json:"contact_email,omitempty"`
	SLADeadlineAt time.Time `json:"sla_deadline_at"`
	SLAStatus     string    `json:"sla_status"`
	CreatedAt     time.Time `json:"created_at"`
	LastUpdated   time.Time `json:"last_updated"`
}

type activity struct {
	ID        string    `json:"id"`
	LeadID    string    `json:"lead_id"`
	Type      string    `json:"type"`
	Note      string    `json:"note"`
	DueAt     string    `json:"due_at,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type domainEvent struct {
	ID        string         `json:"id"`
	EventType string         `json:"event_type"`
	EntityID  string         `json:"entity_id"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

var crmLeadsStore = struct {
	sync.RWMutex
	leadSeq     int
	activitySeq int
	eventSeq    int
	leads       []lead
	activities  []activity
	events      []domainEvent
}{}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)

	mux.HandleFunc("/leads", leadsHandler)
	mux.HandleFunc("/leads/", leadActionHandler)
	mux.HandleFunc("/activities", activitiesHandler)
	mux.HandleFunc("/events", eventsHandler)
}

func leadsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		crmLeadsStore.RLock()
		defer crmLeadsStore.RUnlock()

		statusFilter := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("status")))
		routeFilter := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("route")))
		now := time.Now().UTC()
		list := make([]lead, 0, len(crmLeadsStore.leads))
		for _, entity := range crmLeadsStore.leads {
			enriched := withComputedSLA(entity, now)
			if statusFilter != "" && strings.ToLower(enriched.Status) != statusFilter {
				continue
			}
			if routeFilter != "" && strings.ToLower(enriched.Route) != routeFilter {
				continue
			}
			list = append(list, enriched)
		}
		respondJSON(w, http.StatusOK, list)
	case http.MethodPost:
		var req struct {
			Title        string `json:"title"`
			Source       string `json:"source"`
			Channel      string `json:"channel"`
			Owner        string `json:"owner"`
			ClientID     string `json:"client_id"`
			ContactPhone string `json:"contact_phone"`
			ContactEmail string `json:"contact_email"`
			Route        string `json:"route"`
			SLAMinutes   int    `json:"sla_minutes"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.Title == "" {
			respondError(w, http.StatusBadRequest, "title is required")
			return
		}
		phone := normalizePhone(req.ContactPhone)
		email := normalizeEmail(req.ContactEmail)
		if phone == "" && email == "" {
			respondError(w, http.StatusBadRequest, "contact_phone or contact_email is required")
			return
		}
		slaMinutes := defaultInt(req.SLAMinutes, 60)
		if slaMinutes <= 0 || slaMinutes > 7*24*60 {
			respondError(w, http.StatusBadRequest, "sla_minutes must be in range 1..10080")
			return
		}

		now := time.Now().UTC()
		channel := normalizeLeadChannel(defaultValue(req.Channel, req.Source))
		route := normalizeLeadRoute(req.Route)

		crmLeadsStore.Lock()
		defer crmLeadsStore.Unlock()
		if duplicate := findDuplicateLead(phone, email, route); duplicate != nil {
			respondJSON(w, http.StatusConflict, map[string]any{
				"error":             "duplicate lead detected",
				"duplicate_lead_id": duplicate.ID,
				"lead":              withComputedSLA(*duplicate, now),
			})
			return
		}
		crmLeadsStore.leadSeq++
		entity := lead{
			ID:            fmt.Sprintf("ld-%04d", crmLeadsStore.leadSeq),
			Title:         req.Title,
			Source:        defaultValue(req.Source, "manual"),
			Channel:       channel,
			Route:         route,
			Status:        "new",
			Owner:         req.Owner,
			ClientID:      req.ClientID,
			ContactPhone:  phone,
			ContactEmail:  email,
			SLADeadlineAt: now.Add(time.Duration(slaMinutes) * time.Minute),
			SLAStatus:     "on_track",
			CreatedAt:     now,
			LastUpdated:   now,
		}
		crmLeadsStore.leads = append(crmLeadsStore.leads, entity)
		appendLeadEvent("LeadCreated", entity.ID, map[string]any{
			"route":         entity.Route,
			"source":        entity.Source,
			"channel":       entity.Channel,
			"contact_phone": entity.ContactPhone,
			"contact_email": entity.ContactEmail,
			"sla_due_at":    entity.SLADeadlineAt.Format(time.RFC3339),
		})
		respondJSON(w, http.StatusCreated, withComputedSLA(entity, now))
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func leadActionHandler(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 3 || parts[0] != "leads" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}

	leadID := parts[1]
	action := parts[2]
	switch action {
	case "qualify":
		qualifyLeadHandler(w, r, leadID)
	default:
		respondError(w, http.StatusNotFound, "route not found")
	}
}

func qualifyLeadHandler(w http.ResponseWriter, r *http.Request, leadID string) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		Owner    string `json:"owner"`
		ClientID string `json:"client_id"`
		Note     string `json:"note"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	crmLeadsStore.Lock()
	defer crmLeadsStore.Unlock()
	index := findLeadIndex(leadID)
	if index < 0 {
		respondError(w, http.StatusNotFound, "lead not found")
		return
	}

	now := time.Now().UTC()
	entity := crmLeadsStore.leads[index]
	entity.Status = "qualified"
	if req.Owner != "" {
		entity.Owner = req.Owner
	}
	if req.ClientID != "" {
		entity.ClientID = req.ClientID
	}
	entity.LastUpdated = now
	crmLeadsStore.leads[index] = entity

	appendLeadEvent("LeadQualified", entity.ID, map[string]any{
		"owner":     entity.Owner,
		"client_id": entity.ClientID,
		"note":      req.Note,
		"route":     entity.Route,
	})

	respondJSON(w, http.StatusOK, withComputedSLA(entity, now))
}

func activitiesHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		crmLeadsStore.RLock()
		defer crmLeadsStore.RUnlock()
		leadIDFilter := strings.TrimSpace(r.URL.Query().Get("lead_id"))
		if leadIDFilter == "" {
			respondJSON(w, http.StatusOK, crmLeadsStore.activities)
			return
		}

		filtered := make([]activity, 0)
		for _, entity := range crmLeadsStore.activities {
			if entity.LeadID == leadIDFilter {
				filtered = append(filtered, entity)
			}
		}
		respondJSON(w, http.StatusOK, filtered)
	case http.MethodPost:
		var req struct {
			LeadID string `json:"lead_id"`
			Type   string `json:"type"`
			Note   string `json:"note"`
			DueAt  string `json:"due_at"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.LeadID == "" || req.Type == "" {
			respondError(w, http.StatusBadRequest, "lead_id and type are required")
			return
		}

		crmLeadsStore.Lock()
		defer crmLeadsStore.Unlock()
		leadIndex := findLeadIndex(req.LeadID)
		if leadIndex < 0 {
			respondError(w, http.StatusNotFound, "lead not found")
			return
		}
		crmLeadsStore.activitySeq++
		now := time.Now().UTC()
		entity := activity{
			ID:        fmt.Sprintf("la-%04d", crmLeadsStore.activitySeq),
			LeadID:    req.LeadID,
			Type:      req.Type,
			Note:      req.Note,
			DueAt:     req.DueAt,
			CreatedAt: now,
		}
		crmLeadsStore.activities = append(crmLeadsStore.activities, entity)
		crmLeadsStore.leads[leadIndex].LastUpdated = now
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func eventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	crmLeadsStore.RLock()
	defer crmLeadsStore.RUnlock()
	eventTypeFilter := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("event_type")))
	if eventTypeFilter == "" {
		respondJSON(w, http.StatusOK, crmLeadsStore.events)
		return
	}

	filtered := make([]domainEvent, 0)
	for _, event := range crmLeadsStore.events {
		if strings.ToLower(event.EventType) == eventTypeFilter {
			filtered = append(filtered, event)
		}
	}
	respondJSON(w, http.StatusOK, filtered)
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "crm-leads",
		"status":  "ok",
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "crm-leads",
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

func defaultInt(value, fallback int) int {
	if value == 0 {
		return fallback
	}
	return value
}

func normalizeLeadChannel(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "site", "website":
		return "site"
	case "phone", "call", "telephony":
		return "phone"
	case "messenger", "telegram", "whatsapp":
		return "messenger"
	case "marketplace":
		return "marketplace"
	case "", "manual":
		return "manual"
	default:
		return "manual"
	}
}

func normalizeLeadRoute(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "service":
		return "service"
	default:
		return "sales"
	}
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

func normalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func findLeadIndex(id string) int {
	for i := range crmLeadsStore.leads {
		if crmLeadsStore.leads[i].ID == id {
			return i
		}
	}
	return -1
}

func findDuplicateLead(phone, email, route string) *lead {
	for i := range crmLeadsStore.leads {
		entity := crmLeadsStore.leads[i]
		if entity.Route != route || !isDedupActiveStatus(entity.Status) {
			continue
		}
		if phone != "" && entity.ContactPhone == phone {
			copyEntity := entity
			return &copyEntity
		}
		if email != "" && entity.ContactEmail == email {
			copyEntity := entity
			return &copyEntity
		}
	}
	return nil
}

func isDedupActiveStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "lost", "archived", "cancelled":
		return false
	default:
		return true
	}
}

func withComputedSLA(entity lead, now time.Time) lead {
	switch strings.ToLower(entity.Status) {
	case "qualified":
		if now.After(entity.SLADeadlineAt) {
			entity.SLAStatus = "breached"
		} else {
			entity.SLAStatus = "met"
		}
	case "lost", "cancelled", "archived":
		entity.SLAStatus = "n_a"
	default:
		if now.After(entity.SLADeadlineAt) {
			entity.SLAStatus = "breached"
		} else {
			entity.SLAStatus = "on_track"
		}
	}
	return entity
}

func appendLeadEvent(eventType, entityID string, payload map[string]any) {
	crmLeadsStore.eventSeq++
	crmLeadsStore.events = append(crmLeadsStore.events, domainEvent{
		ID:        fmt.Sprintf("lde-%05d", crmLeadsStore.eventSeq),
		EventType: eventType,
		EntityID:  entityID,
		Payload:   payload,
		CreatedAt: time.Now().UTC(),
	})
}
