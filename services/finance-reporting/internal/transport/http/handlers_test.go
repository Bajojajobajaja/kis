package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetReportingStore() {
	reportingStore.Lock()
	defer reportingStore.Unlock()
	reportingStore.exportSeq = 0
	reportingStore.scheduleSeq = 0
	reportingStore.eventSeq = 0
	reportingStore.exports = nil
	reportingStore.schedules = nil
	reportingStore.events = nil
	reportingStore.metrics = map[string]reportingMetric{
		"sales": {Domain: "sales", Revenue: 1000, Expenses: 500, Cost: 300, Inflow: 700, Outflow: 400, AROpen: 50, APOpen: 20},
	}
}

func TestReportsCashflow(t *testing.T) {
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodGet, "/reports?type=cashflow", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var payload map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode report: %v", err)
	}
	if payload["type"] != "cashflow" {
		t.Fatalf("expected report type cashflow, got %v", payload["type"])
	}
}

func TestExportDefaultsFormat(t *testing.T) {
	resetReportingStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/reports/export", strings.NewReader(`{"report":"pnl"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", rr.Code)
	}

	var got reportExport
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode export response: %v", err)
	}
	if got.Format != "xlsx" {
		t.Fatalf("expected default format xlsx, got %q", got.Format)
	}
}

func TestScheduleRunCreatesExport(t *testing.T) {
	resetReportingStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	createReq := httptest.NewRequest(http.MethodPost, "/reports/schedules", strings.NewReader(`{"name":"Daily PnL","report":"pnl","format":"csv","cron":"0 8 * * *"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRR := httptest.NewRecorder()
	mux.ServeHTTP(createRR, createReq)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", createRR.Code)
	}

	var schedule reportSchedule
	if err := json.NewDecoder(createRR.Body).Decode(&schedule); err != nil {
		t.Fatalf("decode schedule: %v", err)
	}

	runReq := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/reports/schedules/%s/run", schedule.ID), nil)
	runRR := httptest.NewRecorder()
	mux.ServeHTTP(runRR, runReq)
	if runRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", runRR.Code)
	}

	exportsReq := httptest.NewRequest(http.MethodGet, "/reports/exports", nil)
	exportsRR := httptest.NewRecorder()
	mux.ServeHTTP(exportsRR, exportsReq)
	if exportsRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", exportsRR.Code)
	}
	var exports []reportExport
	if err := json.NewDecoder(exportsRR.Body).Decode(&exports); err != nil {
		t.Fatalf("decode exports: %v", err)
	}
	if len(exports) != 1 {
		t.Fatalf("expected 1 export, got %d", len(exports))
	}
}
