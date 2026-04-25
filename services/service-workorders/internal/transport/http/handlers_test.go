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
	req := httptest.NewRequest(http.MethodPost, "/workorders/"+created.ID+"/status", strings.NewReader(`{"status":"released"}`))
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

func TestUpsertWorkorderUsesExplicitIDAndSupportsGet(t *testing.T) {
	resetWorkorderStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	putReq := httptest.NewRequest(http.MethodPut, "/workorders/WO-10031", strings.NewReader(`{"client_name":"Fleet client","vehicle_vin":"VIN-10031","assignee":"USR-4004","status":"opened"}`))
	putReq.Header.Set("Content-Type", "application/json")
	putReq.Header.Set("X-Role", "service_manager")
	putReq.Header.Set("X-User-ID", "manager-1")
	putRR := httptest.NewRecorder()
	mux.ServeHTTP(putRR, putReq)

	if putRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", putRR.Code)
	}

	var created workorder
	if err := json.NewDecoder(putRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode created workorder: %v", err)
	}
	if created.ID != "WO-10031" {
		t.Fatalf("expected explicit id WO-10031, got %+v", created)
	}
	if created.Status != "accepted" {
		t.Fatalf("expected opened to normalize to accepted, got %+v", created)
	}
	if created.ClientName != "Fleet client" {
		t.Fatalf("expected client name to be stored, got %+v", created)
	}

	getReq := httptest.NewRequest(http.MethodGet, "/workorders/WO-10031", nil)
	getReq.Header.Set("X-Role", "service_manager")
	getReq.Header.Set("X-User-ID", "manager-1")
	getRR := httptest.NewRecorder()
	mux.ServeHTTP(getRR, getReq)

	if getRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", getRR.Code)
	}
}

func TestUpsertExistingWorkorderUpdatesStatus(t *testing.T) {
	resetWorkorderStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	firstReq := httptest.NewRequest(http.MethodPut, "/workorders/WO-10032", strings.NewReader(`{"client_name":"Retail","vehicle_vin":"VIN-10032","status":"opened"}`))
	firstReq.Header.Set("Content-Type", "application/json")
	firstReq.Header.Set("X-Role", "service_manager")
	firstReq.Header.Set("X-User-ID", "manager-1")
	firstRR := httptest.NewRecorder()
	mux.ServeHTTP(firstRR, firstReq)
	if firstRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", firstRR.Code)
	}

	secondReq := httptest.NewRequest(http.MethodPut, "/workorders/WO-10032", strings.NewReader(`{"client_name":"Retail","vehicle_vin":"VIN-10032","status":"waiting_parts"}`))
	secondReq.Header.Set("Content-Type", "application/json")
	secondReq.Header.Set("X-Role", "service_manager")
	secondReq.Header.Set("X-User-ID", "manager-1")
	secondRR := httptest.NewRecorder()
	mux.ServeHTTP(secondRR, secondReq)

	if secondRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", secondRR.Code)
	}

	var updated workorder
	if err := json.NewDecoder(secondRR.Body).Decode(&updated); err != nil {
		t.Fatalf("decode updated workorder: %v", err)
	}
	if updated.Status != "waiting_parts" {
		t.Fatalf("expected waiting_parts, got %+v", updated)
	}
}

func TestReplayUpsertBypassesRoleCheck(t *testing.T) {
	resetWorkorderStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPut, "/workorders/WO-REPLAY-1", strings.NewReader(`{"client_name":"Replay client","vehicle_vin":"VIN-REPLAY-1","status":"opened"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-KIS-Replay", "1")
	req.Header.Set("X-User-ID", "web-ui")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected replay upsert to succeed with 201, got %d", rr.Code)
	}
}

func TestReplayUpsertAcceptsFirstJournalPayload(t *testing.T) {
	resetWorkorderStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPut, "/workorders/WO-10031", strings.NewReader(`{"status":"opened","assignee":"USR-4004","deadline":"2026-03-02T12:00:00Z","client_id":"","client_name":"ООО АВТОПАРК","vehicle_vin":"XW7BF4FK30S123456"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-KIS-Replay", "1")
	req.Header.Set("X-User-ID", "web-ui")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected first journal replay payload to succeed with 201, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestReadyWorkorderCanReturnToWaitingParts(t *testing.T) {
	resetWorkorderStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	created := createWorkorder(t, mux, "advisor-1")
	updateWorkorderStatus(t, mux, created.ID, "diagnostics", "advisor-1")
	updateWorkorderStatus(t, mux, created.ID, "in_progress", "advisor-1")
	updateWorkorderStatus(t, mux, created.ID, "ready", "advisor-1")

	req := httptest.NewRequest(http.MethodPost, "/workorders/"+created.ID+"/status", strings.NewReader(`{"status":"waiting_parts"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Role", "service_advisor")
	req.Header.Set("X-User-ID", "advisor-1")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected ready->waiting_parts transition to succeed, got %d", rr.Code)
	}
}
