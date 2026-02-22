package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

type diagnostic struct {
	ID              string    `json:"id"`
	WorkorderID     string    `json:"workorder_id"`
	VehicleVIN      string    `json:"vehicle_vin,omitempty"`
	Faults          []string  `json:"faults"`
	Recommendations []string  `json:"recommendations"`
	Severity        string    `json:"severity"`
	CreatedAt       time.Time `json:"created_at"`
}

type warrantyStatus struct {
	VehicleVIN string `json:"vehicle_vin"`
	Active     bool   `json:"active"`
	Provider   string `json:"provider,omitempty"`
	ValidUntil string `json:"valid_until,omitempty"`
}

type diagnosticEvent struct {
	ID        string         `json:"id"`
	EventType string         `json:"event_type"`
	EntityID  string         `json:"entity_id"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

var diagnosticsStore = struct {
	sync.RWMutex
	seq          int
	eventSeq     int
	diagnostics  []diagnostic
	events       []diagnosticEvent
	warrantyData map[string]warrantyStatus
}{
	warrantyData: map[string]warrantyStatus{
		"VIN-UAT-WO": {VehicleVIN: "VIN-UAT-WO", Active: true, Provider: "OEM", ValidUntil: "2027-12-31T00:00:00Z"},
		"VIN123":     {VehicleVIN: "VIN123", Active: false},
	},
}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)
	mux.HandleFunc("/diagnostics", diagnosticsHandler)
	mux.HandleFunc("/warranty/check", warrantyCheckHandler)
	mux.HandleFunc("/events", diagnosticsEventsHandler)
}

func diagnosticsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		diagnosticsStore.RLock()
		defer diagnosticsStore.RUnlock()
		workorderFilter := strings.TrimSpace(r.URL.Query().Get("workorder_id"))
		vinFilter := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("vin")))
		severityFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("severity")))
		out := make([]diagnostic, 0, len(diagnosticsStore.diagnostics))
		for _, entity := range diagnosticsStore.diagnostics {
			if workorderFilter != "" && entity.WorkorderID != workorderFilter {
				continue
			}
			if vinFilter != "" && strings.ToUpper(entity.VehicleVIN) != vinFilter {
				continue
			}
			if severityFilter != "" && strings.ToLower(entity.Severity) != severityFilter {
				continue
			}
			out = append(out, entity)
		}
		respondJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req struct {
			WorkorderID     string   `json:"workorder_id"`
			VehicleVIN      string   `json:"vehicle_vin"`
			Faults          []string `json:"faults"`
			Recommendations []string `json:"recommendations"`
			Severity        string   `json:"severity"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.WorkorderID == "" {
			respondError(w, http.StatusBadRequest, "workorder_id is required")
			return
		}

		diagnosticsStore.Lock()
		defer diagnosticsStore.Unlock()
		diagnosticsStore.seq++
		entity := diagnostic{
			ID:              fmt.Sprintf("dg-%04d", diagnosticsStore.seq),
			WorkorderID:     req.WorkorderID,
			VehicleVIN:      strings.ToUpper(strings.TrimSpace(req.VehicleVIN)),
			Faults:          req.Faults,
			Recommendations: req.Recommendations,
			Severity:        defaultValue(strings.ToLower(strings.TrimSpace(req.Severity)), "medium"),
			CreatedAt:       time.Now().UTC(),
		}
		diagnosticsStore.diagnostics = append(diagnosticsStore.diagnostics, entity)
		appendDiagnosticEvent("DiagnosticCompleted", entity.ID, map[string]any{
			"workorder_id": entity.WorkorderID,
			"vehicle_vin":  entity.VehicleVIN,
			"severity":     entity.Severity,
			"fault_count":  len(entity.Faults),
		})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func warrantyCheckHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	vin := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("vin")))
	if vin == "" {
		respondError(w, http.StatusBadRequest, "vin is required")
		return
	}

	diagnosticsStore.RLock()
	defer diagnosticsStore.RUnlock()
	if status, ok := diagnosticsStore.warrantyData[vin]; ok {
		respondJSON(w, http.StatusOK, status)
		return
	}
	respondJSON(w, http.StatusOK, warrantyStatus{
		VehicleVIN: vin,
		Active:     false,
	})
}

func diagnosticsEventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	diagnosticsStore.RLock()
	defer diagnosticsStore.RUnlock()
	respondJSON(w, http.StatusOK, diagnosticsStore.events)
}

func appendDiagnosticEvent(eventType, entityID string, payload map[string]any) {
	diagnosticsStore.eventSeq++
	diagnosticsStore.events = append(diagnosticsStore.events, diagnosticEvent{
		ID:        fmt.Sprintf("dge-%05d", diagnosticsStore.eventSeq),
		EventType: eventType,
		EntityID:  entityID,
		Payload:   payload,
		CreatedAt: time.Now().UTC(),
	})
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "service-diagnostics",
		"status":  "ok",
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "service-diagnostics",
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
