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

	var got reportExportResponse
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
	var exports []reportExportResponse
	if err := json.NewDecoder(exportsRR.Body).Decode(&exports); err != nil {
		t.Fatalf("decode exports: %v", err)
	}
	if len(exports) != 1 {
		t.Fatalf("expected 1 export, got %d", len(exports))
	}
}

func TestExportARAPPDFCreatesDownloadableReport(t *testing.T) {
	resetReportingStore()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/invoices":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[
				{"id":"inv-001","number":"AR-001","subject":"Vehicle Sale","party_id":"client-1","party_name":"Global Auto","kind":"ar","amount":52000,"paid_amount":0,"currency":"USD","status":"issued","created_at":"2026-03-05T10:00:00Z","updated_at":"2026-03-05T10:00:00Z"},
				{"id":"inv-002","number":"AP-001","subject":"Parts Supply","party_id":"vendor-1","party_name":"Tech Parts","kind":"ap","amount":12000,"paid_amount":0,"currency":"USD","status":"issued","created_at":"2026-03-12T12:00:00Z","updated_at":"2026-03-12T12:00:00Z"},
				{"id":"inv-003","number":"AR-OLD","subject":"Historic Invoice","party_id":"client-2","party_name":"Fleet Co","kind":"ar","amount":7000,"paid_amount":0,"currency":"USD","status":"issued","created_at":"2026-02-20T09:00:00Z","updated_at":"2026-02-20T09:00:00Z"}
			]`))
		case "/payments":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[
				{"id":"pay-001","invoice_id":"inv-001","amount":5000,"method":"wire","paid_at":"2026-03-08T08:30:00Z","created_at":"2026-03-08T08:30:00Z"},
				{"id":"pay-002","invoice_id":"inv-002","amount":3000,"method":"wire","paid_at":"2026-03-16T09:15:00Z","created_at":"2026-03-16T09:15:00Z"},
				{"id":"pay-003","invoice_id":"inv-003","amount":2500,"method":"cash","paid_at":"2026-03-02T11:45:00Z","created_at":"2026-03-02T11:45:00Z"}
			]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	t.Setenv("FINANCE_INVOICING_BASE_URL", upstream.URL)

	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(
		http.MethodPost,
		"/reports/export",
		strings.NewReader(`{"report":"ar-ap","format":"pdf","period":"03.2026","owner":"Finance Manager"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d: %s", rr.Code, rr.Body.String())
	}

	var export reportExportResponse
	if err := json.NewDecoder(rr.Body).Decode(&export); err != nil {
		t.Fatalf("decode export response: %v", err)
	}

	if export.DownloadURL == "" {
		t.Fatalf("expected download url to be set")
	}
	if export.FileName == "" {
		t.Fatalf("expected file name to be set")
	}
	if export.Summary == nil {
		t.Fatalf("expected summary to be set")
	}
	if export.Summary.IncomingIssuedTotal != 52000 {
		t.Fatalf("expected incoming issued total 52000, got %v", export.Summary.IncomingIssuedTotal)
	}
	if export.Summary.OutgoingIssuedTotal != 12000 {
		t.Fatalf("expected outgoing issued total 12000, got %v", export.Summary.OutgoingIssuedTotal)
	}
	if export.Summary.IncomingPaidTotal != 7500 {
		t.Fatalf("expected incoming paid total 7500, got %v", export.Summary.IncomingPaidTotal)
	}
	if export.Summary.OutgoingPaidTotal != 3000 {
		t.Fatalf("expected outgoing paid total 3000, got %v", export.Summary.OutgoingPaidTotal)
	}
	if export.Summary.ReconciledPaymentsTotal != 10500 {
		t.Fatalf("expected reconciled payments total 10500, got %v", export.Summary.ReconciledPaymentsTotal)
	}
}

func TestExportDownloadReturnsPDF(t *testing.T) {
	resetReportingStore()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/invoices":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[
				{"id":"inv-001","number":"AR-001","subject":"Vehicle Sale","party_id":"client-1","party_name":"Global Auto","kind":"ar","amount":52000,"paid_amount":0,"currency":"USD","status":"issued","created_at":"2026-03-05T10:00:00Z","updated_at":"2026-03-05T10:00:00Z"}
			]`))
		case "/payments":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[
				{"id":"pay-001","invoice_id":"inv-001","amount":5000,"method":"wire","paid_at":"2026-03-08T08:30:00Z","created_at":"2026-03-08T08:30:00Z"}
			]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	t.Setenv("FINANCE_INVOICING_BASE_URL", upstream.URL)

	mux := http.NewServeMux()
	RegisterHandlers(mux)

	createReq := httptest.NewRequest(
		http.MethodPost,
		"/reports/export",
		strings.NewReader(`{"report":"ar-ap","format":"pdf","period":"03.2026"}`),
	)
	createReq.Header.Set("Content-Type", "application/json")
	createRR := httptest.NewRecorder()
	mux.ServeHTTP(createRR, createReq)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d: %s", createRR.Code, createRR.Body.String())
	}

	var export reportExportResponse
	if err := json.NewDecoder(createRR.Body).Decode(&export); err != nil {
		t.Fatalf("decode export response: %v", err)
	}

	downloadReq := httptest.NewRequest(http.MethodGet, export.DownloadURL, nil)
	downloadRR := httptest.NewRecorder()
	mux.ServeHTTP(downloadRR, downloadReq)

	if downloadRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", downloadRR.Code, downloadRR.Body.String())
	}
	if got := downloadRR.Header().Get("Content-Type"); got != "application/pdf" {
		t.Fatalf("expected application/pdf content type, got %q", got)
	}
	if !strings.Contains(downloadRR.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatalf("expected attachment disposition, got %q", downloadRR.Header().Get("Content-Disposition"))
	}
	if downloadRR.Body.Len() == 0 {
		t.Fatalf("expected non-empty pdf body")
	}
}

func TestExportARAPPDFRejectsInvalidPeriod(t *testing.T) {
	resetReportingStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(
		http.MethodPost,
		"/reports/export",
		strings.NewReader(`{"report":"ar-ap","format":"pdf","period":"2026-03"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rr.Code)
	}
}

func TestDevResetHandler(t *testing.T) {
	t.Run("disabled", func(t *testing.T) {
		t.Setenv(financeReportingDevSeedEnvKey, "false")
		resetReportingStore()
		mux := http.NewServeMux()
		RegisterHandlers(mux)

		req := httptest.NewRequest(http.MethodPost, "/dev/reset", strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, req)

		if rr.Code != http.StatusForbidden {
			t.Fatalf("expected status 403, got %d", rr.Code)
		}
	})

	t.Run("enabled", func(t *testing.T) {
		t.Setenv(financeReportingDevSeedEnvKey, "true")
		resetReportingStore()
		mux := http.NewServeMux()
		RegisterHandlers(mux)

		createExportReq := httptest.NewRequest(http.MethodPost, "/reports/export", strings.NewReader(`{"report":"pnl"}`))
		createExportReq.Header.Set("Content-Type", "application/json")
		createExportRR := httptest.NewRecorder()
		mux.ServeHTTP(createExportRR, createExportReq)
		if createExportRR.Code != http.StatusCreated {
			t.Fatalf("expected status 201, got %d", createExportRR.Code)
		}

		createScheduleReq := httptest.NewRequest(http.MethodPost, "/reports/schedules", strings.NewReader(`{"report":"pnl"}`))
		createScheduleReq.Header.Set("Content-Type", "application/json")
		createScheduleRR := httptest.NewRecorder()
		mux.ServeHTTP(createScheduleRR, createScheduleReq)
		if createScheduleRR.Code != http.StatusCreated {
			t.Fatalf("expected status 201, got %d", createScheduleRR.Code)
		}

		resetReq := httptest.NewRequest(http.MethodPost, "/dev/reset", strings.NewReader(`{}`))
		resetReq.Header.Set("Content-Type", "application/json")
		resetRR := httptest.NewRecorder()
		mux.ServeHTTP(resetRR, resetReq)
		if resetRR.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d: %s", resetRR.Code, resetRR.Body.String())
		}

		exportsReq := httptest.NewRequest(http.MethodGet, "/reports/exports", nil)
		exportsRR := httptest.NewRecorder()
		mux.ServeHTTP(exportsRR, exportsReq)
		if exportsRR.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", exportsRR.Code)
		}
		var exports []reportExportResponse
		if err := json.NewDecoder(exportsRR.Body).Decode(&exports); err != nil {
			t.Fatalf("decode exports: %v", err)
		}
		if len(exports) != 0 {
			t.Fatalf("expected 0 exports after reset, got %d", len(exports))
		}

		schedulesReq := httptest.NewRequest(http.MethodGet, "/reports/schedules", nil)
		schedulesRR := httptest.NewRecorder()
		mux.ServeHTTP(schedulesRR, schedulesReq)
		if schedulesRR.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", schedulesRR.Code)
		}
		var schedules []reportSchedule
		if err := json.NewDecoder(schedulesRR.Body).Decode(&schedules); err != nil {
			t.Fatalf("decode schedules: %v", err)
		}
		if len(schedules) != 0 {
			t.Fatalf("expected 0 schedules after reset, got %d", len(schedules))
		}
	})
}
