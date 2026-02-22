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

type role struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type policy struct {
	ID          string   `json:"id"`
	Resource    string   `json:"resource"`
	Action      string   `json:"action"`
	Effect      string   `json:"effect"`       // allow|deny
	Roles       []string `json:"roles"`        // role IDs
	ObjectScope string   `json:"object_scope"` // any|owner
}

type subjectBinding struct {
	SubjectID string    `json:"subject_id"`
	Roles     []string  `json:"roles"`
	UpdatedAt time.Time `json:"updated_at"`
}

type rbacCheckRequest struct {
	SubjectID     string   `json:"subject_id"`
	SubjectRoles  []string `json:"subject_roles"`
	Resource      string   `json:"resource"`
	Action        string   `json:"action"`
	ObjectOwnerID string   `json:"object_owner_id"`
}

type rbacCheckResponse struct {
	Allowed bool     `json:"allowed"`
	Reason  string   `json:"reason"`
	Matched []policy `json:"matched_policies,omitempty"`
}

var identityStore = struct {
	sync.RWMutex
	roleSeq   int
	policySeq int
	roles     []role
	policies  []policy
	bindings  []subjectBinding
}{
	roles: []role{
		{ID: "platform_admin", Name: "Platform Admin", Description: "Full access to all modules"},
		{ID: "sales_manager", Name: "Sales Manager", Description: "Manage sales objects"},
		{ID: "sales_agent", Name: "Sales Agent", Description: "Work with own sales objects"},
		{ID: "service_manager", Name: "Service Manager", Description: "Manage service objects"},
		{ID: "service_advisor", Name: "Service Advisor", Description: "Work with own workorders"},
	},
	policies: []policy{
		{
			ID:          "pol-001",
			Resource:    "sales-deals",
			Action:      "write",
			Effect:      "allow",
			Roles:       []string{"sales_manager", "platform_admin"},
			ObjectScope: "any",
		},
		{
			ID:          "pol-002",
			Resource:    "sales-deals",
			Action:      "write",
			Effect:      "allow",
			Roles:       []string{"sales_agent"},
			ObjectScope: "owner",
		},
		{
			ID:          "pol-003",
			Resource:    "service-workorders",
			Action:      "write",
			Effect:      "allow",
			Roles:       []string{"service_manager", "platform_admin"},
			ObjectScope: "any",
		},
		{
			ID:          "pol-004",
			Resource:    "service-workorders",
			Action:      "write",
			Effect:      "allow",
			Roles:       []string{"service_advisor"},
			ObjectScope: "owner",
		},
	},
	bindings: []subjectBinding{
		{SubjectID: "agent-1", Roles: []string{"sales_agent"}, UpdatedAt: time.Now().UTC()},
		{SubjectID: "manager-1", Roles: []string{"sales_manager"}, UpdatedAt: time.Now().UTC()},
	},
}

type httpMetric struct {
	Path   string
	Method string
	Status int
}

var identityMetrics = struct {
	sync.Mutex
	requests      map[httpMetric]int
	durationMsSum float64
	durationCount int
}{
	requests: map[httpMetric]int{},
}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", instrument("identity-access", "/healthz", healthHandler))
	mux.HandleFunc("/readyz", instrument("identity-access", "/readyz", readyHandler))
	mux.HandleFunc("/rbac/roles", instrument("identity-access", "/rbac/roles", rolesHandler))
	mux.HandleFunc("/rbac/subjects", instrument("identity-access", "/rbac/subjects", subjectsHandler))
	mux.HandleFunc("/rbac/subjects/", instrument("identity-access", "/rbac/subjects/", subjectByIDHandler))
	mux.HandleFunc("/rbac/policies", instrument("identity-access", "/rbac/policies", policiesHandler))
	mux.HandleFunc("/rbac/check", instrument("identity-access", "/rbac/check", checkHandler))
	mux.HandleFunc("/metrics", metricsHandler)
}

func subjectsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		identityStore.RLock()
		defer identityStore.RUnlock()
		respondJSON(w, http.StatusOK, identityStore.bindings)
	case http.MethodPost:
		var req struct {
			SubjectID string   `json:"subject_id"`
			Roles     []string `json:"roles"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if strings.TrimSpace(req.SubjectID) == "" {
			respondError(w, http.StatusBadRequest, "subject_id is required")
			return
		}
		normalized := normalizeRoles(req.Roles)
		if len(normalized) == 0 {
			respondError(w, http.StatusBadRequest, "roles are required")
			return
		}
		identityStore.Lock()
		defer identityStore.Unlock()
		index := findBindingIndexBySubjectIDLocked(req.SubjectID)
		entity := subjectBinding{
			SubjectID: strings.TrimSpace(req.SubjectID),
			Roles:     normalized,
			UpdatedAt: time.Now().UTC(),
		}
		if index >= 0 {
			identityStore.bindings[index] = entity
			respondJSON(w, http.StatusOK, entity)
			return
		}
		identityStore.bindings = append(identityStore.bindings, entity)
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func subjectByIDHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 3 || parts[0] != "rbac" || parts[1] != "subjects" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}
	subjectID := strings.TrimSpace(parts[2])
	identityStore.RLock()
	defer identityStore.RUnlock()
	index := findBindingIndexBySubjectIDLocked(subjectID)
	if index < 0 {
		respondError(w, http.StatusNotFound, "subject binding not found")
		return
	}
	respondJSON(w, http.StatusOK, identityStore.bindings[index])
}

func rolesHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		identityStore.RLock()
		defer identityStore.RUnlock()
		respondJSON(w, http.StatusOK, identityStore.roles)
	case http.MethodPost:
		var req struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.Name == "" {
			respondError(w, http.StatusBadRequest, "name is required")
			return
		}

		identityStore.Lock()
		defer identityStore.Unlock()
		identityStore.roleSeq++
		entity := role{
			ID:          fmt.Sprintf("role-%04d", identityStore.roleSeq),
			Name:        req.Name,
			Description: req.Description,
		}
		identityStore.roles = append(identityStore.roles, entity)
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func policiesHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		identityStore.RLock()
		defer identityStore.RUnlock()
		respondJSON(w, http.StatusOK, identityStore.policies)
	case http.MethodPost:
		var req struct {
			Resource    string   `json:"resource"`
			Action      string   `json:"action"`
			Effect      string   `json:"effect"`
			Roles       []string `json:"roles"`
			ObjectScope string   `json:"object_scope"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.Resource == "" || req.Action == "" {
			respondError(w, http.StatusBadRequest, "resource and action are required")
			return
		}

		effect := req.Effect
		if effect == "" {
			effect = "allow"
		}
		scope := req.ObjectScope
		if scope == "" {
			scope = "any"
		}

		identityStore.Lock()
		defer identityStore.Unlock()
		identityStore.policySeq++
		entity := policy{
			ID:          fmt.Sprintf("pol-%04d", identityStore.policySeq+100),
			Resource:    req.Resource,
			Action:      req.Action,
			Effect:      effect,
			Roles:       req.Roles,
			ObjectScope: scope,
		}
		identityStore.policies = append(identityStore.policies, entity)
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func checkHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req rbacCheckRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	identityStore.RLock()
	defer identityStore.RUnlock()
	if len(req.SubjectRoles) == 0 && strings.TrimSpace(req.SubjectID) != "" {
		if index := findBindingIndexBySubjectIDLocked(req.SubjectID); index >= 0 {
			req.SubjectRoles = append([]string(nil), identityStore.bindings[index].Roles...)
		}
	}

	matched := make([]policy, 0)
	for _, p := range identityStore.policies {
		if p.Resource != req.Resource || p.Action != req.Action {
			continue
		}
		if !hasRoleIntersection(req.SubjectRoles, p.Roles) {
			continue
		}
		matched = append(matched, p)
	}

	resp := evaluatePolicies(req, matched)
	respondJSON(w, http.StatusOK, resp)
}

func evaluatePolicies(req rbacCheckRequest, matched []policy) rbacCheckResponse {
	if len(matched) == 0 {
		return rbacCheckResponse{
			Allowed: false,
			Reason:  "no matching policy",
		}
	}

	for _, p := range matched {
		if p.Effect == "deny" && objectScopeAllows(req, p) {
			return rbacCheckResponse{
				Allowed: false,
				Reason:  "explicit deny policy matched",
				Matched: matched,
			}
		}
	}

	for _, p := range matched {
		if p.Effect == "allow" && objectScopeAllows(req, p) {
			return rbacCheckResponse{
				Allowed: true,
				Reason:  "allow policy matched",
				Matched: matched,
			}
		}
	}

	return rbacCheckResponse{
		Allowed: false,
		Reason:  "object scope check failed",
		Matched: matched,
	}
}

func hasRoleIntersection(subjectRoles, policyRoles []string) bool {
	for _, userRole := range subjectRoles {
		for _, policyRole := range policyRoles {
			if strings.EqualFold(userRole, policyRole) {
				return true
			}
		}
	}
	return false
}

func normalizeRoles(roles []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(roles))
	for _, roleName := range roles {
		normalized := strings.TrimSpace(roleName)
		if normalized == "" || seen[strings.ToLower(normalized)] {
			continue
		}
		seen[strings.ToLower(normalized)] = true
		out = append(out, normalized)
	}
	sort.Strings(out)
	return out
}

func findBindingIndexBySubjectIDLocked(subjectID string) int {
	for i := range identityStore.bindings {
		if strings.EqualFold(identityStore.bindings[i].SubjectID, subjectID) {
			return i
		}
	}
	return -1
}

func objectScopeAllows(req rbacCheckRequest, p policy) bool {
	switch p.ObjectScope {
	case "", "any":
		return true
	case "owner":
		return req.SubjectID != "" && req.SubjectID == req.ObjectOwnerID
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

		identityMetrics.Lock()
		identityMetrics.requests[httpMetric{Path: path, Method: r.Method, Status: recorder.status}]++
		identityMetrics.durationMsSum += durationMs
		identityMetrics.durationCount++
		identityMetrics.Unlock()

		log.Printf("{\"service\":\"%s\",\"path\":\"%s\",\"method\":\"%s\",\"status\":%d,\"duration_ms\":%.3f,\"trace_id\":\"%s\"}",
			serviceName, path, r.Method, recorder.status, durationMs, traceID)
	}
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	identityMetrics.Lock()
	defer identityMetrics.Unlock()

	lines := []string{
		"# HELP kis_http_requests_total Total HTTP requests by path/method/status.",
		"# TYPE kis_http_requests_total counter",
	}

	keys := make([]httpMetric, 0, len(identityMetrics.requests))
	for key := range identityMetrics.requests {
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
		count := identityMetrics.requests[key]
		lines = append(lines,
			"kis_http_requests_total{service=\"identity-access\",path=\""+key.Path+"\",method=\""+key.Method+"\",status=\""+strconv.Itoa(key.Status)+"\"} "+strconv.Itoa(count))
	}

	lines = append(lines,
		"# HELP kis_http_request_duration_ms_sum Sum of HTTP request durations in milliseconds.",
		"# TYPE kis_http_request_duration_ms_sum gauge",
		fmt.Sprintf("kis_http_request_duration_ms_sum{service=\"identity-access\"} %.3f", identityMetrics.durationMsSum),
		"# HELP kis_http_request_duration_ms_count Count of observed HTTP requests.",
		"# TYPE kis_http_request_duration_ms_count counter",
		fmt.Sprintf("kis_http_request_duration_ms_count{service=\"identity-access\"} %d", identityMetrics.durationCount),
	)

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = w.Write([]byte(strings.Join(lines, "\n") + "\n"))
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]any{
		"service":    "identity-access",
		"status":     "ok",
		"checked_at": time.Now().UTC().Format(time.RFC3339),
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]any{
		"service":    "identity-access",
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
