package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func resetGatewayStore() {
	gatewayStore.Lock()
	defer gatewayStore.Unlock()
	gatewayStore.routeSeq = 1
	gatewayStore.contractSeq = 1
	gatewayStore.sagaSeq = 1
	gatewayStore.releaseSeq = 1
	gatewayStore.eventSeq = 0
	gatewayStore.routes = []gatewayRoute{
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
	}
	gatewayStore.contracts = []eventContract{
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
	}
	gatewayStore.sagas = []sagaTemplate{
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
	}
	gatewayStore.releases = []releasePlan{
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
	}
	gatewayStore.events = nil
	gatewayStore.rateCounter = map[string]int{}
	gatewayStore.entityStore = map[string][]gatewayEntityRecord{}
}

func doGatewayJSONRequest(mux *http.ServeMux, method, path, body string) *httptest.ResponseRecorder {
	var req *http.Request
	if strings.TrimSpace(body) == "" {
		req = httptest.NewRequest(method, path, nil)
	} else {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	return rr
}

func TestHealthAndReady(t *testing.T) {
	resetGatewayStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	cases := []struct {
		path    string
		service string
		status  string
	}{
		{path: "/healthz", service: "api-gateway", status: "ok"},
		{path: "/readyz", service: "api-gateway", status: "ready"},
	}

	for _, tc := range cases {
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("%s: expected status 200, got %d", tc.path, rr.Code)
		}

		var got map[string]any
		if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
			t.Fatalf("%s: decode response: %v", tc.path, err)
		}

		if got["service"] != tc.service {
			t.Fatalf("%s: expected service %q, got %q", tc.path, tc.service, got["service"])
		}
		if got["status"] != tc.status {
			t.Fatalf("%s: expected status %q, got %q", tc.path, tc.status, got["status"])
		}
	}
}

func TestRouteLifecycleAndDispatch(t *testing.T) {
	resetGatewayStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	createRR := doGatewayJSONRequest(mux, http.MethodPost, "/gateway/routes", `{"prefix":"/api/service","target_service":"service-workorders","methods":["POST"],"require_auth":true,"rate_limit_per_minute":1}`)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", createRR.Code)
	}
	var route gatewayRoute
	if err := json.NewDecoder(createRR.Body).Decode(&route); err != nil {
		t.Fatalf("decode route: %v", err)
	}
	if route.ID == "" {
		t.Fatal("expected route id")
	}

	noAuthRR := doGatewayJSONRequest(mux, http.MethodPost, "/gateway/dispatch", `{"path":"/api/service/orders","method":"POST","subject":"agent-1"}`)
	if noAuthRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", noAuthRR.Code)
	}
	var noAuthResp dispatchResponse
	if err := json.NewDecoder(noAuthRR.Body).Decode(&noAuthResp); err != nil {
		t.Fatalf("decode no-auth dispatch: %v", err)
	}
	if noAuthResp.Allowed || noAuthResp.Reason != "auth required" {
		t.Fatalf("expected auth required deny, got %+v", noAuthResp)
	}

	allowedRR := doGatewayJSONRequest(mux, http.MethodPost, "/gateway/dispatch", `{"path":"/api/service/orders","method":"POST","subject":"agent-1","token":"tok_abc"}`)
	if allowedRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", allowedRR.Code)
	}
	var allowedResp dispatchResponse
	if err := json.NewDecoder(allowedRR.Body).Decode(&allowedResp); err != nil {
		t.Fatalf("decode allowed dispatch: %v", err)
	}
	if !allowedResp.Allowed {
		t.Fatalf("expected dispatch to be allowed, got %+v", allowedResp)
	}

	limitedRR := doGatewayJSONRequest(mux, http.MethodPost, "/gateway/dispatch", `{"path":"/api/service/orders","method":"POST","subject":"agent-1","token":"tok_abc"}`)
	if limitedRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", limitedRR.Code)
	}
	var limitedResp dispatchResponse
	if err := json.NewDecoder(limitedRR.Body).Decode(&limitedResp); err != nil {
		t.Fatalf("decode limited dispatch: %v", err)
	}
	if limitedResp.Allowed || limitedResp.Reason != "rate limit exceeded" {
		t.Fatalf("expected rate-limit deny, got %+v", limitedResp)
	}

	statusRR := doGatewayJSONRequest(mux, http.MethodPost, "/gateway/routes/"+route.ID+"/status", `{"status":"disabled"}`)
	if statusRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", statusRR.Code)
	}

	disabledRR := doGatewayJSONRequest(mux, http.MethodPost, "/gateway/dispatch", `{"path":"/api/service/orders","method":"POST","subject":"agent-1","token":"tok_abc"}`)
	if disabledRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", disabledRR.Code)
	}
	var disabledResp dispatchResponse
	if err := json.NewDecoder(disabledRR.Body).Decode(&disabledResp); err != nil {
		t.Fatalf("decode disabled dispatch: %v", err)
	}
	if disabledResp.Allowed || disabledResp.Reason != "route disabled" {
		t.Fatalf("expected disabled route deny, got %+v", disabledResp)
	}

	eventsRR := doGatewayJSONRequest(mux, http.MethodGet, "/events", "")
	if eventsRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", eventsRR.Code)
	}
	var events []gatewayEvent
	if err := json.NewDecoder(eventsRR.Body).Decode(&events); err != nil {
		t.Fatalf("decode events: %v", err)
	}
	if len(events) == 0 {
		t.Fatal("expected at least one gateway event")
	}
}

func TestContractsSagasReleasesAndFinops(t *testing.T) {
	resetGatewayStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	contractRR := doGatewayJSONRequest(mux, http.MethodPost, "/gateway/contracts", `{"event_type":"WorkOrderClosed","version":"v2","schema":{"wo_id":"string"}}`)
	if contractRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", contractRR.Code)
	}
	var contract eventContract
	if err := json.NewDecoder(contractRR.Body).Decode(&contract); err != nil {
		t.Fatalf("decode contract: %v", err)
	}

	contractStatusRR := doGatewayJSONRequest(mux, http.MethodPost, "/gateway/contracts/"+contract.ID+"/status", `{"status":"active"}`)
	if contractStatusRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", contractStatusRR.Code)
	}

	sagaRR := doGatewayJSONRequest(mux, http.MethodPost, "/gateway/sagas", `{"name":"service-close","steps":[{"name":"close_workorder","service":"service-workorders","action":"close","compensation":"reopen"}]}`)
	if sagaRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", sagaRR.Code)
	}
	var saga sagaTemplate
	if err := json.NewDecoder(sagaRR.Body).Decode(&saga); err != nil {
		t.Fatalf("decode saga: %v", err)
	}

	sagaStatusRR := doGatewayJSONRequest(mux, http.MethodPost, "/gateway/sagas/"+saga.ID+"/status", `{"status":"active"}`)
	if sagaStatusRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", sagaStatusRR.Code)
	}

	releaseRR := doGatewayJSONRequest(mux, http.MethodPost, "/gateway/releases", `{"name":"platform-wave","environment":"prod","strategy":"canary","services":["api-gateway","identity-access"]}`)
	if releaseRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", releaseRR.Code)
	}
	var release releasePlan
	if err := json.NewDecoder(releaseRR.Body).Decode(&release); err != nil {
		t.Fatalf("decode release: %v", err)
	}

	releaseStatusRR := doGatewayJSONRequest(mux, http.MethodPost, "/gateway/releases/"+release.ID+"/status", `{"status":"rolled_back"}`)
	if releaseStatusRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", releaseStatusRR.Code)
	}

	finopsRR := doGatewayJSONRequest(mux, http.MethodGet, "/gateway/finops", "")
	if finopsRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", finopsRR.Code)
	}
	var finops map[string]any
	if err := json.NewDecoder(finopsRR.Body).Decode(&finops); err != nil {
		t.Fatalf("decode finops: %v", err)
	}
	if finops["release_plans"] == nil {
		t.Fatalf("expected release_plans metric, got %+v", finops)
	}
}

func TestEntityStoreSaveAndFetch(t *testing.T) {
	resetGatewayStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	saveBody := `{
		"store": {
			"crm-sales/cars": [
				{
					"id": "CAR-9001",
					"title": "Test Car",
					"subtitle": "Integration sample",
					"status": "active",
					"values": {
						"vin": "xw7bf4fk30s123456",
						"brand": "Toyota"
					},
					"history": [],
					"related": []
				}
			]
		}
	}`

	saveRR := doGatewayJSONRequest(mux, http.MethodPut, "/gateway/entity-store", saveBody)
	if saveRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", saveRR.Code)
	}

	getRR := doGatewayJSONRequest(mux, http.MethodGet, "/gateway/entity-store", "")
	if getRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", getRR.Code)
	}

	var payload struct {
		Store map[string][]gatewayEntityRecord `json:"store"`
	}
	if err := json.NewDecoder(getRR.Body).Decode(&payload); err != nil {
		t.Fatalf("decode entity store: %v", err)
	}

	cars := payload.Store["crm-sales/cars"]
	if len(cars) != 1 {
		t.Fatalf("expected 1 car, got %d", len(cars))
	}
	if got := cars[0].Values["vin"]; got != "XW7BF4FK30S123456" {
		t.Fatalf("expected normalized VIN, got %q", got)
	}
}

func TestEntityStoreRejectsDuplicateVIN(t *testing.T) {
	resetGatewayStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	saveBody := `{
		"store": {
			"crm-sales/cars": [
				{
					"id": "CAR-9001",
					"title": "Car One",
					"subtitle": "Sample",
					"status": "active",
					"values": { "vin": "xw7bf4fk30s123456" },
					"history": [],
					"related": []
				},
				{
					"id": "CAR-9002",
					"title": "Car Two",
					"subtitle": "Sample",
					"status": "active",
					"values": { "vin": "XW7BF4FK30S123456" },
					"history": [],
					"related": []
				}
			]
		}
	}`

	saveRR := doGatewayJSONRequest(mux, http.MethodPut, "/gateway/entity-store", saveBody)
	if saveRR.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", saveRR.Code)
	}

	var errPayload map[string]any
	if err := json.NewDecoder(saveRR.Body).Decode(&errPayload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	message, _ := errPayload["error"].(string)
	if !strings.Contains(message, "duplicate VIN") {
		t.Fatalf("expected duplicate VIN error, got %q", message)
	}

	getRR := doGatewayJSONRequest(mux, http.MethodGet, "/gateway/entity-store", "")
	if getRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", getRR.Code)
	}

	var payload struct {
		Store map[string][]gatewayEntityRecord `json:"store"`
	}
	if err := json.NewDecoder(getRR.Body).Decode(&payload); err != nil {
		t.Fatalf("decode entity store: %v", err)
	}
	if len(payload.Store) != 0 {
		t.Fatalf("expected empty store after failed save, got %+v", payload.Store)
	}
}

func TestEntityStoreReplayAllowsDuplicateVIN(t *testing.T) {
	resetGatewayStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	saveBody := `{
		"store": {
			"crm-sales/cars": [
				{
					"id": "CAR-9001",
					"title": "Car One",
					"subtitle": "Sample",
					"status": "active",
					"values": { "vin": "xw7bf4fk30s123456" },
					"history": [],
					"related": []
				},
				{
					"id": "CAR-9002",
					"title": "Car Two",
					"subtitle": "Sample",
					"status": "active",
					"values": { "vin": "XW7BF4FK30S123456" },
					"history": [],
					"related": []
				}
			]
		}
	}`

	req := httptest.NewRequest(http.MethodPut, "/gateway/entity-store", strings.NewReader(saveBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-KIS-Replay", "1")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200 for replay save, got %d", rr.Code)
	}

	getRR := doGatewayJSONRequest(mux, http.MethodGet, "/gateway/entity-store", "")
	if getRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", getRR.Code)
	}

	var payload struct {
		Store map[string][]gatewayEntityRecord `json:"store"`
	}
	if err := json.NewDecoder(getRR.Body).Decode(&payload); err != nil {
		t.Fatalf("decode entity store: %v", err)
	}

	cars := payload.Store["crm-sales/cars"]
	if len(cars) != 2 {
		t.Fatalf("expected 2 cars, got %d", len(cars))
	}
	if got := cars[0].Values["vin"]; got != "XW7BF4FK30S123456" {
		t.Fatalf("expected normalized VIN for car 1, got %q", got)
	}
	if got := cars[1].Values["vin"]; got != "XW7BF4FK30S123456" {
		t.Fatalf("expected normalized VIN for car 2, got %q", got)
	}
}
