package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetStockStore() {
	stockStore.Lock()
	defer stockStore.Unlock()
	stockStore.itemSeq = 0
	stockStore.movementSeq = 0
	stockStore.eventSeq = 0
	stockStore.items = nil
	stockStore.movements = nil
	stockStore.events = nil
}

func TestReserveReleaseIssueFlow(t *testing.T) {
	resetStockStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	createReq := httptest.NewRequest(http.MethodPost, "/stock", strings.NewReader(`{"sku":"sku-1","location":"main","on_hand":10,"reserved":0,"min_qty":2,"max_qty":20,"reorder_point":4}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRR := httptest.NewRecorder()
	mux.ServeHTTP(createRR, createReq)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", createRR.Code)
	}

	reserveReq := httptest.NewRequest(http.MethodPost, "/stock/reserve", strings.NewReader(`{"sku":"sku-1","location":"main","quantity":3}`))
	reserveReq.Header.Set("Content-Type", "application/json")
	reserveRR := httptest.NewRecorder()
	mux.ServeHTTP(reserveRR, reserveReq)
	if reserveRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", reserveRR.Code)
	}

	releaseReq := httptest.NewRequest(http.MethodPost, "/stock/release", strings.NewReader(`{"sku":"sku-1","location":"main","quantity":1}`))
	releaseReq.Header.Set("Content-Type", "application/json")
	releaseRR := httptest.NewRecorder()
	mux.ServeHTTP(releaseRR, releaseReq)
	if releaseRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", releaseRR.Code)
	}

	issueReq := httptest.NewRequest(http.MethodPost, "/stock/issue", strings.NewReader(`{"sku":"sku-1","location":"main","quantity":2,"source":"service"}`))
	issueReq.Header.Set("Content-Type", "application/json")
	issueRR := httptest.NewRecorder()
	mux.ServeHTTP(issueRR, issueReq)
	if issueRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", issueRR.Code)
	}

	var updated stockItem
	if err := json.NewDecoder(issueRR.Body).Decode(&updated); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if updated.OnHand != 8 {
		t.Fatalf("expected on_hand 8, got %d", updated.OnHand)
	}
	if updated.Reserved != 2 {
		t.Fatalf("expected reserved 2, got %d", updated.Reserved)
	}
}

func TestIssueDoesNotConsumeReservedStock(t *testing.T) {
	resetStockStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	createReq := httptest.NewRequest(http.MethodPost, "/stock", strings.NewReader(`{"sku":"sku-2","location":"main","on_hand":28,"reserved":5,"min_qty":2,"max_qty":40,"reorder_point":4}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRR := httptest.NewRecorder()
	mux.ServeHTTP(createRR, createReq)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", createRR.Code)
	}

	issueReq := httptest.NewRequest(http.MethodPost, "/stock/issue", strings.NewReader(`{"sku":"sku-2","location":"main","quantity":2,"source":"service-parts-usage","reference":"WO-10036"}`))
	issueReq.Header.Set("Content-Type", "application/json")
	issueRR := httptest.NewRecorder()
	mux.ServeHTTP(issueRR, issueReq)
	if issueRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", issueRR.Code)
	}

	var updated stockItem
	if err := json.NewDecoder(issueRR.Body).Decode(&updated); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if updated.OnHand != 26 {
		t.Fatalf("expected on_hand 26, got %d", updated.OnHand)
	}
	if updated.Reserved != 5 {
		t.Fatalf("expected reserved 5, got %d", updated.Reserved)
	}
}

func TestReplenishmentRecommendations(t *testing.T) {
	resetStockStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	createReq := httptest.NewRequest(http.MethodPost, "/stock", strings.NewReader(`{"sku":"sku-low","location":"main","on_hand":2,"reserved":0,"min_qty":4,"max_qty":12,"reorder_point":5}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRR := httptest.NewRecorder()
	mux.ServeHTTP(createRR, createReq)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", createRR.Code)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/stock/replenishment/recommendations", nil)
	listRR := httptest.NewRecorder()
	mux.ServeHTTP(listRR, listReq)
	if listRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", listRR.Code)
	}

	var recs []replenishmentRecommendation
	if err := json.NewDecoder(listRR.Body).Decode(&recs); err != nil {
		t.Fatalf("decode recommendations: %v", err)
	}
	if len(recs) != 1 {
		t.Fatalf("expected 1 recommendation, got %d", len(recs))
	}
	if recs[0].SKU != "SKU-LOW" {
		t.Fatalf("expected SKU-LOW, got %q", recs[0].SKU)
	}
	if recs[0].RecommendedQty <= 0 {
		t.Fatalf("expected positive recommended qty, got %d", recs[0].RecommendedQty)
	}
}

func TestResetPersistedStateRestoresSeedStock(t *testing.T) {
	resetStockStore()
	resetPersistedState()

	stockStore.RLock()
	defer stockStore.RUnlock()

	if len(stockStore.items) == 0 {
		t.Fatalf("expected seed stock items to be restored")
	}

	found := false
	for _, item := range stockStore.items {
		if item.SKU == "PART-FILTER" && item.Location == "main" {
			found = true
			if item.OnHand != 3 || item.Reserved != 1 {
				t.Fatalf("expected PART-FILTER seed stock to be restored, got %+v", item)
			}
		}
	}
	if !found {
		t.Fatalf("expected PART-FILTER seed stock item to be restored")
	}
}

func TestReplayIssueUsesRestoredSeedStock(t *testing.T) {
	resetStockStore()
	resetPersistedState()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/stock/issue", strings.NewReader(`{"sku":"PART-FILTER","source":"service-parts-usage","location":"main","quantity":2,"reference":"WO-PLAN-SMOKE-2"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected replay issue to succeed with 200, got %d: %s", rr.Code, rr.Body.String())
	}
}
