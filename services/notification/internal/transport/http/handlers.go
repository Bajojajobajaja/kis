package httptransport

import (
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

type notificationJob struct {
	ID           string         `json:"id"`
	Channel      string         `json:"channel"` // email|sms
	Recipient    string         `json:"recipient"`
	Template     string         `json:"template"`
	Payload      map[string]any `json:"payload,omitempty"`
	Status       string         `json:"status"` // queued|sent|failed
	Attempts     int            `json:"attempts"`
	LastError    string         `json:"last_error,omitempty"`
	TraceID      string         `json:"trace_id,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
	DispatchedAt string         `json:"dispatched_at,omitempty"`
}

type notificationHTTPMetric struct {
	Path   string
	Method string
	Status int
}

var notificationStore = struct {
	sync.RWMutex
	seq  int
	jobs []notificationJob
}{}

var notificationMetrics = struct {
	sync.Mutex
	requests      map[notificationHTTPMetric]int
	durationMsSum float64
	durationCount int
}{
	requests: map[notificationHTTPMetric]int{},
}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", instrument("notification", "/healthz", healthHandler))
	mux.HandleFunc("/readyz", instrument("notification", "/readyz", readyHandler))
	mux.HandleFunc("/notifications/send", instrument("notification", "/notifications/send", sendHandler))
	mux.HandleFunc("/notifications/jobs", instrument("notification", "/notifications/jobs", jobsHandler))
	mux.HandleFunc("/notifications/dispatch", instrument("notification", "/notifications/dispatch", dispatchHandler))
	mux.HandleFunc("/notifications/events", instrument("notification", "/notifications/events", eventHandler))
	mux.HandleFunc("/metrics", metricsHandler)
}

func sendHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	traceID := resolveTraceID(r)
	var req struct {
		Channel   string         `json:"channel"`
		Recipient string         `json:"recipient"`
		Template  string         `json:"template"`
		Payload   map[string]any `json:"payload"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !isSupportedChannel(req.Channel) {
		respondError(w, http.StatusBadRequest, "channel must be email or sms")
		return
	}
	if strings.TrimSpace(req.Recipient) == "" {
		respondError(w, http.StatusBadRequest, "recipient is required")
		return
	}

	entity := enqueueJob(req.Channel, req.Recipient, req.Template, req.Payload, traceID)
	respondJSON(w, http.StatusCreated, entity)
}

func jobsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	notificationStore.RLock()
	defer notificationStore.RUnlock()
	respondJSON(w, http.StatusOK, notificationStore.jobs)
}

func dispatchHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		Limit int `json:"limit"`
	}
	_ = decodeJSON(r, &req) // optional payload
	if req.Limit <= 0 {
		req.Limit = 50
	}

	notificationStore.Lock()
	defer notificationStore.Unlock()

	dispatched := make([]notificationJob, 0)
	for i := range notificationStore.jobs {
		if len(dispatched) >= req.Limit {
			break
		}
		if notificationStore.jobs[i].Status != "queued" {
			continue
		}

		notificationStore.jobs[i].Attempts++
		now := time.Now().UTC().Format(time.RFC3339)
		notificationStore.jobs[i].DispatchedAt = now

		if err := deliver(notificationStore.jobs[i]); err != nil {
			notificationStore.jobs[i].Status = "failed"
			notificationStore.jobs[i].LastError = err.Error()
		} else {
			notificationStore.jobs[i].Status = "sent"
			notificationStore.jobs[i].LastError = ""
		}
		dispatched = append(dispatched, notificationStore.jobs[i])
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"processed": len(dispatched),
		"jobs":      dispatched,
	})
}

func eventHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	traceID := resolveTraceID(r)
	var req struct {
		EventType string         `json:"event_type"`
		Channel   string         `json:"channel"`
		Recipient string         `json:"recipient"`
		Payload   map[string]any `json:"payload"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.EventType == "" || req.Recipient == "" {
		respondError(w, http.StatusBadRequest, "event_type and recipient are required")
		return
	}

	channel := req.Channel
	if channel == "" {
		channel = "email"
	}
	if !isSupportedChannel(channel) {
		respondError(w, http.StatusBadRequest, "channel must be email or sms")
		return
	}

	job := enqueueJob(channel, req.Recipient, templateFromEvent(req.EventType), req.Payload, traceID)
	respondJSON(w, http.StatusCreated, job)
}

func enqueueJob(channel, recipient, template string, payload map[string]any, traceID string) notificationJob {
	notificationStore.Lock()
	defer notificationStore.Unlock()
	notificationStore.seq++
	entity := notificationJob{
		ID:        fmt.Sprintf("ntf-%06d", notificationStore.seq),
		Channel:   channel,
		Recipient: recipient,
		Template:  defaultValue(template, "generic"),
		Payload:   payload,
		Status:    "queued",
		Attempts:  0,
		TraceID:   traceID,
		CreatedAt: time.Now().UTC(),
	}
	notificationStore.jobs = append(notificationStore.jobs, entity)
	return entity
}

func deliver(job notificationJob) error {
	switch job.Channel {
	case "email":
		if !strings.Contains(job.Recipient, "@") {
			return fmt.Errorf("invalid email recipient")
		}
		log.Printf("{\"service\":\"notification\",\"provider\":\"email\",\"recipient\":\"%s\",\"template\":\"%s\",\"trace_id\":\"%s\"}",
			job.Recipient, job.Template, job.TraceID)
		return nil
	case "sms":
		digits := countDigits(job.Recipient)
		if digits < 10 {
			return fmt.Errorf("invalid phone recipient")
		}
		log.Printf("{\"service\":\"notification\",\"provider\":\"sms\",\"recipient\":\"%s\",\"template\":\"%s\",\"trace_id\":\"%s\"}",
			job.Recipient, job.Template, job.TraceID)
		return nil
	default:
		return fmt.Errorf("unsupported channel")
	}
}

func templateFromEvent(eventType string) string {
	switch eventType {
	case "deal_won":
		return "deal_won_notice"
	case "workorder_closed":
		return "workorder_closed_notice"
	default:
		return "generic"
	}
}

func isSupportedChannel(channel string) bool {
	switch strings.ToLower(strings.TrimSpace(channel)) {
	case "email", "sms":
		return true
	default:
		return false
	}
}

func countDigits(input string) int {
	total := 0
	for _, ch := range input {
		if ch >= '0' && ch <= '9' {
			total++
		}
	}
	return total
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
		traceID := resolveTraceID(r)
		w.Header().Set("X-Trace-ID", traceID)

		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		started := time.Now()
		next(recorder, r)
		durationMs := float64(time.Since(started).Microseconds()) / 1000.0

		notificationMetrics.Lock()
		notificationMetrics.requests[notificationHTTPMetric{Path: path, Method: r.Method, Status: recorder.status}]++
		notificationMetrics.durationMsSum += durationMs
		notificationMetrics.durationCount++
		notificationMetrics.Unlock()

		log.Printf("{\"service\":\"%s\",\"path\":\"%s\",\"method\":\"%s\",\"status\":%d,\"duration_ms\":%.3f,\"trace_id\":\"%s\"}",
			serviceName, path, r.Method, recorder.status, durationMs, traceID)
	}
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	notificationMetrics.Lock()
	defer notificationMetrics.Unlock()

	lines := []string{
		"# HELP kis_http_requests_total Total HTTP requests by path/method/status.",
		"# TYPE kis_http_requests_total counter",
	}

	keys := make([]notificationHTTPMetric, 0, len(notificationMetrics.requests))
	for key := range notificationMetrics.requests {
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
		count := notificationMetrics.requests[key]
		lines = append(lines,
			"kis_http_requests_total{service=\"notification\",path=\""+key.Path+"\",method=\""+key.Method+"\",status=\""+strconv.Itoa(key.Status)+"\"} "+strconv.Itoa(count))
	}

	lines = append(lines,
		"# HELP kis_http_request_duration_ms_sum Sum of HTTP request durations in milliseconds.",
		"# TYPE kis_http_request_duration_ms_sum gauge",
		fmt.Sprintf("kis_http_request_duration_ms_sum{service=\"notification\"} %.3f", notificationMetrics.durationMsSum),
		"# HELP kis_http_request_duration_ms_count Count of observed HTTP requests.",
		"# TYPE kis_http_request_duration_ms_count counter",
		fmt.Sprintf("kis_http_request_duration_ms_count{service=\"notification\"} %d", notificationMetrics.durationCount),
	)

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = w.Write([]byte(strings.Join(lines, "\n") + "\n"))
}

func resolveTraceID(r *http.Request) string {
	traceID := strings.TrimSpace(r.Header.Get("X-Trace-ID"))
	if traceID == "" {
		traceID = fmt.Sprintf("notification-%d", time.Now().UnixNano())
	}
	return traceID
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]any{
		"service":    "notification",
		"status":     "ok",
		"checked_at": time.Now().UTC().Format(time.RFC3339),
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]any{
		"service":    "notification",
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
