package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func resetBIStore() {
	biStore.Lock()
	defer biStore.Unlock()
	biStore.kpiSeq = 2
	biStore.sloSeq = 1
	biStore.alertSeq = 1
	biStore.backupSeq = 0
	biStore.deliverySeq = 1
	biStore.eventSeq = 0
	biStore.kpis = []kpiSnapshot{
		{ID: "kpi-0001", Name: "API Availability", Domain: "platform", Value: 99.93, Unit: "%", UpdatedAt: time.Now().UTC()},
		{ID: "kpi-0002", Name: "Error Budget Remaining", Domain: "platform", Value: 82.4, Unit: "%", UpdatedAt: time.Now().UTC()},
	}
	biStore.slos = []sloDefinition{
		{ID: "slo-0001", Name: "Gateway availability", Service: "api-gateway", Window: "30d", TargetPct: 99.9, ErrorBudgetPct: 0.1, Status: "healthy", UpdatedAt: time.Now().UTC()},
	}
	biStore.alerts = []alertRule{
		{ID: "al-0001", Name: "Gateway error spike", Expression: "error_rate_pct > 2", Severity: "high", Status: "active", UpdatedAt: time.Now().UTC()},
	}
	biStore.backups = nil
	biStore.runbooks = []runbook{
		{ID: "rb-0001", Service: "api-gateway", Title: "Gateway outage response", Link: "docs/runbooks/gateway-outage.md"},
		{ID: "rb-0002", Service: "notification", Title: "Notification backlog response", Link: "docs/runbooks/notification-backlog.md"},
	}
	biStore.deliveries = []deliveryPlan{
		{ID: "dp-0001", Name: "platform-release-1", Environment: "stage", Strategy: "rolling", Services: []string{"api-gateway", "identity-access"}, Status: "active", UpdatedAt: time.Now().UTC()},
	}
	biStore.finops = []finopsMetric{
		{Service: "api-gateway", CostUSD: 420, Requests: 125000, LatencyP95: 45, ErrorRate: 0.34},
		{Service: "notification", CostUSD: 190, Requests: 44000, LatencyP95: 38, ErrorRate: 0.21},
		{Service: "audit-log", CostUSD: 120, Requests: 62000, LatencyP95: 28, ErrorRate: 0.14},
	}
	biStore.events = nil
}

func doBIJSONRequest(mux *http.ServeMux, method, path, body string) *httptest.ResponseRecorder {
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
	resetBIStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	cases := []struct {
		path    string
		service string
		status  string
	}{
		{path: "/healthz", service: "reporting-bi", status: "ok"},
		{path: "/readyz", service: "reporting-bi", status: "ready"},
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

func TestKPIObservabilityAndSLO(t *testing.T) {
	resetBIStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	kpiRR := doBIJSONRequest(mux, http.MethodPost, "/bi/kpis", `{"name":"Gateway Throughput","domain":"platform","value":1833.4,"unit":"rpm"}`)
	if kpiRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", kpiRR.Code)
	}
	var kpi kpiSnapshot
	if err := json.NewDecoder(kpiRR.Body).Decode(&kpi); err != nil {
		t.Fatalf("decode kpi: %v", err)
	}
	if kpi.ID == "" {
		t.Fatal("expected kpi id")
	}

	obsRR := doBIJSONRequest(mux, http.MethodGet, "/bi/observability", "")
	if obsRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", obsRR.Code)
	}
	var obs map[string]any
	if err := json.NewDecoder(obsRR.Body).Decode(&obs); err != nil {
		t.Fatalf("decode observability: %v", err)
	}
	if obs["services"] == nil {
		t.Fatalf("expected services metric, got %+v", obs)
	}

	sloRR := doBIJSONRequest(mux, http.MethodPost, "/bi/slo", `{"name":"Notification delivery","service":"notification","window":"30d","target_pct":99.5}`)
	if sloRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", sloRR.Code)
	}
	var slo sloDefinition
	if err := json.NewDecoder(sloRR.Body).Decode(&slo); err != nil {
		t.Fatalf("decode slo: %v", err)
	}
	if slo.ID == "" {
		t.Fatal("expected slo id")
	}

	sloStatusRR := doBIJSONRequest(mux, http.MethodPost, "/bi/slo/"+slo.ID+"/status", `{"status":"degraded"}`)
	if sloStatusRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", sloStatusRR.Code)
	}
}

func TestAlertsBackupsDeliveryFinopsAndEvents(t *testing.T) {
	resetBIStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	alertRR := doBIJSONRequest(mux, http.MethodPost, "/bi/alerts", `{"name":"NATS backlog","expression":"backlog > 1000","severity":"critical"}`)
	if alertRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", alertRR.Code)
	}
	var alert alertRule
	if err := json.NewDecoder(alertRR.Body).Decode(&alert); err != nil {
		t.Fatalf("decode alert: %v", err)
	}

	triggerRR := doBIJSONRequest(mux, http.MethodPost, "/bi/alerts/"+alert.ID+"/trigger", "")
	if triggerRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", triggerRR.Code)
	}

	backupRR := doBIJSONRequest(mux, http.MethodPost, "/bi/backups", `{"scope":"platform"}`)
	if backupRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", backupRR.Code)
	}
	var backup backupJob
	if err := json.NewDecoder(backupRR.Body).Decode(&backup); err != nil {
		t.Fatalf("decode backup: %v", err)
	}

	restoreRR := doBIJSONRequest(mux, http.MethodPost, "/bi/backups/"+backup.ID+"/restore", "")
	if restoreRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", restoreRR.Code)
	}

	runbooksRR := doBIJSONRequest(mux, http.MethodGet, "/bi/runbooks", "")
	if runbooksRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", runbooksRR.Code)
	}
	var runbooks []runbook
	if err := json.NewDecoder(runbooksRR.Body).Decode(&runbooks); err != nil {
		t.Fatalf("decode runbooks: %v", err)
	}
	if len(runbooks) == 0 {
		t.Fatal("expected runbooks")
	}

	deliveryRR := doBIJSONRequest(mux, http.MethodPost, "/bi/delivery", `{"name":"platform-rollout","environment":"prod","strategy":"canary","services":["api-gateway","notification"]}`)
	if deliveryRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", deliveryRR.Code)
	}
	var delivery deliveryPlan
	if err := json.NewDecoder(deliveryRR.Body).Decode(&delivery); err != nil {
		t.Fatalf("decode delivery: %v", err)
	}

	deliveryStatusRR := doBIJSONRequest(mux, http.MethodPost, "/bi/delivery/"+delivery.ID+"/status", `{"status":"rolled_back"}`)
	if deliveryStatusRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", deliveryStatusRR.Code)
	}

	finopsRR := doBIJSONRequest(mux, http.MethodGet, "/bi/finops", "")
	if finopsRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", finopsRR.Code)
	}
	var finops map[string]any
	if err := json.NewDecoder(finopsRR.Body).Decode(&finops); err != nil {
		t.Fatalf("decode finops: %v", err)
	}
	if finops["total_cost_usd"] == nil {
		t.Fatalf("expected total_cost_usd metric, got %+v", finops)
	}

	eventsRR := doBIJSONRequest(mux, http.MethodGet, "/events", "")
	if eventsRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", eventsRR.Code)
	}
	var events []biEvent
	if err := json.NewDecoder(eventsRR.Body).Decode(&events); err != nil {
		t.Fatalf("decode events: %v", err)
	}
	if len(events) == 0 {
		t.Fatal("expected bi events to be present")
	}
}
