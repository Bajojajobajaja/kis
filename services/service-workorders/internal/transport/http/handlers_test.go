package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetWorkorderStore() {
	workorderStore.Lock()
	workorderStore.seq = 0
	workorderStore.workorders = nil
	workorderStore.Unlock()

	workorderNotificationStore.Lock()
	workorderNotificationStore.seq = 0
	workorderNotificationStore.notifications = nil
	workorderNotificationStore.Unlock()

	workorderAuditStore.Lock()
	workorderAuditStore.seq = 0
	workorderAuditStore.events = nil
	workorderAuditStore.Unlock()
}

func createWorkorder(t *testing.T, mux *http.ServeMux, userID string) workorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/workorders", strings.NewReader(`{"client_id":"cl-1","vehicle_vin":"VIN123"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Role", "service_advisor")
	req.Header.Set("X-User-ID", userID)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", rr.Code)
	}

	var wo workorder
	if err := json.NewDecoder(rr.Body).Decode(&wo); err != nil {
		t.Fatalf("decode workorder: %v", err)
	}
	return wo
}

func updateWorkorderStatus(t *testing.T, mux *http.ServeMux, woID, status, userID string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/workorders/"+woID+"/status", strings.NewReader(`{"status":"`+status+`"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Role", "service_advisor")
	req.Header.Set("X-User-ID", userID)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("update status %s: expected 200, got %d", status, rr.Code)
	}
}

func TestCloseWorkorderSagaCompensation(t *testing.T) {
	resetWorkorderStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	created := createWorkorder(t, mux, "advisor-1")
	updateWorkorderStatus(t, mux, created.ID, "diagnostics", "advisor-1")
	updateWorkorderStatus(t, mux, created.ID, "in_progress", "advisor-1")
	updateWorkorderStatus(t, mux, created.ID, "ready", "advisor-1")

	closeReq := httptest.NewRequest(http.MethodPost, "/workorders/"+created.ID+"/close", strings.NewReader(`{"simulate_billing_failure":true}`))
	closeReq.Header.Set("Content-Type", "application/json")
	closeReq.Header.Set("X-Role", "service_advisor")
	closeReq.Header.Set("X-User-ID", "advisor-1")
	closeRR := httptest.NewRecorder()
	mux.ServeHTTP(closeRR, closeReq)

	if closeRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", closeRR.Code)
	}

	var got struct {
		Result    string    `json:"result"`
		Workorder workorder `json:"workorder"`
	}
	if err := json.NewDecoder(closeRR.Body).Decode(&got); err != nil {
		t.Fatalf("decode close response: %v", err)
	}
	if got.Result != "compensated" {
		t.Fatalf("expected compensated result, got %q", got.Result)
	}
	if got.Workorder.Status != "compensated" {
		t.Fatalf("expected workorder status compensated, got %q", got.Workorder.Status)
	}
}

func TestServiceAdvisorCannotEditForeignWorkorder(t *testing.T) {
	resetWorkorderStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	created := createWorkorder(t, mux, "advisor-1")

	updateReq := httptest.NewRequest(http.MethodPost, "/workorders/"+created.ID+"/status", strings.NewReader(`{"status":"in_progress"}`))
	updateReq.Header.Set("Content-Type", "application/json")
	updateReq.Header.Set("X-Role", "service_advisor")
	updateReq.Header.Set("X-User-ID", "advisor-2")
	updateRR := httptest.NewRecorder()
	mux.ServeHTTP(updateRR, updateReq)

	if updateRR.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d", updateRR.Code)
	}
}

func TestInvalidStatusTransition(t *testing.T) {
	resetWorkorderStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	created := createWorkorder(t, mux, "advisor-1")
	req := httptest.NewRequest(http.MethodPost, "/workorders/"+created.ID+"/status", strings.NewReader(`{"status":"ready"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Role", "service_advisor")
	req.Header.Set("X-User-ID", "advisor-1")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusConflict {
		t.Fatalf("expected status 409, got %d", rr.Code)
	}
}

func TestRepeatVisitAndKPI(t *testing.T) {
	resetWorkorderStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	first := createWorkorder(t, mux, "advisor-1")
	updateWorkorderStatus(t, mux, first.ID, "diagnostics", "advisor-1")
	updateWorkorderStatus(t, mux, first.ID, "in_progress", "advisor-1")
	updateWorkorderStatus(t, mux, first.ID, "ready", "advisor-1")
	updateWorkorderStatus(t, mux, first.ID, "released", "advisor-1")

	secondReq := httptest.NewRequest(http.MethodPost, "/workorders", strings.NewReader(`{"client_id":"cl-2","vehicle_vin":"VIN123"}`))
	secondReq.Header.Set("Content-Type", "application/json")
	secondReq.Header.Set("X-Role", "service_advisor")
	secondReq.Header.Set("X-User-ID", "advisor-1")
	secondRR := httptest.NewRecorder()
	mux.ServeHTTP(secondRR, secondReq)
	if secondRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", secondRR.Code)
	}

	var second workorder
	if err := json.NewDecoder(secondRR.Body).Decode(&second); err != nil {
		t.Fatalf("decode second workorder: %v", err)
	}
	if !second.RepeatVisit {
		t.Fatalf("expected repeat_visit=true, got %+v", second)
	}

	kpiReq := httptest.NewRequest(http.MethodGet, "/kpi/service", nil)
	kpiRR := httptest.NewRecorder()
	mux.ServeHTTP(kpiRR, kpiReq)
	if kpiRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", kpiRR.Code)
	}

	var payload map[string]any
	if err := json.NewDecoder(kpiRR.Body).Decode(&payload); err != nil {
		t.Fatalf("decode kpi payload: %v", err)
	}
	if payload["repeat_visit_rate_pct"] == nil {
		t.Fatalf("expected repeat_visit_rate_pct in payload, got %+v", payload)
	}
}

func TestQualityUpdate(t *testing.T) {
	resetWorkorderStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	created := createWorkorder(t, mux, "advisor-1")
	req := httptest.NewRequest(http.MethodPost, "/workorders/"+created.ID+"/quality", strings.NewReader(`{"score":5,"comment":"fixed right away"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Role", "service_advisor")
	req.Header.Set("X-User-ID", "advisor-1")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var updated workorder
	if err := json.NewDecoder(rr.Body).Decode(&updated); err != nil {
		t.Fatalf("decode updated workorder: %v", err)
	}
	if updated.QualityScore != 5 {
		t.Fatalf("expected quality_score=5, got %+v", updated)
	}
}
