package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

type laborItem struct {
	Code             string    `json:"code"`
	Name             string    `json:"name"`
	Category         string    `json:"category"`
	NormHours        float64   `json:"norm_hours"`
	HourlyRate       float64   `json:"hourly_rate"`
	WarrantyEligible bool      `json:"warranty_eligible"`
	RequiredParts    []string  `json:"required_parts,omitempty"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type laborEstimateLine struct {
	Code     string  `json:"code"`
	Quantity float64 `json:"quantity"`
}

type laborCatalogEvent struct {
	ID        string         `json:"id"`
	EventType string         `json:"event_type"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

var laborCatalogStore = struct {
	sync.RWMutex
	eventSeq int
	items    []laborItem
	events   []laborCatalogEvent
}{
	items: []laborItem{
		{
			Code:             "LBR-OIL",
			Name:             "Oil Change",
			Category:         "maintenance",
			NormHours:        1.2,
			HourlyRate:       85,
			WarrantyEligible: false,
			RequiredParts:    []string{"PART-OIL-FILTER", "PART-ENGINE-OIL"},
			UpdatedAt:        time.Now().UTC(),
		},
		{
			Code:             "LBR-BRAKE",
			Name:             "Brake Diagnostics",
			Category:         "diagnostics",
			NormHours:        1.5,
			HourlyRate:       95,
			WarrantyEligible: true,
			RequiredParts:    []string{},
			UpdatedAt:        time.Now().UTC(),
		},
	},
}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)
	mux.HandleFunc("/labor/catalog", laborCatalogHandler)
	mux.HandleFunc("/labor/catalog/", laborCatalogByCodeHandler)
	mux.HandleFunc("/labor/estimate", laborEstimateHandler)
	mux.HandleFunc("/events", laborCatalogEventsHandler)
}

func laborCatalogHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		laborCatalogStore.RLock()
		defer laborCatalogStore.RUnlock()
		categoryFilter := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("category")))
		if categoryFilter == "" {
			respondJSON(w, http.StatusOK, laborCatalogStore.items)
			return
		}

		filtered := make([]laborItem, 0)
		for _, item := range laborCatalogStore.items {
			if strings.EqualFold(item.Category, categoryFilter) {
				filtered = append(filtered, item)
			}
		}
		respondJSON(w, http.StatusOK, filtered)
	case http.MethodPost:
		var req laborItem
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.Code == "" || req.Name == "" {
			respondError(w, http.StatusBadRequest, "code and name are required")
			return
		}
		if req.NormHours <= 0 || req.HourlyRate <= 0 {
			respondError(w, http.StatusBadRequest, "norm_hours and hourly_rate must be positive")
			return
		}

		laborCatalogStore.Lock()
		defer laborCatalogStore.Unlock()
		if findLaborItemIndex(req.Code) >= 0 {
			respondError(w, http.StatusConflict, "labor code already exists")
			return
		}
		req.Code = strings.ToUpper(strings.TrimSpace(req.Code))
		req.Category = defaultValue(strings.ToLower(strings.TrimSpace(req.Category)), "general")
		req.RequiredParts = normalizeParts(req.RequiredParts)
		req.UpdatedAt = time.Now().UTC()

		laborCatalogStore.items = append(laborCatalogStore.items, req)
		appendLaborCatalogEvent("LaborCatalogItemCreated", map[string]any{
			"code":     req.Code,
			"category": req.Category,
		})
		respondJSON(w, http.StatusCreated, req)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func laborCatalogByCodeHandler(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 3 || parts[0] != "labor" || parts[1] != "catalog" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}
	code := strings.ToUpper(strings.TrimSpace(parts[2]))

	switch r.Method {
	case http.MethodGet:
		laborCatalogStore.RLock()
		defer laborCatalogStore.RUnlock()
		index := findLaborItemIndex(code)
		if index < 0 {
			respondError(w, http.StatusNotFound, "labor item not found")
			return
		}
		respondJSON(w, http.StatusOK, laborCatalogStore.items[index])
	case http.MethodPut:
		var req struct {
			Name             string   `json:"name"`
			Category         string   `json:"category"`
			NormHours        float64  `json:"norm_hours"`
			HourlyRate       float64  `json:"hourly_rate"`
			WarrantyEligible *bool    `json:"warranty_eligible"`
			RequiredParts    []string `json:"required_parts"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}

		laborCatalogStore.Lock()
		defer laborCatalogStore.Unlock()
		index := findLaborItemIndex(code)
		if index < 0 {
			respondError(w, http.StatusNotFound, "labor item not found")
			return
		}
		item := laborCatalogStore.items[index]
		if req.Name != "" {
			item.Name = req.Name
		}
		if req.Category != "" {
			item.Category = strings.ToLower(strings.TrimSpace(req.Category))
		}
		if req.NormHours > 0 {
			item.NormHours = req.NormHours
		}
		if req.HourlyRate > 0 {
			item.HourlyRate = req.HourlyRate
		}
		if req.WarrantyEligible != nil {
			item.WarrantyEligible = *req.WarrantyEligible
		}
		if req.RequiredParts != nil {
			item.RequiredParts = normalizeParts(req.RequiredParts)
		}
		item.UpdatedAt = time.Now().UTC()
		laborCatalogStore.items[index] = item

		appendLaborCatalogEvent("LaborCatalogItemUpdated", map[string]any{
			"code": code,
		})
		respondJSON(w, http.StatusOK, item)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func laborEstimateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		Lines []laborEstimateLine `json:"lines"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(req.Lines) == 0 {
		respondError(w, http.StatusBadRequest, "lines are required")
		return
	}

	laborCatalogStore.RLock()
	defer laborCatalogStore.RUnlock()

	totalNormHours := 0.0
	totalLabor := 0.0
	breakdown := make([]map[string]any, 0, len(req.Lines))
	for _, line := range req.Lines {
		if line.Code == "" || line.Quantity <= 0 {
			respondError(w, http.StatusBadRequest, "line code and positive quantity are required")
			return
		}
		itemIndex := findLaborItemIndex(strings.ToUpper(strings.TrimSpace(line.Code)))
		if itemIndex < 0 {
			respondError(w, http.StatusBadRequest, "unknown labor code: "+line.Code)
			return
		}
		item := laborCatalogStore.items[itemIndex]
		lineHours := item.NormHours * line.Quantity
		lineAmount := lineHours * item.HourlyRate
		totalNormHours += lineHours
		totalLabor += lineAmount
		breakdown = append(breakdown, map[string]any{
			"code":       item.Code,
			"quantity":   line.Quantity,
			"norm_hours": roundMoney(lineHours),
			"amount":     roundMoney(lineAmount),
		})
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"total_norm_hours": roundMoney(totalNormHours),
		"labor_total":      roundMoney(totalLabor),
		"breakdown":        breakdown,
	})
}

func laborCatalogEventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	laborCatalogStore.RLock()
	defer laborCatalogStore.RUnlock()
	respondJSON(w, http.StatusOK, laborCatalogStore.events)
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "service-labor-catalog",
		"status":  "ok",
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "service-labor-catalog",
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

func findLaborItemIndex(code string) int {
	for i := range laborCatalogStore.items {
		if laborCatalogStore.items[i].Code == code {
			return i
		}
	}
	return -1
}

func normalizeParts(parts []string) []string {
	if len(parts) == 0 {
		return nil
	}
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, raw := range parts {
		part := strings.ToUpper(strings.TrimSpace(raw))
		if part == "" || seen[part] {
			continue
		}
		seen[part] = true
		out = append(out, part)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func appendLaborCatalogEvent(eventType string, payload map[string]any) {
	laborCatalogStore.eventSeq++
	laborCatalogStore.events = append(laborCatalogStore.events, laborCatalogEvent{
		ID:        fmt.Sprintf("lce-%05d", laborCatalogStore.eventSeq),
		EventType: eventType,
		Payload:   payload,
		CreatedAt: time.Now().UTC(),
	})
}

func defaultValue(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func roundMoney(value float64) float64 {
	return float64(int(value*100+0.5)) / 100
}
