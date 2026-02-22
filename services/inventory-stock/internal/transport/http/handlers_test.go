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
	if updated.Reserved != 0 {
		t.Fatalf("expected reserved 0, got %d", updated.Reserved)
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
