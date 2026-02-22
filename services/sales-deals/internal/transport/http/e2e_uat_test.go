//go:build e2e

package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSalesE2EUATRoles(t *testing.T) {
	resetSalesDealsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	createReq := httptest.NewRequest(http.MethodPost, "/deals", strings.NewReader(`{"client_id":"cl-1","owner_id":"agent-1","vehicle_vin":"VIN-UAT","amount":50000}`))
	createReq.Header.Set("Content-Type", "application/json")
	createReq.Header.Set("X-Role", "sales_manager")
	createReq.Header.Set("X-User-ID", "manager-1")
	createRR := httptest.NewRecorder()
	mux.ServeHTTP(createRR, createReq)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", createRR.Code)
	}

	var created deal
	if err := json.NewDecoder(createRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode created deal: %v", err)
	}

	ownListReq := httptest.NewRequest(http.MethodGet, "/deals", nil)
	ownListReq.Header.Set("X-Role", "sales_agent")
	ownListReq.Header.Set("X-User-ID", "agent-1")
	ownListRR := httptest.NewRecorder()
	mux.ServeHTTP(ownListRR, ownListReq)
	if ownListRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", ownListRR.Code)
	}

	var ownDeals []deal
	if err := json.NewDecoder(ownListRR.Body).Decode(&ownDeals); err != nil {
		t.Fatalf("decode own deals: %v", err)
	}
	if len(ownDeals) != 1 || ownDeals[0].ID != created.ID {
		t.Fatalf("expected one own deal %q, got %+v", created.ID, ownDeals)
	}

	foreignUpdateReq := httptest.NewRequest(http.MethodPost, "/deals/"+created.ID+"/stages", strings.NewReader(`{"stage":"won"}`))
	foreignUpdateReq.Header.Set("Content-Type", "application/json")
	foreignUpdateReq.Header.Set("X-Role", "sales_agent")
	foreignUpdateReq.Header.Set("X-User-ID", "agent-2")
	foreignUpdateRR := httptest.NewRecorder()
	mux.ServeHTTP(foreignUpdateRR, foreignUpdateReq)
	if foreignUpdateRR.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d", foreignUpdateRR.Code)
	}

	qualifyReq := httptest.NewRequest(http.MethodPost, "/deals/"+created.ID+"/stages", strings.NewReader(`{"stage":"qualified"}`))
	qualifyReq.Header.Set("Content-Type", "application/json")
	qualifyReq.Header.Set("X-Role", "sales_agent")
	qualifyReq.Header.Set("X-User-ID", "agent-1")
	qualifyRR := httptest.NewRecorder()
	mux.ServeHTTP(qualifyRR, qualifyReq)
	if qualifyRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", qualifyRR.Code)
	}

	reserveReq := httptest.NewRequest(http.MethodPost, "/deals/"+created.ID+"/reserve-vehicle", strings.NewReader(`{"vin":"VIN-UAT"}`))
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
	closeReq.Header.Set("X-Role", "sales_manager")
	closeReq.Header.Set("X-User-ID", "manager-1")
	closeRR := httptest.NewRecorder()
	mux.ServeHTTP(closeRR, closeReq)
	if closeRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", closeRR.Code)
	}

	var closeResp struct {
		Result string `json:"result"`
		Deal   deal   `json:"deal"`
	}
	if err := json.NewDecoder(closeRR.Body).Decode(&closeResp); err != nil {
		t.Fatalf("decode close response: %v", err)
	}
	if closeResp.Result != "completed" {
		t.Fatalf("expected completed result, got %q", closeResp.Result)
	}
	if closeResp.Deal.Status != "won" {
		t.Fatalf("expected won status, got %q", closeResp.Deal.Status)
	}
}
