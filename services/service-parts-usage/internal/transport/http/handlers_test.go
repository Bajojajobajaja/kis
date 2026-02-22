package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetPartsStore() {
	partsStore.Lock()
	defer partsStore.Unlock()
	partsStore.seq = 0
	partsStore.procurementSeq = 0
	partsStore.eventSeq = 0
	partsStore.usages = nil
	partsStore.procurements = nil
	partsStore.events = nil
	partsStore.stockByPartCode = map[string]partStock{
		"P-1":         {PartCode: "P-1", Available: 10, Reserved: 0, Consumed: 0, ReorderPoint: 3},
		"PART-OIL":    {PartCode: "PART-OIL", Available: 4, Reserved: 0, Consumed: 0, ReorderPoint: 2},
		"PART-FILTER": {PartCode: "PART-FILTER", Available: 1, Reserved: 0, Consumed: 0, ReorderPoint: 2},
	}
}

func TestWorkorderPartsCreateAndList(t *testing.T) {
	resetPartsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	createReq := httptest.NewRequest(http.MethodPost, "/workorders/wo-1/parts", strings.NewReader(`{"part_code":"P-1","quantity":2}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRR := httptest.NewRecorder()
	mux.ServeHTTP(createRR, createReq)

	if createRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", createRR.Code)
	}

	var created map[string]any
	if err := json.NewDecoder(createRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode created payload: %v", err)
	}
	usage, ok := created["usage"].(map[string]any)
	if !ok {
		t.Fatalf("expected usage object in response, got %+v", created)
	}
	if usage["action"] != "reserve" {
		t.Fatalf("expected default action reserve, got %v", usage["action"])
	}

	listReq := httptest.NewRequest(http.MethodGet, "/workorders/wo-1/parts", nil)
	listRR := httptest.NewRecorder()
	mux.ServeHTTP(listRR, listReq)

	if listRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", listRR.Code)
	}

	var usages []partsUsage
	if err := json.NewDecoder(listRR.Body).Decode(&usages); err != nil {
		t.Fatalf("decode usages: %v", err)
	}
	if len(usages) != 1 {
		t.Fatalf("expected 1 usage, got %d", len(usages))
	}
}

func TestShortageCreatesProcurementRequest(t *testing.T) {
	resetPartsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	shortReq := httptest.NewRequest(http.MethodPost, "/workorders/wo-2/parts", strings.NewReader(`{"part_code":"PART-FILTER","quantity":5,"action":"reserve"}`))
	shortReq.Header.Set("Content-Type", "application/json")
	shortRR := httptest.NewRecorder()
	mux.ServeHTTP(shortRR, shortReq)
	if shortRR.Code != http.StatusConflict {
		t.Fatalf("expected status 409, got %d", shortRR.Code)
	}

	reqList := httptest.NewRequest(http.MethodGet, "/procurement/requests", nil)
	rrList := httptest.NewRecorder()
	mux.ServeHTTP(rrList, reqList)
	if rrList.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rrList.Code)
	}

	var requests []procurementRequest
	if err := json.NewDecoder(rrList.Body).Decode(&requests); err != nil {
		t.Fatalf("decode procurement requests: %v", err)
	}
	if len(requests) != 1 {
		t.Fatalf("expected 1 procurement request, got %d", len(requests))
	}
}
