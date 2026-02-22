package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetDiagnosticsStore() {
	diagnosticsStore.Lock()
	defer diagnosticsStore.Unlock()
	diagnosticsStore.seq = 0
	diagnosticsStore.eventSeq = 0
	diagnosticsStore.diagnostics = nil
	diagnosticsStore.events = nil
	diagnosticsStore.warrantyData = map[string]warrantyStatus{
		"VIN-UAT-WO": {VehicleVIN: "VIN-UAT-WO", Active: true, Provider: "OEM", ValidUntil: "2027-12-31T00:00:00Z"},
		"VIN123":     {VehicleVIN: "VIN123", Active: false},
	}
}

func TestDiagnosticsValidation(t *testing.T) {
	resetDiagnosticsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/diagnostics", strings.NewReader(`{"faults":["f1"]}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rr.Code)
	}
}

func TestCreateDiagnosticsAndFilter(t *testing.T) {
	resetDiagnosticsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	createReq := httptest.NewRequest(http.MethodPost, "/diagnostics", strings.NewReader(`{
		"workorder_id":"wo-1",
		"vehicle_vin":"vin123",
		"faults":["f1","f2"],
		"recommendations":["replace part"],
		"severity":"high"
	}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRR := httptest.NewRecorder()
	mux.ServeHTTP(createRR, createReq)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", createRR.Code)
	}

	filterReq := httptest.NewRequest(http.MethodGet, "/diagnostics?workorder_id=wo-1&severity=high", nil)
	filterRR := httptest.NewRecorder()
	mux.ServeHTTP(filterRR, filterReq)
	if filterRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", filterRR.Code)
	}

	var payload []diagnostic
	if err := json.NewDecoder(filterRR.Body).Decode(&payload); err != nil {
		t.Fatalf("decode diagnostics payload: %v", err)
	}
	if len(payload) != 1 {
		t.Fatalf("expected 1 diagnostic, got %d", len(payload))
	}
	if payload[0].VehicleVIN != "VIN123" {
		t.Fatalf("expected normalized VIN123, got %q", payload[0].VehicleVIN)
	}

	eventsReq := httptest.NewRequest(http.MethodGet, "/events", nil)
	eventsRR := httptest.NewRecorder()
	mux.ServeHTTP(eventsRR, eventsReq)
	if eventsRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", eventsRR.Code)
	}
}

func TestWarrantyCheck(t *testing.T) {
	resetDiagnosticsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodGet, "/warranty/check?vin=VIN-UAT-WO", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var payload warrantyStatus
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode warranty payload: %v", err)
	}
	if !payload.Active {
		t.Fatalf("expected active warranty, got %+v", payload)
	}
}
