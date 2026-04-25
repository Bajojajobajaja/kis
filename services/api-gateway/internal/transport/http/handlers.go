package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

type gatewayRoute struct {
	ID                 string    `json:"id"`
	Prefix             string    `json:"prefix"`
	TargetService      string    `json:"target_service"`
	Methods            []string  `json:"methods"`
	RequireAuth        bool      `json:"require_auth"`
	RateLimitPerMinute int       `json:"rate_limit_per_minute"`
	Status             string    `json:"status"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

type dispatchRequest struct {
	Path    string `json:"path"`
	Method  string `json:"method"`
	Subject string `json:"subject"`
	Token   string `json:"token"`
	TraceID string `json:"trace_id"`
}

type dispatchResponse struct {
	Allowed        bool   `json:"allowed"`
	RouteID        string `json:"route_id,omitempty"`
	TargetService  string `json:"target_service,omitempty"`
	Reason         string `json:"reason"`
	TraceID        string `json:"trace_id"`
	RemainingQuota int    `json:"remaining_quota,omitempty"`
}

type eventContract struct {
	ID        string         `json:"id"`
	EventType string         `json:"event_type"`
	Version   string         `json:"version"`
	Schema    map[string]any `json:"schema,omitempty"`
	Status    string         `json:"status"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
}

type sagaStep struct {
	Name         string `json:"name"`
	Service      string `json:"service"`
	Action       string `json:"action"`
	Compensation string `json:"compensation"`
}

type sagaTemplate struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Version   string     `json:"version"`
	Status    string     `json:"status"`
	Steps     []sagaStep `json:"steps"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

type releasePlan struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Environment string    `json:"environment"`
	Strategy    string    `json:"strategy"`
	Services    []string  `json:"services"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type gatewayEvent struct {
	ID        string         `json:"id"`
	EventType string         `json:"event_type"`
	EntityID  string         `json:"entity_id"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

type gatewayEntityHistoryRecord struct {
	ID   string `json:"id"`
	At   string `json:"at"`
	Text string `json:"text"`
}

type gatewayEntityRelatedRecord struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Value    string `json:"value"`
	StoreKey string `json:"storeKey,omitempty"`
	RecordID string `json:"recordId,omitempty"`
}

type gatewayEntityRecord struct {
	ID       string                       `json:"id"`
	Title    string                       `json:"title"`
	Subtitle string                       `json:"subtitle"`
	Status   string                       `json:"status"`
	Values   map[string]string            `json:"values"`
	History  []gatewayEntityHistoryRecord `json:"history"`
	Related  []gatewayEntityRelatedRecord `json:"related"`
}

var gatewayStore = struct {
	sync.RWMutex
	routeSeq    int
	contractSeq int
	sagaSeq     int
	releaseSeq  int
	eventSeq    int
	routes      []gatewayRoute
	contracts   []eventContract
	sagas       []sagaTemplate
	releases    []releasePlan
	events      []gatewayEvent
	rateCounter map[string]int
	entityStore map[string][]gatewayEntityRecord
}{
	routeSeq:    1,
	contractSeq: 1,
	sagaSeq:     1,
	releaseSeq:  1,
	routes: []gatewayRoute{
		{
			ID:                 "gr-0001",
			Prefix:             "/api/sales",
			TargetService:      "sales-deals",
			Methods:            []string{"GET", "POST"},
			RequireAuth:        true,
			RateLimitPerMinute: 60,
			Status:             "active",
			CreatedAt:          time.Now().UTC(),
			UpdatedAt:          time.Now().UTC(),
		},
	},
	contracts: []eventContract{
		{
			ID:        "gc-0001",
			EventType: "SalePaid",
			Version:   "v1",
			Schema: map[string]any{
				"deal_id": "string",
				"amount":  "number",
			},
			Status:    "active",
			CreatedAt: time.Now().UTC(),
			UpdatedAt: time.Now().UTC(),
		},
	},
	sagas: []sagaTemplate{
		{
			ID:      "sg-0001",
			Name:    "sale-fulfillment",
			Version: "v1",
			Status:  "active",
			Steps: []sagaStep{
				{Name: "reserve_vehicle", Service: "sales-deals", Action: "reserve", Compensation: "release"},
				{Name: "post_invoice", Service: "finance-invoicing", Action: "create_invoice", Compensation: "cancel_invoice"},
			},
			CreatedAt: time.Now().UTC(),
			UpdatedAt: time.Now().UTC(),
		},
	},
	releases: []releasePlan{
		{
			ID:          "rp-0001",
			Name:        "platform-baseline",
			Environment: "stage",
			Strategy:    "rolling",
			Services:    []string{"api-gateway", "identity-access", "audit-log"},
			Status:      "active",
			CreatedAt:   time.Now().UTC(),
			UpdatedAt:   time.Now().UTC(),
		},
	},
	rateCounter: map[string]int{},
	entityStore: map[string][]gatewayEntityRecord{},
}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)
	mux.HandleFunc("/gateway/routes", routesHandler)
	mux.HandleFunc("/gateway/routes/", routeByIDHandler)
	mux.HandleFunc("/gateway/dispatch", dispatchHandler)
	mux.HandleFunc("/gateway/contracts", contractsHandler)
	mux.HandleFunc("/gateway/contracts/", contractByIDHandler)
	mux.HandleFunc("/gateway/sagas", sagasHandler)
	mux.HandleFunc("/gateway/sagas/", sagaByIDHandler)
	mux.HandleFunc("/gateway/releases", releasesHandler)
	mux.HandleFunc("/gateway/releases/", releaseByIDHandler)
	mux.HandleFunc("/gateway/finops", finopsHandler)
	mux.HandleFunc("/gateway/entity-store", entityStoreHandler)
	mux.HandleFunc("/events", eventsHandler)
}

func routesHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		gatewayStore.RLock()
		defer gatewayStore.RUnlock()
		out := append([]gatewayRoute(nil), gatewayStore.routes...)
		sort.Slice(out, func(i, j int) bool { return out[i].Prefix < out[j].Prefix })
		respondJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req struct {
			Prefix             string   `json:"prefix"`
			TargetService      string   `json:"target_service"`
			Methods            []string `json:"methods"`
			RequireAuth        bool     `json:"require_auth"`
			RateLimitPerMinute int      `json:"rate_limit_per_minute"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if strings.TrimSpace(req.Prefix) == "" || strings.TrimSpace(req.TargetService) == "" {
			respondError(w, http.StatusBadRequest, "prefix and target_service are required")
			return
		}
		methods := normalizeMethods(req.Methods)
		if len(methods) == 0 {
			methods = []string{"GET"}
		}
		rateLimit := req.RateLimitPerMinute
		if rateLimit <= 0 {
			rateLimit = 60
		}
		now := time.Now().UTC()
		gatewayStore.Lock()
		defer gatewayStore.Unlock()
		gatewayStore.routeSeq++
		entity := gatewayRoute{
			ID:                 fmt.Sprintf("gr-%04d", gatewayStore.routeSeq),
			Prefix:             ensurePrefix(req.Prefix),
			TargetService:      strings.TrimSpace(req.TargetService),
			Methods:            methods,
			RequireAuth:        req.RequireAuth,
			RateLimitPerMinute: rateLimit,
			Status:             "active",
			CreatedAt:          now,
			UpdatedAt:          now,
		}
		gatewayStore.routes = append(gatewayStore.routes, entity)
		appendGatewayEventLocked("GatewayRouteCreated", entity.ID, map[string]any{"prefix": entity.Prefix, "target_service": entity.TargetService})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func routeByIDHandler(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 || parts[0] != "gateway" || parts[1] != "routes" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}
	routeID := parts[2]
	if len(parts) == 3 && r.Method == http.MethodGet {
		gatewayStore.RLock()
		defer gatewayStore.RUnlock()
		index := findRouteIndexLocked(routeID)
		if index < 0 {
			respondError(w, http.StatusNotFound, "route not found")
			return
		}
		respondJSON(w, http.StatusOK, gatewayStore.routes[index])
		return
	}
	if len(parts) == 4 && parts[3] == "status" && r.Method == http.MethodPost {
		var req struct {
			Status string `json:"status"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		status := strings.ToLower(strings.TrimSpace(req.Status))
		if status != "active" && status != "disabled" {
			respondError(w, http.StatusBadRequest, "status must be active or disabled")
			return
		}
		gatewayStore.Lock()
		defer gatewayStore.Unlock()
		index := findRouteIndexLocked(routeID)
		if index < 0 {
			respondError(w, http.StatusNotFound, "route not found")
			return
		}
		prev := gatewayStore.routes[index].Status
		gatewayStore.routes[index].Status = status
		gatewayStore.routes[index].UpdatedAt = time.Now().UTC()
		appendGatewayEventLocked("GatewayRouteStatusChanged", routeID, map[string]any{"from": prev, "to": status})
		respondJSON(w, http.StatusOK, gatewayStore.routes[index])
		return
	}
	respondError(w, http.StatusNotFound, "route not found")
}

func dispatchHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req dispatchRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	path := ensurePrefix(req.Path)
	method := strings.ToUpper(defaultValue(req.Method, "GET"))
	subject := defaultValue(req.Subject, "anonymous")
	traceID := defaultValue(req.TraceID, fmt.Sprintf("gw-%d", time.Now().UnixNano()))

	gatewayStore.Lock()
	defer gatewayStore.Unlock()
	route := matchRouteLocked(path, method)
	if route == nil {
		respondJSON(w, http.StatusOK, dispatchResponse{Allowed: false, Reason: "route not found", TraceID: traceID})
		return
	}
	if route.Status != "active" {
		respondJSON(w, http.StatusOK, dispatchResponse{Allowed: false, RouteID: route.ID, Reason: "route disabled", TraceID: traceID})
		return
	}
	if route.RequireAuth && !isValidToken(req.Token) {
		appendGatewayEventLocked("GatewayAuthDenied", route.ID, map[string]any{"subject": subject})
		respondJSON(w, http.StatusOK, dispatchResponse{Allowed: false, RouteID: route.ID, TargetService: route.TargetService, Reason: "auth required", TraceID: traceID})
		return
	}
	counterKey := fmt.Sprintf("%s|%s|%s", route.ID, subject, time.Now().UTC().Format("200601021504"))
	gatewayStore.rateCounter[counterKey]++
	used := gatewayStore.rateCounter[counterKey]
	if route.RateLimitPerMinute > 0 && used > route.RateLimitPerMinute {
		appendGatewayEventLocked("GatewayRateLimited", route.ID, map[string]any{"subject": subject, "limit": route.RateLimitPerMinute})
		respondJSON(w, http.StatusOK, dispatchResponse{Allowed: false, RouteID: route.ID, TargetService: route.TargetService, Reason: "rate limit exceeded", TraceID: traceID})
		return
	}
	appendGatewayEventLocked("GatewayRequestDispatched", route.ID, map[string]any{"subject": subject, "path": path, "method": method})
	respondJSON(w, http.StatusOK, dispatchResponse{Allowed: true, RouteID: route.ID, TargetService: route.TargetService, Reason: "ok", TraceID: traceID, RemainingQuota: maxInt(route.RateLimitPerMinute-used, 0)})
}

func contractsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		gatewayStore.RLock()
		defer gatewayStore.RUnlock()
		out := append([]eventContract(nil), gatewayStore.contracts...)
		sort.Slice(out, func(i, j int) bool {
			if out[i].EventType == out[j].EventType {
				return out[i].Version < out[j].Version
			}
			return out[i].EventType < out[j].EventType
		})
		respondJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req struct {
			EventType string         `json:"event_type"`
			Version   string         `json:"version"`
			Schema    map[string]any `json:"schema"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if strings.TrimSpace(req.EventType) == "" {
			respondError(w, http.StatusBadRequest, "event_type is required")
			return
		}
		version := defaultValue(strings.TrimSpace(req.Version), "v1")
		now := time.Now().UTC()
		gatewayStore.Lock()
		defer gatewayStore.Unlock()
		gatewayStore.contractSeq++
		entity := eventContract{ID: fmt.Sprintf("gc-%04d", gatewayStore.contractSeq), EventType: strings.TrimSpace(req.EventType), Version: version, Schema: req.Schema, Status: "draft", CreatedAt: now, UpdatedAt: now}
		gatewayStore.contracts = append(gatewayStore.contracts, entity)
		appendGatewayEventLocked("EventContractCreated", entity.ID, map[string]any{"event_type": entity.EventType, "version": entity.Version})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func contractByIDHandler(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 4 || parts[0] != "gateway" || parts[1] != "contracts" || parts[3] != "status" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	contractID := parts[2]
	var req struct {
		Status string `json:"status"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if status != "draft" && status != "active" && status != "deprecated" {
		respondError(w, http.StatusBadRequest, "unsupported status")
		return
	}
	gatewayStore.Lock()
	defer gatewayStore.Unlock()
	index := findContractIndexLocked(contractID)
	if index < 0 {
		respondError(w, http.StatusNotFound, "contract not found")
		return
	}
	prev := gatewayStore.contracts[index].Status
	gatewayStore.contracts[index].Status = status
	gatewayStore.contracts[index].UpdatedAt = time.Now().UTC()
	appendGatewayEventLocked("EventContractStatusChanged", contractID, map[string]any{"from": prev, "to": status})
	respondJSON(w, http.StatusOK, gatewayStore.contracts[index])
}

func sagasHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		gatewayStore.RLock()
		defer gatewayStore.RUnlock()
		respondJSON(w, http.StatusOK, gatewayStore.sagas)
	case http.MethodPost:
		var req struct {
			Name    string     `json:"name"`
			Version string     `json:"version"`
			Steps   []sagaStep `json:"steps"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if strings.TrimSpace(req.Name) == "" || len(req.Steps) == 0 {
			respondError(w, http.StatusBadRequest, "name and steps are required")
			return
		}
		now := time.Now().UTC()
		gatewayStore.Lock()
		defer gatewayStore.Unlock()
		gatewayStore.sagaSeq++
		entity := sagaTemplate{ID: fmt.Sprintf("sg-%04d", gatewayStore.sagaSeq), Name: strings.TrimSpace(req.Name), Version: defaultValue(strings.TrimSpace(req.Version), "v1"), Status: "draft", Steps: req.Steps, CreatedAt: now, UpdatedAt: now}
		gatewayStore.sagas = append(gatewayStore.sagas, entity)
		appendGatewayEventLocked("SagaTemplateCreated", entity.ID, map[string]any{"name": entity.Name, "steps": len(entity.Steps)})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func sagaByIDHandler(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 4 || parts[0] != "gateway" || parts[1] != "sagas" || parts[3] != "status" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	sagaID := parts[2]
	var req struct {
		Status string `json:"status"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if status != "draft" && status != "active" && status != "disabled" {
		respondError(w, http.StatusBadRequest, "unsupported status")
		return
	}
	gatewayStore.Lock()
	defer gatewayStore.Unlock()
	index := findSagaIndexLocked(sagaID)
	if index < 0 {
		respondError(w, http.StatusNotFound, "saga not found")
		return
	}
	prev := gatewayStore.sagas[index].Status
	gatewayStore.sagas[index].Status = status
	gatewayStore.sagas[index].UpdatedAt = time.Now().UTC()
	appendGatewayEventLocked("SagaTemplateStatusChanged", sagaID, map[string]any{"from": prev, "to": status})
	respondJSON(w, http.StatusOK, gatewayStore.sagas[index])
}

func releasesHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		gatewayStore.RLock()
		defer gatewayStore.RUnlock()
		respondJSON(w, http.StatusOK, gatewayStore.releases)
	case http.MethodPost:
		var req struct {
			Name        string   `json:"name"`
			Environment string   `json:"environment"`
			Strategy    string   `json:"strategy"`
			Services    []string `json:"services"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.Environment) == "" {
			respondError(w, http.StatusBadRequest, "name and environment are required")
			return
		}
		now := time.Now().UTC()
		gatewayStore.Lock()
		defer gatewayStore.Unlock()
		gatewayStore.releaseSeq++
		entity := releasePlan{ID: fmt.Sprintf("rp-%04d", gatewayStore.releaseSeq), Name: strings.TrimSpace(req.Name), Environment: strings.ToLower(strings.TrimSpace(req.Environment)), Strategy: defaultValue(strings.TrimSpace(req.Strategy), "rolling"), Services: req.Services, Status: "planned", CreatedAt: now, UpdatedAt: now}
		gatewayStore.releases = append(gatewayStore.releases, entity)
		appendGatewayEventLocked("ReleasePlanCreated", entity.ID, map[string]any{"environment": entity.Environment, "strategy": entity.Strategy})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func releaseByIDHandler(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 4 || parts[0] != "gateway" || parts[1] != "releases" || parts[3] != "status" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	releaseID := parts[2]
	var req struct {
		Status string `json:"status"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if status != "planned" && status != "rolling_out" && status != "active" && status != "rolled_back" && status != "failed" {
		respondError(w, http.StatusBadRequest, "unsupported status")
		return
	}
	gatewayStore.Lock()
	defer gatewayStore.Unlock()
	index := findReleaseIndexLocked(releaseID)
	if index < 0 {
		respondError(w, http.StatusNotFound, "release not found")
		return
	}
	prev := gatewayStore.releases[index].Status
	gatewayStore.releases[index].Status = status
	gatewayStore.releases[index].UpdatedAt = time.Now().UTC()
	eventType := "ReleaseStatusChanged"
	if status == "rolled_back" {
		eventType = "ReleaseRolledBack"
	}
	appendGatewayEventLocked(eventType, releaseID, map[string]any{"from": prev, "to": status})
	respondJSON(w, http.StatusOK, gatewayStore.releases[index])
}

func finopsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	gatewayStore.RLock()
	defer gatewayStore.RUnlock()
	breaches := 0
	dispatches := 0
	for _, event := range gatewayStore.events {
		if event.EventType == "GatewayRateLimited" {
			breaches++
		}
		if event.EventType == "GatewayRequestDispatched" {
			dispatches++
		}
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"active_routes":          countRoutesByStatusLocked("active"),
		"disabled_routes":        countRoutesByStatusLocked("disabled"),
		"contracts_active":       countContractsByStatusLocked("active"),
		"release_plans":          len(gatewayStore.releases),
		"dispatch_count":         dispatches,
		"rate_limit_breaches":    breaches,
		"estimated_monthly_cost": 1200 + 5*len(gatewayStore.routes) + 2*dispatches,
	})
}

func eventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	gatewayStore.RLock()
	defer gatewayStore.RUnlock()
	respondJSON(w, http.StatusOK, gatewayStore.events)
}

func entityStoreHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		gatewayStore.RLock()
		store := cloneEntityStore(gatewayStore.entityStore)
		gatewayStore.RUnlock()
		respondJSON(w, http.StatusOK, map[string]any{
			"store": store,
		})
	case http.MethodPut, http.MethodPost:
		var req struct {
			Store map[string][]gatewayEntityRecord `json:"store"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.Store == nil {
			req.Store = map[string][]gatewayEntityRecord{}
		}
		normalized := cloneEntityStore(req.Store)
		isReplay := strings.EqualFold(strings.TrimSpace(r.Header.Get("X-KIS-Replay")), "1")
		if err := validateEntityStoreForSave(normalized, isReplay); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		gatewayStore.Lock()
		gatewayStore.entityStore = normalized
		appendGatewayEventLocked("GatewayEntityStoreSaved", "entity-store", map[string]any{
			"keys": len(normalized),
		})
		gatewayStore.Unlock()
		respondJSON(w, http.StatusOK, map[string]any{
			"status": "ok",
			"keys":   len(normalized),
		})
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func cloneEntityStore(src map[string][]gatewayEntityRecord) map[string][]gatewayEntityRecord {
	if len(src) == 0 {
		return map[string][]gatewayEntityRecord{}
	}
	out := make(map[string][]gatewayEntityRecord, len(src))
	for storeKey, records := range src {
		copiedRecords := make([]gatewayEntityRecord, len(records))
		for i, record := range records {
			copied := gatewayEntityRecord{
				ID:       record.ID,
				Title:    record.Title,
				Subtitle: record.Subtitle,
				Status:   record.Status,
			}
			if len(record.Values) > 0 {
				copied.Values = make(map[string]string, len(record.Values))
				for key, value := range record.Values {
					copied.Values[key] = value
				}
			} else {
				copied.Values = map[string]string{}
			}
			if len(record.History) > 0 {
				copied.History = make([]gatewayEntityHistoryRecord, len(record.History))
				copy(copied.History, record.History)
			} else {
				copied.History = []gatewayEntityHistoryRecord{}
			}
			if len(record.Related) > 0 {
				copied.Related = make([]gatewayEntityRelatedRecord, len(record.Related))
				for j, related := range record.Related {
					copied.Related[j] = gatewayEntityRelatedRecord{
						ID:       related.ID,
						Label:    related.Label,
						Value:    related.Value,
						StoreKey: related.StoreKey,
						RecordID: related.RecordID,
					}
				}
			} else {
				copied.Related = []gatewayEntityRelatedRecord{}
			}
			copiedRecords[i] = copied
		}
		out[storeKey] = copiedRecords
	}
	return out
}

func validateEntityStoreForSave(store map[string][]gatewayEntityRecord, allowDuplicateVIN bool) error {
	cars, ok := store["crm-sales/cars"]
	if !ok || len(cars) == 0 {
		return nil
	}

	seenVINs := make(map[string]string, len(cars))
	for i := range cars {
		normalizedVIN := strings.ToUpper(strings.TrimSpace(cars[i].Values["vin"]))
		if normalizedVIN == "" {
			continue
		}

		cars[i].Values["vin"] = normalizedVIN
		if duplicateID, exists := seenVINs[normalizedVIN]; exists {
			if allowDuplicateVIN {
				continue
			}
			if duplicateID == "" {
				duplicateID = "unknown"
			}
			currentID := strings.TrimSpace(cars[i].ID)
			if currentID == "" {
				currentID = "unknown"
			}
			return fmt.Errorf("duplicate VIN: %s (%s, %s)", normalizedVIN, duplicateID, currentID)
		}

		currentID := strings.TrimSpace(cars[i].ID)
		if currentID == "" {
			currentID = "unknown"
		}
		seenVINs[normalizedVIN] = currentID
	}

	store["crm-sales/cars"] = cars
	return nil
}

func appendGatewayEventLocked(eventType, entityID string, payload map[string]any) {
	gatewayStore.eventSeq++
	gatewayStore.events = append(gatewayStore.events, gatewayEvent{ID: fmt.Sprintf("gwe-%05d", gatewayStore.eventSeq), EventType: eventType, EntityID: entityID, Payload: payload, CreatedAt: time.Now().UTC()})
}

func findRouteIndexLocked(id string) int {
	for i := range gatewayStore.routes {
		if gatewayStore.routes[i].ID == id {
			return i
		}
	}
	return -1
}

func findContractIndexLocked(id string) int {
	for i := range gatewayStore.contracts {
		if gatewayStore.contracts[i].ID == id {
			return i
		}
	}
	return -1
}

func findSagaIndexLocked(id string) int {
	for i := range gatewayStore.sagas {
		if gatewayStore.sagas[i].ID == id {
			return i
		}
	}
	return -1
}

func findReleaseIndexLocked(id string) int {
	for i := range gatewayStore.releases {
		if gatewayStore.releases[i].ID == id {
			return i
		}
	}
	return -1
}

func matchRouteLocked(path, method string) *gatewayRoute {
	bestIndex := -1
	bestPrefixLen := -1
	for i := range gatewayStore.routes {
		route := &gatewayStore.routes[i]
		if !strings.HasPrefix(path, route.Prefix) {
			continue
		}
		if !methodAllowed(route.Methods, method) {
			continue
		}
		if len(route.Prefix) > bestPrefixLen {
			bestIndex = i
			bestPrefixLen = len(route.Prefix)
		}
	}
	if bestIndex < 0 {
		return nil
	}
	return &gatewayStore.routes[bestIndex]
}

func methodAllowed(methods []string, method string) bool {
	for _, item := range methods {
		if strings.EqualFold(item, method) {
			return true
		}
	}
	return false
}

func normalizeMethods(methods []string) []string {
	if len(methods) == 0 {
		return nil
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(methods))
	for _, method := range methods {
		normalized := strings.ToUpper(strings.TrimSpace(method))
		if normalized == "" || seen[normalized] {
			continue
		}
		seen[normalized] = true
		out = append(out, normalized)
	}
	sort.Strings(out)
	return out
}

func ensurePrefix(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "/"
	}
	if strings.HasPrefix(trimmed, "/") {
		return trimmed
	}
	return "/" + trimmed
}

func isValidToken(token string) bool {
	token = strings.TrimSpace(token)
	return token != "" && strings.HasPrefix(token, "tok_")
}

func countRoutesByStatusLocked(status string) int {
	count := 0
	for _, route := range gatewayStore.routes {
		if route.Status == status {
			count++
		}
	}
	return count
}

func countContractsByStatusLocked(status string) int {
	count := 0
	for _, contract := range gatewayStore.contracts {
		if contract.Status == status {
			count++
		}
	}
	return count
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]any{"service": "api-gateway", "status": "ok", "routes": len(gatewayStore.routes)})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]any{"service": "api-gateway", "status": "ready", "routes": len(gatewayStore.routes)})
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
