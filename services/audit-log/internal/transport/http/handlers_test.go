package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetAuditLogStore() {
	auditStore.Lock()
	auditStore.seq = 0
	auditStore.lastHash = ""
	auditStore.retentionDays = 365
	auditStore.events = nil
	auditStore.Unlock()

	auditMetrics.Lock()
	auditMetrics.requests = map[auditHTTPMetric]int{}
	auditMetrics.durationMsSum = 0
	auditMetrics.durationCount = 0
	auditMetrics.Unlock()
}

func TestIsCriticalAction(t *testing.T) {
	if !isCriticalAction("close") {
		t.Fatal("expected close action to be critical")
	}
	if isCriticalAction("read") {
		t.Fatal("expected read action to be non-critical")
	}
}

func TestCriticalEventsFilter(t *testing.T) {
	resetAuditLogStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	criticalReq := httptest.NewRequest(http.MethodPost, "/audit/events", strings.NewReader(`{"resource":"sales-deals","action":"close","object_id":"dl-1"}`))
	criticalReq.Header.Set("Content-Type", "application/json")
	criticalRR := httptest.NewRecorder()
	mux.ServeHTTP(criticalRR, criticalReq)
	if criticalRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", criticalRR.Code)
	}

	nonCriticalReq := httptest.NewRequest(http.MethodPost, "/audit/events", strings.NewReader(`{"resource":"sales-deals","action":"read","object_id":"dl-1"}`))
	nonCriticalReq.Header.Set("Content-Type", "application/json")
	nonCriticalRR := httptest.NewRecorder()
	mux.ServeHTTP(nonCriticalRR, nonCriticalReq)
	if nonCriticalRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", nonCriticalRR.Code)
	}

	filterReq := httptest.NewRequest(http.MethodGet, "/audit/events/critical", nil)
	filterRR := httptest.NewRecorder()
	mux.ServeHTTP(filterRR, filterReq)

	if filterRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", filterRR.Code)
	}

	var got []auditEvent
	if err := json.NewDecoder(filterRR.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 critical event, got %d", len(got))
	}
	if got[0].Action != "close" {
		t.Fatalf("expected action close, got %q", got[0].Action)
	}
}

func TestIntegrityAndRetention(t *testing.T) {
	resetAuditLogStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	createReq := httptest.NewRequest(http.MethodPost, "/audit/events", strings.NewReader(`{"resource":"finance-ledger","action":"post_ledger","object_id":"le-1"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRR := httptest.NewRecorder()
	mux.ServeHTTP(createRR, createReq)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", createRR.Code)
	}

	integrityReq := httptest.NewRequest(http.MethodGet, "/audit/integrity", nil)
	integrityRR := httptest.NewRecorder()
	mux.ServeHTTP(integrityRR, integrityReq)
	if integrityRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", integrityRR.Code)
	}
	var integrity map[string]any
	if err := json.NewDecoder(integrityRR.Body).Decode(&integrity); err != nil {
		t.Fatalf("decode integrity: %v", err)
	}
	if integrity["valid"] != true {
		t.Fatalf("expected valid hash chain, got %v", integrity["valid"])
	}

	retentionReq := httptest.NewRequest(http.MethodPost, "/audit/retention", strings.NewReader(`{"retention_days":180}`))
	retentionReq.Header.Set("Content-Type", "application/json")
	retentionRR := httptest.NewRecorder()
	mux.ServeHTTP(retentionRR, retentionReq)
	if retentionRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", retentionRR.Code)
	}
}
