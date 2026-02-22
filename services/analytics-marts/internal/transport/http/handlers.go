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

type martSnapshot struct {
	ID                string    `json:"id"`
	Domain            string    `json:"domain"`
	Revenue           float64   `json:"revenue"`
	Expenses          float64   `json:"expenses"`
	MarginPct         float64   `json:"margin_pct"`
	CashNet           float64   `json:"cash_net"`
	InventoryTurnover float64   `json:"inventory_turnover,omitempty"`
	UpdatedAt         time.Time `json:"updated_at"`
}

type complianceRun struct {
	ID          string    `json:"id"`
	Kind        string    `json:"kind"`
	Period      string    `json:"period"`
	Status      string    `json:"status"`
	Issues      []string  `json:"issues,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	CompletedAt time.Time `json:"completed_at,omitempty"`
}

type martEvent struct {
	ID        string         `json:"id"`
	EventType string         `json:"event_type"`
	EntityID  string         `json:"entity_id"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

var martsStore = struct {
	sync.RWMutex
	snapshotSeq   int
	complianceSeq int
	eventSeq      int
	snapshots     []martSnapshot
	compliance    []complianceRun
	events        []martEvent
}{
	snapshots: []martSnapshot{
		{ID: "ms-00001", Domain: "sales", Revenue: 2340000, Expenses: 1900000, MarginPct: 18.8, CashNet: 420000, UpdatedAt: time.Now().UTC()},
		{ID: "ms-00002", Domain: "service", Revenue: 740000, Expenses: 520000, MarginPct: 29.7, CashNet: 150000, UpdatedAt: time.Now().UTC()},
		{ID: "ms-00003", Domain: "inventory", Revenue: 510000, Expenses: 420000, MarginPct: 17.6, CashNet: 35000, InventoryTurnover: 7.8, UpdatedAt: time.Now().UTC()},
	},
}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)
	mux.HandleFunc("/marts/snapshots", snapshotsHandler)
	mux.HandleFunc("/marts/refresh", refreshHandler)
	mux.HandleFunc("/marts/kpi", kpiHandler)
	mux.HandleFunc("/marts/analytics", analyticsHandler)
	mux.HandleFunc("/marts/compliance/runs", complianceRunsHandler)
	mux.HandleFunc("/marts/compliance/runs/", complianceRunStatusHandler)
	mux.HandleFunc("/events", eventsHandler)
}

func snapshotsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		domainFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("domain")))
		martsStore.RLock()
		defer martsStore.RUnlock()
		out := make([]martSnapshot, 0, len(martsStore.snapshots))
		for _, entity := range martsStore.snapshots {
			if domainFilter != "" && strings.ToLower(entity.Domain) != domainFilter {
				continue
			}
			out = append(out, entity)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Domain < out[j].Domain })
		respondJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req struct {
			Domain            string  `json:"domain"`
			Revenue           float64 `json:"revenue"`
			Expenses          float64 `json:"expenses"`
			CashNet           float64 `json:"cash_net"`
			InventoryTurnover float64 `json:"inventory_turnover"`
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
		if req.Revenue < 0 || req.Expenses < 0 {
			respondError(w, http.StatusBadRequest, "revenue and expenses must be non-negative")
			return
		}
		now := time.Now().UTC()
		marginPct := 0.0
		if req.Revenue > 0 {
			marginPct = round2(((req.Revenue - req.Expenses) / req.Revenue) * 100)
		}

		martsStore.Lock()
		defer martsStore.Unlock()
		index := findSnapshotIndexLocked(domain)
		if index >= 0 {
			martsStore.snapshots[index].Revenue = round2(req.Revenue)
			martsStore.snapshots[index].Expenses = round2(req.Expenses)
			martsStore.snapshots[index].CashNet = round2(req.CashNet)
			martsStore.snapshots[index].MarginPct = marginPct
			if req.InventoryTurnover > 0 {
				martsStore.snapshots[index].InventoryTurnover = round2(req.InventoryTurnover)
			}
			martsStore.snapshots[index].UpdatedAt = now
			appendMartEvent("MartSnapshotUpdated", martsStore.snapshots[index].ID, map[string]any{"domain": domain})
			respondJSON(w, http.StatusOK, martsStore.snapshots[index])
			return
		}

		martsStore.snapshotSeq++
		entity := martSnapshot{
			ID:                fmt.Sprintf("ms-%05d", martsStore.snapshotSeq),
			Domain:            domain,
			Revenue:           round2(req.Revenue),
			Expenses:          round2(req.Expenses),
			CashNet:           round2(req.CashNet),
			MarginPct:         marginPct,
			InventoryTurnover: round2(req.InventoryTurnover),
			UpdatedAt:         now,
		}
		martsStore.snapshots = append(martsStore.snapshots, entity)
		appendMartEvent("MartSnapshotCreated", entity.ID, map[string]any{"domain": domain})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func refreshHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Delta []struct {
			Domain   string  `json:"domain"`
			Revenue  float64 `json:"revenue"`
			Expenses float64 `json:"expenses"`
			CashNet  float64 `json:"cash_net"`
		} `json:"delta"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(req.Delta) == 0 {
		respondError(w, http.StatusBadRequest, "delta is required")
		return
	}
	martsStore.Lock()
	defer martsStore.Unlock()
	updated := 0
	for _, item := range req.Delta {
		domain := strings.ToLower(strings.TrimSpace(item.Domain))
		index := findSnapshotIndexLocked(domain)
		if index < 0 {
			continue
		}
		entity := martsStore.snapshots[index]
		entity.Revenue = round2(entity.Revenue + item.Revenue)
		entity.Expenses = round2(entity.Expenses + item.Expenses)
		entity.CashNet = round2(entity.CashNet + item.CashNet)
		if entity.Revenue > 0 {
			entity.MarginPct = round2(((entity.Revenue - entity.Expenses) / entity.Revenue) * 100)
		}
		entity.UpdatedAt = time.Now().UTC()
		martsStore.snapshots[index] = entity
		updated++
	}
	appendMartEvent("MartsRefreshed", "marts", map[string]any{"updated": updated})
	respondJSON(w, http.StatusOK, map[string]any{"updated": updated})
}

func kpiHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	martsStore.RLock()
	defer martsStore.RUnlock()
	totalRevenue := 0.0
	totalExpenses := 0.0
	cashNet := 0.0
	turnover := 0.0
	for _, snapshot := range martsStore.snapshots {
		totalRevenue += snapshot.Revenue
		totalExpenses += snapshot.Expenses
		cashNet += snapshot.CashNet
		if snapshot.InventoryTurnover > 0 {
			turnover += snapshot.InventoryTurnover
		}
	}
	marginPct := 0.0
	if totalRevenue > 0 {
		marginPct = round2(((totalRevenue - totalExpenses) / totalRevenue) * 100)
	}
	avgTurnover := 0.0
	if len(martsStore.snapshots) > 0 {
		avgTurnover = round2(turnover / float64(len(martsStore.snapshots)))
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"revenue":      round2(totalRevenue),
		"expenses":     round2(totalExpenses),
		"margin_pct":   marginPct,
		"cash_net":     round2(cashNet),
		"avg_turnover": avgTurnover,
		"domains":      len(martsStore.snapshots),
		"updated_at":   time.Now().UTC(),
	})
}

func analyticsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	martsStore.RLock()
	defer martsStore.RUnlock()
	totalRevenue := 0.0
	for _, snapshot := range martsStore.snapshots {
		totalRevenue += snapshot.Revenue
	}
	type line struct {
		Domain       string  `json:"domain"`
		Revenue      float64 `json:"revenue"`
		RevenueShare float64 `json:"revenue_share_pct"`
		MarginPct    float64 `json:"margin_pct"`
		CashNet      float64 `json:"cash_net"`
	}
	breakdown := make([]line, 0, len(martsStore.snapshots))
	for _, snapshot := range martsStore.snapshots {
		share := 0.0
		if totalRevenue > 0 {
			share = round2((snapshot.Revenue / totalRevenue) * 100)
		}
		breakdown = append(breakdown, line{
			Domain:       snapshot.Domain,
			Revenue:      round2(snapshot.Revenue),
			RevenueShare: share,
			MarginPct:    snapshot.MarginPct,
			CashNet:      round2(snapshot.CashNet),
		})
	}
	sort.Slice(breakdown, func(i, j int) bool { return breakdown[i].Revenue > breakdown[j].Revenue })
	respondJSON(w, http.StatusOK, map[string]any{
		"revenue_total": round2(totalRevenue),
		"breakdown":     breakdown,
	})
}

func complianceRunsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		martsStore.RLock()
		defer martsStore.RUnlock()
		respondJSON(w, http.StatusOK, martsStore.compliance)
	case http.MethodPost:
		var req struct {
			Kind   string   `json:"kind"`
			Period string   `json:"period"`
			Issues []string `json:"issues"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		kind := strings.ToLower(defaultValue(req.Kind, "tax"))
		if kind != "tax" && kind != "compliance" {
			respondError(w, http.StatusBadRequest, "kind must be tax or compliance")
			return
		}
		now := time.Now().UTC()
		martsStore.Lock()
		defer martsStore.Unlock()
		martsStore.complianceSeq++
		entity := complianceRun{
			ID:          fmt.Sprintf("cr-%05d", martsStore.complianceSeq),
			Kind:        kind,
			Period:      defaultValue(req.Period, now.Format("2006-01")),
			Status:      "completed",
			Issues:      req.Issues,
			CreatedAt:   now,
			CompletedAt: now,
		}
		martsStore.compliance = append(martsStore.compliance, entity)
		appendMartEvent("ComplianceRunCompleted", entity.ID, map[string]any{
			"kind":   entity.Kind,
			"issues": len(entity.Issues),
		})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func complianceRunStatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 5 || parts[0] != "marts" || parts[1] != "compliance" || parts[2] != "runs" || parts[4] != "status" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}
	runID := parts[3]
	var req struct {
		Status string `json:"status"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if status != "running" && status != "completed" && status != "failed" {
		respondError(w, http.StatusBadRequest, "unsupported status")
		return
	}

	martsStore.Lock()
	defer martsStore.Unlock()
	index := findComplianceIndexLocked(runID)
	if index < 0 {
		respondError(w, http.StatusNotFound, "compliance run not found")
		return
	}
	martsStore.compliance[index].Status = status
	if status == "completed" {
		martsStore.compliance[index].CompletedAt = time.Now().UTC()
	}
	appendMartEvent("ComplianceRunStatusChanged", runID, map[string]any{"status": status})
	respondJSON(w, http.StatusOK, martsStore.compliance[index])
}

func eventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	martsStore.RLock()
	defer martsStore.RUnlock()
	respondJSON(w, http.StatusOK, martsStore.events)
}

func appendMartEvent(eventType, entityID string, payload map[string]any) {
	martsStore.eventSeq++
	martsStore.events = append(martsStore.events, martEvent{
		ID:        fmt.Sprintf("ame-%05d", martsStore.eventSeq),
		EventType: eventType,
		EntityID:  entityID,
		Payload:   payload,
		CreatedAt: time.Now().UTC(),
	})
}

func findSnapshotIndexLocked(domain string) int {
	for i := range martsStore.snapshots {
		if martsStore.snapshots[i].Domain == domain {
			return i
		}
	}
	return -1
}

func findComplianceIndexLocked(id string) int {
	for i := range martsStore.compliance {
		if martsStore.compliance[i].ID == id {
			return i
		}
	}
	return -1
}

func isAllowedDomain(domain string) bool {
	switch domain {
	case "sales", "service", "inventory", "finance":
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
		"service": "analytics-marts",
		"status":  "ok",
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "analytics-marts",
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
