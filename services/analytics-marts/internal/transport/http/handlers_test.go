package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetMartsStore() {
	martsStore.Lock()
	defer martsStore.Unlock()
	martsStore.snapshotSeq = 0
	martsStore.complianceSeq = 0
	martsStore.eventSeq = 0
	martsStore.events = nil
	martsStore.compliance = nil
	martsStore.snapshots = []martSnapshot{
		{ID: "ms-00001", Domain: "sales", Revenue: 1000, Expenses: 700, MarginPct: 30, CashNet: 200},
	}
}

func TestHealthAndReady(t *testing.T) {
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	cases := []struct {
		path    string
		service string
		status  string
	}{
		{path: "/healthz", service: "analytics-marts", status: "ok"},
		{path: "/readyz", service: "analytics-marts", status: "ready"},
	}

	for _, tc := range cases {
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("%s: expected status 200, got %d", tc.path, rr.Code)
		}

		var got map[string]string
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

func TestSnapshotsAndKPI(t *testing.T) {
	resetMartsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	upsertReq := httptest.NewRequest(http.MethodPost, "/marts/snapshots", strings.NewReader(`{"domain":"service","revenue":500,"expenses":300,"cash_net":80}`))
	upsertReq.Header.Set("Content-Type", "application/json")
	upsertRR := httptest.NewRecorder()
	mux.ServeHTTP(upsertRR, upsertReq)
	if upsertRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", upsertRR.Code)
	}

	kpiReq := httptest.NewRequest(http.MethodGet, "/marts/kpi", nil)
	kpiRR := httptest.NewRecorder()
	mux.ServeHTTP(kpiRR, kpiReq)
	if kpiRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", kpiRR.Code)
	}
	var kpi map[string]any
	if err := json.NewDecoder(kpiRR.Body).Decode(&kpi); err != nil {
		t.Fatalf("decode kpi: %v", err)
	}
	if kpi["domains"] != float64(2) {
		t.Fatalf("expected domains 2, got %v", kpi["domains"])
	}
}

func TestComplianceRunStatusChange(t *testing.T) {
	resetMartsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	createReq := httptest.NewRequest(http.MethodPost, "/marts/compliance/runs", strings.NewReader(`{"kind":"tax","period":"2026-01"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRR := httptest.NewRecorder()
	mux.ServeHTTP(createRR, createReq)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", createRR.Code)
	}
	var created complianceRun
	if err := json.NewDecoder(createRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode compliance run: %v", err)
	}

	statusReq := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/marts/compliance/runs/%s/status", created.ID), strings.NewReader(`{"status":"failed"}`))
	statusReq.Header.Set("Content-Type", "application/json")
	statusRR := httptest.NewRecorder()
	mux.ServeHTTP(statusRR, statusReq)
	if statusRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", statusRR.Code)
	}
	var updated complianceRun
	if err := json.NewDecoder(statusRR.Body).Decode(&updated); err != nil {
		t.Fatalf("decode updated run: %v", err)
	}
	if updated.Status != "failed" {
		t.Fatalf("expected failed status, got %q", updated.Status)
	}
}
