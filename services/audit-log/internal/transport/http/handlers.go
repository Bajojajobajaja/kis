package httptransport

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type auditEvent struct {
	ID        string         `json:"id"`
	ActorID   string         `json:"actor_id"`
	Resource  string         `json:"resource"`
	Action    string         `json:"action"`
	ObjectID  string         `json:"object_id"`
	Before    map[string]any `json:"before,omitempty"`
	After     map[string]any `json:"after,omitempty"`
	TraceID   string         `json:"trace_id,omitempty"`
	PrevHash  string         `json:"prev_hash,omitempty"`
	Hash      string         `json:"hash,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

var auditStore = struct {
	sync.RWMutex
	seq           int
	lastHash      string
	retentionDays int
	events        []auditEvent
}{
	retentionDays: 365,
}

type auditHTTPMetric struct {
	Path   string
	Method string
	Status int
}

var auditMetrics = struct {
	sync.Mutex
	requests      map[auditHTTPMetric]int
	durationMsSum float64
	durationCount int
}{
	requests: map[auditHTTPMetric]int{},
}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", instrument("audit-log", "/healthz", healthHandler))
	mux.HandleFunc("/readyz", instrument("audit-log", "/readyz", readyHandler))
	mux.HandleFunc("/audit/events", instrument("audit-log", "/audit/events", eventsHandler))
	mux.HandleFunc("/audit/events/critical", instrument("audit-log", "/audit/events/critical", criticalEventsHandler))
	mux.HandleFunc("/audit/integrity", instrument("audit-log", "/audit/integrity", integrityHandler))
	mux.HandleFunc("/audit/retention", instrument("audit-log", "/audit/retention", retentionHandler))
	mux.HandleFunc("/metrics", metricsHandler)
}

func eventsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		resourceFilter := strings.TrimSpace(r.URL.Query().Get("resource"))
		objectFilter := strings.TrimSpace(r.URL.Query().Get("object_id"))
		actorFilter := strings.TrimSpace(r.URL.Query().Get("actor_id"))

		auditStore.RLock()
		defer auditStore.RUnlock()
		filtered := make([]auditEvent, 0)
		for _, event := range auditStore.events {
			if resourceFilter != "" && event.Resource != resourceFilter {
				continue
			}
			if objectFilter != "" && event.ObjectID != objectFilter {
				continue
			}
			if actorFilter != "" && event.ActorID != actorFilter {
				continue
			}
			filtered = append(filtered, event)
		}
		respondJSON(w, http.StatusOK, filtered)
	case http.MethodPost:
		var req struct {
			ActorID  string         `json:"actor_id"`
			Resource string         `json:"resource"`
			Action   string         `json:"action"`
			ObjectID string         `json:"object_id"`
			Before   map[string]any `json:"before"`
			After    map[string]any `json:"after"`
			TraceID  string         `json:"trace_id"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.Resource == "" || req.Action == "" || req.ObjectID == "" {
			respondError(w, http.StatusBadRequest, "resource, action and object_id are required")
			return
		}

		auditStore.Lock()
		defer auditStore.Unlock()
		auditStore.seq++
		now := time.Now().UTC()
		actorID := defaultValue(req.ActorID, "system")
		payload, _ := json.Marshal(map[string]any{
			"actor_id":  actorID,
			"resource":  req.Resource,
			"action":    req.Action,
			"object_id": req.ObjectID,
			"before":    req.Before,
			"after":     req.After,
			"trace_id":  req.TraceID,
		})
		hash := computeEventHash(auditStore.lastHash, payload, now)
		entity := auditEvent{
			ID:        fmt.Sprintf("ae-%06d", auditStore.seq),
			ActorID:   actorID,
			Resource:  req.Resource,
			Action:    req.Action,
			ObjectID:  req.ObjectID,
			Before:    req.Before,
			After:     req.After,
			TraceID:   req.TraceID,
			PrevHash:  auditStore.lastHash,
			Hash:      hash,
			CreatedAt: now,
		}
		auditStore.lastHash = hash
		auditStore.events = append(auditStore.events, entity)
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func integrityHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	auditStore.RLock()
	defer auditStore.RUnlock()
	valid := true
	invalidAt := ""
	prev := ""
	for _, event := range auditStore.events {
		payload, _ := json.Marshal(map[string]any{
			"actor_id":  event.ActorID,
			"resource":  event.Resource,
			"action":    event.Action,
			"object_id": event.ObjectID,
			"before":    event.Before,
			"after":     event.After,
			"trace_id":  event.TraceID,
		})
		expected := computeEventHash(prev, payload, event.CreatedAt)
		if event.PrevHash != prev || event.Hash != expected {
			valid = false
			invalidAt = event.ID
			break
		}
		prev = event.Hash
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"valid":      valid,
		"invalid_at": invalidAt,
		"events":     len(auditStore.events),
	})
}

func retentionHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		auditStore.RLock()
		defer auditStore.RUnlock()
		respondJSON(w, http.StatusOK, map[string]any{"retention_days": auditStore.retentionDays})
	case http.MethodPost:
		var req struct {
			RetentionDays int `json:"retention_days"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.RetentionDays < 30 {
			respondError(w, http.StatusBadRequest, "retention_days must be >= 30")
			return
		}
		auditStore.Lock()
		defer auditStore.Unlock()
		auditStore.retentionDays = req.RetentionDays
		respondJSON(w, http.StatusOK, map[string]any{"retention_days": auditStore.retentionDays})
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func criticalEventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	auditStore.RLock()
	defer auditStore.RUnlock()

	critical := make([]auditEvent, 0)
	for _, event := range auditStore.events {
		if isCriticalAction(event.Action) {
			critical = append(critical, event)
		}
	}
	respondJSON(w, http.StatusOK, critical)
}

func isCriticalAction(action string) bool {
	switch action {
	case "update_status", "reserve_vehicle", "close", "post_ledger", "register_payment", "restore", "backup":
		return true
	default:
		return false
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (rw *statusRecorder) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

func instrument(serviceName, path string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		traceID := strings.TrimSpace(r.Header.Get("X-Trace-ID"))
		if traceID == "" {
			traceID = fmt.Sprintf("%s-%d", serviceName, time.Now().UnixNano())
		}
		w.Header().Set("X-Trace-ID", traceID)

		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		started := time.Now()
		next(recorder, r)
		durationMs := float64(time.Since(started).Microseconds()) / 1000.0

		auditMetrics.Lock()
		auditMetrics.requests[auditHTTPMetric{Path: path, Method: r.Method, Status: recorder.status}]++
		auditMetrics.durationMsSum += durationMs
		auditMetrics.durationCount++
		auditMetrics.Unlock()

		log.Printf("{\"service\":\"%s\",\"path\":\"%s\",\"method\":\"%s\",\"status\":%d,\"duration_ms\":%.3f,\"trace_id\":\"%s\"}",
			serviceName, path, r.Method, recorder.status, durationMs, traceID)
	}
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	auditMetrics.Lock()
	defer auditMetrics.Unlock()

	lines := []string{
		"# HELP kis_http_requests_total Total HTTP requests by path/method/status.",
		"# TYPE kis_http_requests_total counter",
	}

	keys := make([]auditHTTPMetric, 0, len(auditMetrics.requests))
	for key := range auditMetrics.requests {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].Path != keys[j].Path {
			return keys[i].Path < keys[j].Path
		}
		if keys[i].Method != keys[j].Method {
			return keys[i].Method < keys[j].Method
		}
		return keys[i].Status < keys[j].Status
	})

	for _, key := range keys {
		count := auditMetrics.requests[key]
		lines = append(lines,
			"kis_http_requests_total{service=\"audit-log\",path=\""+key.Path+"\",method=\""+key.Method+"\",status=\""+strconv.Itoa(key.Status)+"\"} "+strconv.Itoa(count))
	}

	lines = append(lines,
		"# HELP kis_http_request_duration_ms_sum Sum of HTTP request durations in milliseconds.",
		"# TYPE kis_http_request_duration_ms_sum gauge",
		fmt.Sprintf("kis_http_request_duration_ms_sum{service=\"audit-log\"} %.3f", auditMetrics.durationMsSum),
		"# HELP kis_http_request_duration_ms_count Count of observed HTTP requests.",
		"# TYPE kis_http_request_duration_ms_count counter",
		fmt.Sprintf("kis_http_request_duration_ms_count{service=\"audit-log\"} %d", auditMetrics.durationCount),
	)

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = w.Write([]byte(strings.Join(lines, "\n") + "\n"))
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]any{
		"service":    "audit-log",
		"status":     "ok",
		"checked_at": time.Now().UTC().Format(time.RFC3339),
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]any{
		"service":    "audit-log",
		"status":     "ready",
		"checked_at": time.Now().UTC().Format(time.RFC3339),
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

func computeEventHash(prevHash string, payload []byte, createdAt time.Time) string {
	raw := fmt.Sprintf("%s|%s|%s", prevHash, createdAt.Format(time.RFC3339Nano), string(payload))
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
