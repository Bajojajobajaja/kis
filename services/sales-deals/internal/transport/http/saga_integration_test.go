//go:build integration

package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSalesCloseSagaSuccessFlow(t *testing.T) {
	resetSalesDealsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	created := createDeal(t, mux, "agent-1")

	qualifyReq := httptest.NewRequest(http.MethodPost, "/deals/"+created.ID+"/stages", strings.NewReader(`{"stage":"qualified"}`))
	qualifyReq.Header.Set("Content-Type", "application/json")
	qualifyReq.Header.Set("X-Role", "sales_agent")
	qualifyReq.Header.Set("X-User-ID", "agent-1")
	qualifyRR := httptest.NewRecorder()
	mux.ServeHTTP(qualifyRR, qualifyReq)
	if qualifyRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", qualifyRR.Code)
	}

	reserveReq := httptest.NewRequest(http.MethodPost, "/deals/"+created.ID+"/reserve-vehicle", strings.NewReader(`{"vin":"VIN123"}`))
	reserveReq.Header.Set("Content-Type", "application/json")
	reserveReq.Header.Set("X-Role", "sales_agent")
	reserveReq.Header.Set("X-User-ID", "agent-1")
	reserveRR := httptest.NewRecorder()
	mux.ServeHTTP(reserveRR, reserveReq)
	if reserveRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", reserveRR.Code)
	}

	closeReq := httptest.NewRequest(http.MethodPost, "/deals/"+created.ID+"/close", strings.NewReader(`{"simulate_inventory_failure":false,"simulate_finance_failure":false}`))
	closeReq.Header.Set("Content-Type", "application/json")
	closeReq.Header.Set("X-Role", "sales_agent")
	closeReq.Header.Set("X-User-ID", "agent-1")
	closeRR := httptest.NewRecorder()
	mux.ServeHTTP(closeRR, closeReq)
	if closeRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", closeRR.Code)
	}

	var got struct {
		Result string     `json:"result"`
		Steps  []sagaStep `json:"steps"`
		Deal   deal       `json:"deal"`
	}
	if err := json.NewDecoder(closeRR.Body).Decode(&got); err != nil {
		t.Fatalf("decode close response: %v", err)
	}
	if got.Result != "completed" {
		t.Fatalf("expected completed result, got %q", got.Result)
	}
	if got.Deal.Status != "won" || got.Deal.Stage != "closed" {
		t.Fatalf("expected won/closed deal, got %+v", got.Deal)
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

	var events []dealAuditEvent
	if err := json.NewDecoder(auditRR.Body).Decode(&events); err != nil {
		t.Fatalf("decode audit events: %v", err)
	}
	if len(events) < 3 {
		t.Fatalf("expected at least 3 audit events, got %d", len(events))
	}
}

func TestSalesCloseSagaInventoryFailure(t *testing.T) {
	resetSalesDealsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	created := createDeal(t, mux, "agent-1")

	closeReq := httptest.NewRequest(http.MethodPost, "/deals/"+created.ID+"/close", strings.NewReader(`{"simulate_inventory_failure":true}`))
	closeReq.Header.Set("Content-Type", "application/json")
	closeReq.Header.Set("X-Role", "sales_agent")
	closeReq.Header.Set("X-User-ID", "agent-1")
	closeRR := httptest.NewRecorder()
	mux.ServeHTTP(closeRR, closeReq)

	if closeRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", closeRR.Code)
	}

	var got struct {
		Result string `json:"result"`
		Deal   deal   `json:"deal"`
	}
	if err := json.NewDecoder(closeRR.Body).Decode(&got); err != nil {
		t.Fatalf("decode close response: %v", err)
	}
	if got.Result != "failed" {
		t.Fatalf("expected failed result, got %q", got.Result)
	}
	if got.Deal.Status != "open" || got.Deal.Stage != "close_failed" {
		t.Fatalf("expected open/close_failed deal, got %+v", got.Deal)
	}
}
