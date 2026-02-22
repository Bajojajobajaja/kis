package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetCostingStore() {
	costingStore.Lock()
	defer costingStore.Unlock()
	costingStore.seq = 0
	costingStore.modelSeq = 0
	costingStore.eventSeq = 0
	costingStore.history = nil
	costingStore.events = nil
	costingStore.models = []costingModel{
		{ID: "cm-0001", Domain: "sales", OverheadRatePct: 5, LogisticsRatePct: 2},
		{ID: "cm-0002", Domain: "service", OverheadRatePct: 7, LogisticsRatePct: 1},
	}
}

func TestCostingHandlerCalculatesMargin(t *testing.T) {
	resetCostingStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/costing/calc", strings.NewReader(`{"source_id":"dl-1","domain":"sales","revenue":2000,"quantity":2,"materials_cost":900,"labor_cost":100,"use_model_rates":true}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var got costingResult
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if got.TotalCost <= 1000 {
		t.Fatalf("expected total_cost > 1000 with model rates, got %v", got.TotalCost)
	}
	if got.Margin >= 1000 {
		t.Fatalf("expected margin < 1000, got %v", got.Margin)
	}
	if got.UnitCost <= 0 {
		t.Fatalf("expected positive unit_cost, got %v", got.UnitCost)
	}
}

func TestCostingSummary(t *testing.T) {
	resetCostingStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	payloads := []string{
		`{"source_id":"sale-1","domain":"sales","revenue":1000,"materials_cost":400,"labor_cost":100}`,
		`{"source_id":"svc-1","domain":"service","revenue":500,"materials_cost":100,"labor_cost":150}`,
	}
	for _, payload := range payloads {
		req := httptest.NewRequest(http.MethodPost, "/costing/calc", strings.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", rr.Code)
		}
	}

	summaryReq := httptest.NewRequest(http.MethodGet, "/costing/summary", nil)
	summaryRR := httptest.NewRecorder()
	mux.ServeHTTP(summaryRR, summaryReq)
	if summaryRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", summaryRR.Code)
	}
	var summary map[string]any
	if err := json.NewDecoder(summaryRR.Body).Decode(&summary); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	if summary["count"] != float64(2) {
		t.Fatalf("expected count 2, got %v", summary["count"])
	}
}

func TestCostingHandlerRejectsNegativeValues(t *testing.T) {
	resetCostingStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/costing/calc", strings.NewReader(`{"domain":"sales","revenue":100,"materials_cost":-1,"labor_cost":0}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rr.Code)
	}
}
