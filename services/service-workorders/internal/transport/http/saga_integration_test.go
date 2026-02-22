//go:build integration

package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWorkorderCloseSagaSuccessFlow(t *testing.T) {
	resetWorkorderStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	created := createWorkorder(t, mux, "advisor-1")

	statusReq := httptest.NewRequest(http.MethodPost, "/workorders/"+created.ID+"/status", strings.NewReader(`{"status":"in_progress"}`))
	statusReq.Header.Set("Content-Type", "application/json")
	statusReq.Header.Set("X-Role", "service_advisor")
	statusReq.Header.Set("X-User-ID", "advisor-1")
	statusRR := httptest.NewRecorder()
	mux.ServeHTTP(statusRR, statusReq)
	if statusRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", statusRR.Code)
	}

	closeReq := httptest.NewRequest(http.MethodPost, "/workorders/"+created.ID+"/close", strings.NewReader(`{"simulate_parts_failure":false,"simulate_billing_failure":false}`))
	closeReq.Header.Set("Content-Type", "application/json")
	closeReq.Header.Set("X-Role", "service_advisor")
	closeReq.Header.Set("X-User-ID", "advisor-1")
	closeRR := httptest.NewRecorder()
	mux.ServeHTTP(closeRR, closeReq)
	if closeRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", closeRR.Code)
	}

	var got struct {
		Result    string              `json:"result"`
		Steps     []workorderSagaStep `json:"steps"`
		Workorder workorder           `json:"workorder"`
	}
	if err := json.NewDecoder(closeRR.Body).Decode(&got); err != nil {
		t.Fatalf("decode close response: %v", err)
	}
	if got.Result != "completed" {
		t.Fatalf("expected completed result, got %q", got.Result)
	}
	if got.Workorder.Status != "closed" {
		t.Fatalf("expected status closed, got %q", got.Workorder.Status)
	}
	if len(got.Steps) != 3 {
		t.Fatalf("expected 3 saga steps, got %d", len(got.Steps))
	}

	auditReq := httptest.NewRequest(http.MethodGet, "/audit/trail", nil)
	auditRR := httptest.NewRecorder()
	mux.ServeHTTP(auditRR, auditReq)
	if auditRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", auditRR.Code)
	}

	var events []workorderAuditEvent
	if err := json.NewDecoder(auditRR.Body).Decode(&events); err != nil {
		t.Fatalf("decode audit events: %v", err)
	}
	if len(events) < 3 {
		t.Fatalf("expected at least 3 audit events, got %d", len(events))
	}
}

func TestWorkorderCloseSagaPartsFailure(t *testing.T) {
	resetWorkorderStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	created := createWorkorder(t, mux, "advisor-1")

	closeReq := httptest.NewRequest(http.MethodPost, "/workorders/"+created.ID+"/close", strings.NewReader(`{"simulate_parts_failure":true}`))
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
	if got.Result != "failed" {
		t.Fatalf("expected failed result, got %q", got.Result)
	}
	if got.Workorder.Status != "close_failed" {
		t.Fatalf("expected status close_failed, got %q", got.Workorder.Status)
	}
}
