package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetProcurementStore() {
	procurementStore.Lock()
	defer procurementStore.Unlock()
	procurementStore.requestSeq = 0
	procurementStore.orderSeq = 0
	procurementStore.eventSeq = 0
	procurementStore.policies = []procurementPolicy{
		{SKU: "PART-1", MinQty: 2, MaxQty: 10, ReorderPoint: 4, PreferredSupplier: "Best Parts"},
	}
	procurementStore.requests = nil
	procurementStore.orders = nil
	procurementStore.events = nil
}

func TestCreateRequestApproveAndOrder(t *testing.T) {
	resetProcurementStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	requestReq := httptest.NewRequest(http.MethodPost, "/procurement/requests", strings.NewReader(`{"sku":"part-1","quantity":3}`))
	requestReq.Header.Set("Content-Type", "application/json")
	requestRR := httptest.NewRecorder()
	mux.ServeHTTP(requestRR, requestReq)

	if requestRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", requestRR.Code)
	}

	var created procurementRequest
	if err := json.NewDecoder(requestRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	if created.Status != "new" {
		t.Fatalf("expected status new, got %q", created.Status)
	}

	statusReq := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/procurement/requests/%s/status", created.ID), strings.NewReader(`{"status":"approved"}`))
	statusReq.Header.Set("Content-Type", "application/json")
	statusRR := httptest.NewRecorder()
	mux.ServeHTTP(statusRR, statusReq)
	if statusRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", statusRR.Code)
	}

	orderReq := httptest.NewRequest(http.MethodPost, "/purchase-orders", strings.NewReader(`{"request_id":"`+created.ID+`"}`))
	orderReq.Header.Set("Content-Type", "application/json")
	orderRR := httptest.NewRecorder()
	mux.ServeHTTP(orderRR, orderReq)

	if orderRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", orderRR.Code)
	}

	var order purchaseOrder
	if err := json.NewDecoder(orderRR.Body).Decode(&order); err != nil {
		t.Fatalf("decode order: %v", err)
	}
	if order.Status != "created" {
		t.Fatalf("expected status created, got %q", order.Status)
	}
	if order.Supplier != "Best Parts" {
		t.Fatalf("expected default supplier Best Parts, got %q", order.Supplier)
	}
}

func TestAutoReplenishmentRun(t *testing.T) {
	resetProcurementStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	runReq := httptest.NewRequest(http.MethodPost, "/procurement/replenishment/run", strings.NewReader(`{"stock_positions":[{"sku":"part-1","on_hand":1,"reserved":0}]}`))
	runReq.Header.Set("Content-Type", "application/json")
	runRR := httptest.NewRecorder()
	mux.ServeHTTP(runRR, runReq)
	if runRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", runRR.Code)
	}

	var payload struct {
		Count int `json:"count"`
	}
	if err := json.NewDecoder(runRR.Body).Decode(&payload); err != nil {
		t.Fatalf("decode run payload: %v", err)
	}
	if payload.Count != 1 {
		t.Fatalf("expected 1 created request, got %d", payload.Count)
	}
}

func TestResetPersistedStateRestoresSeedProcurementPolicies(t *testing.T) {
	procurementStore.Lock()
	procurementStore.requestSeq = 0
	procurementStore.orderSeq = 0
	procurementStore.eventSeq = 0
	procurementStore.policies = nil
	procurementStore.requests = nil
	procurementStore.orders = nil
	procurementStore.events = nil
	procurementStore.Unlock()

	resetPersistedState()

	procurementStore.RLock()
	defer procurementStore.RUnlock()

	if len(procurementStore.policies) == 0 {
		t.Fatalf("expected seed procurement policies to be restored")
	}
	if procurementStore.policies[0].SKU == "" {
		t.Fatalf("expected restored seed policy to contain SKU, got %+v", procurementStore.policies[0])
	}
}
