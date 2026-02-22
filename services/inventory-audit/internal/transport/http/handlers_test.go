package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetInventoryAuditStore() {
	auditStore.Lock()
	defer auditStore.Unlock()
	auditStore.taskSeq = 0
	auditStore.lineSeq = 0
	auditStore.adjustmentSeq = 0
	auditStore.eventSeq = 0
	auditStore.tasks = nil
	auditStore.lines = nil
	auditStore.adjustments = nil
	auditStore.events = nil
}

func TestInventoryCheckVariance(t *testing.T) {
	resetInventoryAuditStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/inventory-checks", strings.NewReader(`{"warehouse":"main","sku":"oil-filter","book_qty":10,"fact_qty":7}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", rr.Code)
	}

	var got inventoryCheck
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Variance != -3 {
		t.Fatalf("expected variance -3, got %d", got.Variance)
	}
}

func TestAuditReconcileWithAutoAdjust(t *testing.T) {
	resetInventoryAuditStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	taskReq := httptest.NewRequest(http.MethodPost, "/inventory-audits", strings.NewReader(`{"warehouse":"main","scope":"cycle-count","created_by":"qa"}`))
	taskReq.Header.Set("Content-Type", "application/json")
	taskRR := httptest.NewRecorder()
	mux.ServeHTTP(taskRR, taskReq)
	if taskRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", taskRR.Code)
	}

	var task inventoryAuditTask
	if err := json.NewDecoder(taskRR.Body).Decode(&task); err != nil {
		t.Fatalf("decode task: %v", err)
	}

	countReq := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/inventory-audits/%s/counts", task.ID), strings.NewReader(`{"lines":[{"sku":"part-1","location":"A-01","book_qty":10,"fact_qty":8}]}`))
	countReq.Header.Set("Content-Type", "application/json")
	countRR := httptest.NewRecorder()
	mux.ServeHTTP(countRR, countReq)
	if countRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", countRR.Code)
	}

	reconcileReq := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/inventory-audits/%s/reconcile", task.ID), strings.NewReader(`{"auto_adjust":true,"reason":"cycle count","approved_by":"qa"}`))
	reconcileReq.Header.Set("Content-Type", "application/json")
	reconcileRR := httptest.NewRecorder()
	mux.ServeHTTP(reconcileRR, reconcileReq)
	if reconcileRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", reconcileRR.Code)
	}

	listAdjustReq := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/inventory-audits/%s/adjustments", task.ID), nil)
	listAdjustRR := httptest.NewRecorder()
	mux.ServeHTTP(listAdjustRR, listAdjustReq)
	if listAdjustRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", listAdjustRR.Code)
	}

	var adjustments []stockAdjustment
	if err := json.NewDecoder(listAdjustRR.Body).Decode(&adjustments); err != nil {
		t.Fatalf("decode adjustments: %v", err)
	}
	if len(adjustments) != 1 {
		t.Fatalf("expected 1 adjustment, got %d", len(adjustments))
	}
	if adjustments[0].Delta != -2 {
		t.Fatalf("expected delta -2, got %d", adjustments[0].Delta)
	}
}
