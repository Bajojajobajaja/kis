package httptransport

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

type costingResult struct {
	ID             string    `json:"id"`
	SourceID       string    `json:"source_id"`
	Domain         string    `json:"domain"`
	Revenue        float64   `json:"revenue"`
	Quantity       float64   `json:"quantity"`
	MaterialsCost  float64   `json:"materials_cost"`
	LaborCost      float64   `json:"labor_cost"`
	OverheadCost   float64   `json:"overhead_cost"`
	LogisticsCost  float64   `json:"logistics_cost"`
	AdditionalCost float64   `json:"additional_cost"`
	TotalCost      float64   `json:"total_cost"`
	UnitCost       float64   `json:"unit_cost"`
	Margin         float64   `json:"margin"`
	MarginPct      float64   `json:"margin_pct"`
	Calculated     time.Time `json:"calculated_at"`
}

type costingModel struct {
	ID               string    `json:"id"`
	Domain           string    `json:"domain"`
	OverheadRatePct  float64   `json:"overhead_rate_pct"`
	LogisticsRatePct float64   `json:"logistics_rate_pct"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type costingEvent struct {
	ID        string         `json:"id"`
	EventType string         `json:"event_type"`
	EntityID  string         `json:"entity_id"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

var costingStore = struct {
	sync.RWMutex
	seq      int
	modelSeq int
	eventSeq int
	history  []costingResult
	models   []costingModel
	events   []costingEvent
}{
	models: []costingModel{
		{ID: "cm-0001", Domain: "sales", OverheadRatePct: 5, LogisticsRatePct: 1.8, UpdatedAt: time.Now().UTC()},
		{ID: "cm-0002", Domain: "service", OverheadRatePct: 7, LogisticsRatePct: 0.5, UpdatedAt: time.Now().UTC()},
		{ID: "cm-0003", Domain: "inventory", OverheadRatePct: 4, LogisticsRatePct: 2.2, UpdatedAt: time.Now().UTC()},
	},
}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)
	mux.HandleFunc("/costing/calc", costingHandler)
	mux.HandleFunc("/costing/summary", summaryHandler)
	mux.HandleFunc("/costing/models", modelsHandler)
	mux.HandleFunc("/events", eventsHandler)
}

func costingHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		costingStore.RLock()
		defer costingStore.RUnlock()
		domainFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("domain")))
		out := make([]costingResult, 0, len(costingStore.history))
		for _, entity := range costingStore.history {
			if domainFilter != "" && strings.ToLower(entity.Domain) != domainFilter {
				continue
			}
			out = append(out, entity)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Calculated.After(out[j].Calculated) })
		respondJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req struct {
			SourceID       string  `json:"source_id"`
			Domain         string  `json:"domain"`
			Revenue        float64 `json:"revenue"`
			Quantity       float64 `json:"quantity"`
			MaterialsCost  float64 `json:"materials_cost"`
			LaborCost      float64 `json:"labor_cost"`
			OverheadCost   float64 `json:"overhead_cost"`
			LogisticsCost  float64 `json:"logistics_cost"`
			AdditionalCost float64 `json:"additional_cost"`
			UseModelRates  bool    `json:"use_model_rates"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.Revenue < 0 || req.MaterialsCost < 0 || req.LaborCost < 0 || req.OverheadCost < 0 || req.LogisticsCost < 0 || req.AdditionalCost < 0 {
			respondError(w, http.StatusBadRequest, "revenue and costs must be non-negative")
			return
		}
		domain := strings.ToLower(defaultValue(req.Domain, "sales"))
		if !isAllowedDomain(domain) {
			respondError(w, http.StatusBadRequest, "unsupported domain")
			return
		}
		quantity := req.Quantity
		if quantity <= 0 {
			quantity = 1
		}

		materialsCost := req.MaterialsCost
		laborCost := req.LaborCost
		overheadCost := req.OverheadCost
		logisticsCost := req.LogisticsCost
		additionalCost := req.AdditionalCost

		costingStore.Lock()
		defer costingStore.Unlock()
		if req.UseModelRates {
			if model := findModelByDomainLocked(domain); model != nil {
				base := materialsCost + laborCost
				overheadCost += base * model.OverheadRatePct / 100
				logisticsCost += base * model.LogisticsRatePct / 100
			}
		}

		totalCost := round2(materialsCost + laborCost + overheadCost + logisticsCost + additionalCost)
		margin := round2(req.Revenue - totalCost)
		marginPct := 0.0
		if req.Revenue > 0 {
			marginPct = round2((margin / req.Revenue) * 100)
		}
		unitCost := round2(totalCost / quantity)

		costingStore.seq++
		entity := costingResult{
			ID:             fmt.Sprintf("cs-%05d", costingStore.seq),
			SourceID:       defaultValue(req.SourceID, fmt.Sprintf("%s-%05d", domain, costingStore.seq)),
			Domain:         domain,
			Revenue:        round2(req.Revenue),
			Quantity:       quantity,
			MaterialsCost:  round2(materialsCost),
			LaborCost:      round2(laborCost),
			OverheadCost:   round2(overheadCost),
			LogisticsCost:  round2(logisticsCost),
			AdditionalCost: round2(additionalCost),
			TotalCost:      totalCost,
			UnitCost:       unitCost,
			Margin:         margin,
			MarginPct:      marginPct,
			Calculated:     time.Now().UTC(),
		}
		costingStore.history = append(costingStore.history, entity)
		appendCostingEvent("CostCalculated", entity.ID, map[string]any{
			"domain":     entity.Domain,
			"margin_pct": entity.MarginPct,
			"total_cost": entity.TotalCost,
		})
		respondJSON(w, http.StatusOK, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func summaryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	costingStore.RLock()
	defer costingStore.RUnlock()
	type aggregate struct {
		Revenue   float64 `json:"revenue"`
		TotalCost float64 `json:"total_cost"`
		Margin    float64 `json:"margin"`
		MarginPct float64 `json:"margin_pct"`
		Count     int     `json:"count"`
	}
	byDomain := map[string]*aggregate{}
	for _, result := range costingStore.history {
		entry := byDomain[result.Domain]
		if entry == nil {
			entry = &aggregate{}
			byDomain[result.Domain] = entry
		}
		entry.Revenue = round2(entry.Revenue + result.Revenue)
		entry.TotalCost = round2(entry.TotalCost + result.TotalCost)
		entry.Margin = round2(entry.Margin + result.Margin)
		entry.Count++
	}
	for _, entry := range byDomain {
		if entry.Revenue > 0 {
			entry.MarginPct = round2((entry.Margin / entry.Revenue) * 100)
		}
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"domains": byDomain,
		"count":   len(costingStore.history),
	})
}

func modelsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		costingStore.RLock()
		defer costingStore.RUnlock()
		respondJSON(w, http.StatusOK, costingStore.models)
	case http.MethodPost:
		var req struct {
			Domain           string  `json:"domain"`
			OverheadRatePct  float64 `json:"overhead_rate_pct"`
			LogisticsRatePct float64 `json:"logistics_rate_pct"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		domain := strings.ToLower(strings.TrimSpace(req.Domain))
		if !isAllowedDomain(domain) {
			respondError(w, http.StatusBadRequest, "unsupported domain")
			return
		}
		if req.OverheadRatePct < 0 || req.LogisticsRatePct < 0 {
			respondError(w, http.StatusBadRequest, "rates must be non-negative")
			return
		}
		now := time.Now().UTC()
		costingStore.Lock()
		defer costingStore.Unlock()
		if existing := findModelByDomainLocked(domain); existing != nil {
			existing.OverheadRatePct = round2(req.OverheadRatePct)
			existing.LogisticsRatePct = round2(req.LogisticsRatePct)
			existing.UpdatedAt = now
			appendCostingEvent("CostingModelUpdated", existing.ID, map[string]any{
				"domain":             existing.Domain,
				"overhead_rate_pct":  existing.OverheadRatePct,
				"logistics_rate_pct": existing.LogisticsRatePct,
			})
			respondJSON(w, http.StatusOK, existing)
			return
		}

		costingStore.modelSeq++
		entity := costingModel{
			ID:               fmt.Sprintf("cm-%05d", costingStore.modelSeq),
			Domain:           domain,
			OverheadRatePct:  round2(req.OverheadRatePct),
			LogisticsRatePct: round2(req.LogisticsRatePct),
			UpdatedAt:        now,
		}
		costingStore.models = append(costingStore.models, entity)
		appendCostingEvent("CostingModelCreated", entity.ID, map[string]any{
			"domain": entity.Domain,
		})
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
	costingStore.RLock()
	defer costingStore.RUnlock()
	respondJSON(w, http.StatusOK, costingStore.events)
}

func appendCostingEvent(eventType, entityID string, payload map[string]any) {
	costingStore.eventSeq++
	costingStore.events = append(costingStore.events, costingEvent{
		ID:        fmt.Sprintf("fce-%05d", costingStore.eventSeq),
		EventType: eventType,
		EntityID:  entityID,
		Payload:   payload,
		CreatedAt: time.Now().UTC(),
	})
}

func findModelByDomainLocked(domain string) *costingModel {
	for i := range costingStore.models {
		if costingStore.models[i].Domain == domain {
			return &costingStore.models[i]
		}
	}
	return nil
}

func isAllowedDomain(domain string) bool {
	switch domain {
	case "sales", "service", "inventory":
		return true
	default:
		return false
	}
}

func round2(value float64) float64 {
	return math.Round(value*100) / 100
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "finance-costing",
		"status":  "ok",
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "finance-costing",
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
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}
