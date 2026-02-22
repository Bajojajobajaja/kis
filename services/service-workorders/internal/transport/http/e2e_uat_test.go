//go:build e2e

package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServiceE2EUATRoles(t *testing.T) {
	resetWorkorderStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	createReq := httptest.NewRequest(http.MethodPost, "/workorders", strings.NewReader(`{"client_id":"cl-1","owner_id":"advisor-1","vehicle_vin":"VIN-UAT-WO"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createReq.Header.Set("X-Role", "service_manager")
	createReq.Header.Set("X-User-ID", "manager-1")
	createRR := httptest.NewRecorder()
	mux.ServeHTTP(createRR, createReq)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", createRR.Code)
	}

	var created workorder
	if err := json.NewDecoder(createRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode created workorder: %v", err)
	}

	ownListReq := httptest.NewRequest(http.MethodGet, "/workorders", nil)
	ownListReq.Header.Set("X-Role", "service_advisor")
	ownListReq.Header.Set("X-User-ID", "advisor-1")
	ownListRR := httptest.NewRecorder()
	mux.ServeHTTP(ownListRR, ownListReq)
	if ownListRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", ownListRR.Code)
	}

	var ownWorkorders []workorder
	if err := json.NewDecoder(ownListRR.Body).Decode(&ownWorkorders); err != nil {
		t.Fatalf("decode own workorders: %v", err)
	}
	if len(ownWorkorders) != 1 || ownWorkorders[0].ID != created.ID {
		t.Fatalf("expected one own workorder %q, got %+v", created.ID, ownWorkorders)
	}

	foreignUpdateReq := httptest.NewRequest(http.MethodPost, "/workorders/"+created.ID+"/status", strings.NewReader(`{"status":"in_progress"}`))
	foreignUpdateReq.Header.Set("Content-Type", "application/json")
	foreignUpdateReq.Header.Set("X-Role", "service_advisor")
	foreignUpdateReq.Header.Set("X-User-ID", "advisor-2")
	foreignUpdateRR := httptest.NewRecorder()
	mux.ServeHTTP(foreignUpdateRR, foreignUpdateReq)
	if foreignUpdateRR.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d", foreignUpdateRR.Code)
	}

	ownerUpdateReq := httptest.NewRequest(http.MethodPost, "/workorders/"+created.ID+"/status", strings.NewReader(`{"status":"in_progress"}`))
	ownerUpdateReq.Header.Set("Content-Type", "application/json")
	ownerUpdateReq.Header.Set("X-Role", "service_advisor")
	ownerUpdateReq.Header.Set("X-User-ID", "advisor-1")
	ownerUpdateRR := httptest.NewRecorder()
	mux.ServeHTTP(ownerUpdateRR, ownerUpdateReq)
	if ownerUpdateRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", ownerUpdateRR.Code)
	}

	readyReq := httptest.NewRequest(http.MethodPost, "/workorders/"+created.ID+"/status", strings.NewReader(`{"status":"ready"}`))
	readyReq.Header.Set("Content-Type", "application/json")
	readyReq.Header.Set("X-Role", "service_advisor")
	readyReq.Header.Set("X-User-ID", "advisor-1")
	readyRR := httptest.NewRecorder()
	mux.ServeHTTP(readyRR, readyReq)
	if readyRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", readyRR.Code)
	}

	closeReq := httptest.NewRequest(http.MethodPost, "/workorders/"+created.ID+"/close", strings.NewReader(`{"simulate_parts_failure":false,"simulate_billing_failure":false}`))
	closeReq.Header.Set("Content-Type", "application/json")
	closeReq.Header.Set("X-Role", "service_manager")
	closeReq.Header.Set("X-User-ID", "manager-1")
	closeRR := httptest.NewRecorder()
	mux.ServeHTTP(closeRR, closeReq)
	if closeRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", closeRR.Code)
	}

	var closeResp struct {
		Result    string    `json:"result"`
		Workorder workorder `json:"workorder"`
	}
	if err := json.NewDecoder(closeRR.Body).Decode(&closeResp); err != nil {
		t.Fatalf("decode close response: %v", err)
	}
	if closeResp.Result != "completed" {
		t.Fatalf("expected completed result, got %q", closeResp.Result)
	}
	if closeResp.Workorder.Status != "closed" {
		t.Fatalf("expected closed status, got %q", closeResp.Workorder.Status)
	}
}
