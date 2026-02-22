package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetReceivingStore() {
	receivingStore.Lock()
	defer receivingStore.Unlock()
	receivingStore.receiptSeq = 0
	receivingStore.lineSeq = 0
	receivingStore.discrepancySeq = 0
	receivingStore.taskSeq = 0
	receivingStore.eventSeq = 0
	receivingStore.receipts = nil
	receivingStore.discrepancies = nil
	receivingStore.tasks = nil
	receivingStore.events = nil
}

func TestReceiptLifecycleWithPutawayTask(t *testing.T) {
	resetReceivingStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	receiptReq := httptest.NewRequest(http.MethodPost, "/receipts", strings.NewReader(`{"purchase_order":"po-1","warehouse":"main"}`))
	receiptReq.Header.Set("Content-Type", "application/json")
	receiptRR := httptest.NewRecorder()
	mux.ServeHTTP(receiptRR, receiptReq)

	if receiptRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", receiptRR.Code)
	}

	var created receipt
	if err := json.NewDecoder(receiptRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode receipt: %v", err)
	}

	linesReq := httptest.NewRequest(http.MethodPost, "/receipts/"+created.ID+"/lines", strings.NewReader(`{"lines":[{"sku":"part-1","expected_qty":5,"received_qty":5,"accepted_qty":5,"location":"A-01"}]}`))
	linesReq.Header.Set("Content-Type", "application/json")
	linesRR := httptest.NewRecorder()
	mux.ServeHTTP(linesRR, linesReq)
	if linesRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", linesRR.Code)
	}

	receivedReq := httptest.NewRequest(http.MethodPost, "/receipts/"+created.ID+"/status", strings.NewReader(`{"status":"received"}`))
	receivedReq.Header.Set("Content-Type", "application/json")
	receivedRR := httptest.NewRecorder()
	mux.ServeHTTP(receivedRR, receivedReq)
	if receivedRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", receivedRR.Code)
	}

	putawayReq := httptest.NewRequest(http.MethodPost, "/receipts/"+created.ID+"/status", strings.NewReader(`{"status":"putaway"}`))
	putawayReq.Header.Set("Content-Type", "application/json")
	putawayRR := httptest.NewRecorder()
	mux.ServeHTTP(putawayRR, putawayReq)
	if putawayRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", putawayRR.Code)
	}

	tasksReq := httptest.NewRequest(http.MethodGet, "/warehouse/tasks?reference="+created.ID, nil)
	tasksRR := httptest.NewRecorder()
	mux.ServeHTTP(tasksRR, tasksReq)
	if tasksRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", tasksRR.Code)
	}

	var tasks []warehouseTask
	if err := json.NewDecoder(tasksRR.Body).Decode(&tasks); err != nil {
		t.Fatalf("decode tasks: %v", err)
	}
	if len(tasks) != 1 {
		t.Fatalf("expected 1 putaway task, got %d", len(tasks))
	}

	taskDoneReq := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/warehouse/tasks/%s/status", tasks[0].ID), strings.NewReader(`{"status":"done"}`))
	taskDoneReq.Header.Set("Content-Type", "application/json")
	taskDoneRR := httptest.NewRecorder()
	mux.ServeHTTP(taskDoneRR, taskDoneReq)
	if taskDoneRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", taskDoneRR.Code)
	}

	closeReq := httptest.NewRequest(http.MethodPost, "/receipts/"+created.ID+"/status", strings.NewReader(`{"status":"closed"}`))
	closeReq.Header.Set("Content-Type", "application/json")
	closeRR := httptest.NewRecorder()
	mux.ServeHTTP(closeRR, closeReq)
	if closeRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", closeRR.Code)
	}
}

func TestReceiptDiscrepancy(t *testing.T) {
	resetReceivingStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	receiptReq := httptest.NewRequest(http.MethodPost, "/receipts", strings.NewReader(`{"purchase_order":"po-2","warehouse":"main"}`))
	receiptReq.Header.Set("Content-Type", "application/json")
	receiptRR := httptest.NewRecorder()
	mux.ServeHTTP(receiptRR, receiptReq)
	if receiptRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", receiptRR.Code)
	}

	var created receipt
	if err := json.NewDecoder(receiptRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode receipt: %v", err)
	}

	discrepancyReq := httptest.NewRequest(http.MethodPost, "/receipts/"+created.ID+"/discrepancy", strings.NewReader(`{"sku":"part-2","expected_qty":4,"actual_qty":2,"reason":"damaged item"}`))
	discrepancyReq.Header.Set("Content-Type", "application/json")
	discrepancyRR := httptest.NewRecorder()
	mux.ServeHTTP(discrepancyRR, discrepancyReq)

	if discrepancyRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", discrepancyRR.Code)
	}

	var discrepancyItem discrepancy
	if err := json.NewDecoder(discrepancyRR.Body).Decode(&discrepancyItem); err != nil {
		t.Fatalf("decode discrepancy: %v", err)
	}
	if discrepancyItem.ReceiptID != created.ID {
		t.Fatalf("expected receipt_id %q, got %q", created.ID, discrepancyItem.ReceiptID)
	}
}
