package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func resetPartsStore() {
	partsStore.Lock()
	partsStore.seq = 0
	partsStore.procurementSeq = 0
	partsStore.eventSeq = 0
	partsStore.usages = nil
	partsStore.plans = map[string][]workorderPartsPlanLine{}
	partsStore.procurements = nil
	partsStore.events = nil
	partsStore.stockByPartCode = map[string]partStock{
		"P-1":         {PartCode: "P-1", Available: 10, Reserved: 0, Consumed: 0, ReorderPoint: 3},
		"PART-OIL":    {PartCode: "PART-OIL", Available: 4, Reserved: 0, Consumed: 0, ReorderPoint: 2},
		"PART-FILTER": {PartCode: "PART-FILTER", Available: 1, Reserved: 0, Consumed: 0, ReorderPoint: 2},
	}
	partsStore.Unlock()

	lookupInventoryStockBySKU = defaultLookupInventoryStockBySKU
	issueInventoryStock = defaultIssueInventoryStock
	createExternalProcurementRequest = defaultCreateExternalProcurementRequest
	updateExternalWorkorderStatus = defaultUpdateExternalWorkorderStatus
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

func TestUsagesListFiltersByAction(t *testing.T) {
	resetPartsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	createReserveReq := httptest.NewRequest(http.MethodPost, "/workorders/wo-1/parts", strings.NewReader(`{"part_code":"P-1","quantity":2,"action":"reserve"}`))
	createReserveReq.Header.Set("Content-Type", "application/json")
	createReserveRR := httptest.NewRecorder()
	mux.ServeHTTP(createReserveRR, createReserveReq)
	if createReserveRR.Code != http.StatusCreated {
		t.Fatalf("expected reserve status 201, got %d", createReserveRR.Code)
	}

	partsStore.Lock()
	partsStore.seq++
	partsStore.usages = append(partsStore.usages, partsUsage{
		ID:          "pu-9999",
		WorkorderID: "wo-2",
		PartCode:    "PART-OIL",
		Quantity:    1,
		Action:      "writeoff",
		CreatedAt:   time.Now().UTC().Add(time.Second),
	})
	partsStore.Unlock()

	listReq := httptest.NewRequest(http.MethodGet, "/usages?action=writeoff", nil)
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
		t.Fatalf("expected 1 writeoff usage, got %d", len(usages))
	}
	if usages[0].Action != "writeoff" {
		t.Fatalf("expected writeoff action, got %+v", usages[0])
	}
}

func TestWorkorderPartsPlanCollapsesDuplicateSKUs(t *testing.T) {
	resetPartsStore()
	lookupInventoryStockBySKU = func(sku string) (inventoryStockLookupResult, error) {
		return inventoryStockLookupResult{
			Found:     true,
			Available: 7,
			Item: inventoryStockItem{
				SKU:      sku,
				Location: "main",
				OnHand:   10,
				Reserved: 3,
			},
		}, nil
	}

	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPut, "/workorders/WO-10031/parts-plan", strings.NewReader(`{"lines":[{"sku":"part-filter","title":"Filter","quantity":2},{"sku":"PART-FILTER","title":"Oil filter","quantity":3}]}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var payload struct {
		Lines []workorderPartsPlanLineView `json:"lines"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode plan payload: %v", err)
	}
	if len(payload.Lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(payload.Lines))
	}
	if payload.Lines[0].SKU != "PART-FILTER" {
		t.Fatalf("expected PART-FILTER, got %+v", payload.Lines[0])
	}
	if payload.Lines[0].Quantity != 5 {
		t.Fatalf("expected quantity 5, got %+v", payload.Lines[0])
	}
	if payload.Lines[0].AvailableQuantity != 7 {
		t.Fatalf("expected available quantity 7, got %+v", payload.Lines[0])
	}
}

func TestWriteoffCreatesProcurementAndMovesWorkorderToWaitingParts(t *testing.T) {
	resetPartsStore()

	lookupInventoryStockBySKU = func(sku string) (inventoryStockLookupResult, error) {
		return inventoryStockLookupResult{
			Found:     true,
			Available: 1,
			Item: inventoryStockItem{
				SKU:      sku,
				Location: "main",
				OnHand:   2,
				Reserved: 1,
			},
		}, nil
	}

	var procurementCalls int
	createExternalProcurementRequest = func(
		req inventoryProcurementCreateRequest,
	) (externalProcurementRequest, error) {
		procurementCalls++
		return externalProcurementRequest{
			ID:        "req-1001",
			SKU:       req.SKU,
			Quantity:  req.Quantity,
			Source:    req.Source,
			Status:    "new",
			CreatedAt: time.Now().UTC(),
		}, nil
	}

	var syncedStatus string
	updateExternalWorkorderStatus = func(workorderID, status string) error {
		syncedStatus = status
		return nil
	}

	mux := http.NewServeMux()
	RegisterHandlers(mux)

	saveReq := httptest.NewRequest(http.MethodPut, "/workorders/WO-10032/parts-plan", strings.NewReader(`{"lines":[{"sku":"PART-FILTER","title":"Oil filter","quantity":4}]}`))
	saveReq.Header.Set("Content-Type", "application/json")
	saveRR := httptest.NewRecorder()
	mux.ServeHTTP(saveRR, saveReq)
	if saveRR.Code != http.StatusOK {
		t.Fatalf("save plan: expected 200, got %d", saveRR.Code)
	}

	writeoffReq := httptest.NewRequest(http.MethodPost, "/workorders/WO-10032/writeoff", nil)
	writeoffRR := httptest.NewRecorder()
	mux.ServeHTTP(writeoffRR, writeoffReq)

	if writeoffRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", writeoffRR.Code)
	}
	if syncedStatus != "waiting_parts" {
		t.Fatalf("expected waiting_parts status sync, got %q", syncedStatus)
	}
	if procurementCalls != 1 {
		t.Fatalf("expected 1 procurement call, got %d", procurementCalls)
	}

	var payload workorderPartsWriteoffResponse
	if err := json.NewDecoder(writeoffRR.Body).Decode(&payload); err != nil {
		t.Fatalf("decode writeoff payload: %v", err)
	}
	if payload.Result != "waiting_parts" {
		t.Fatalf("expected waiting_parts result, got %+v", payload)
	}
	if len(payload.Shortages) != 1 {
		t.Fatalf("expected 1 shortage line, got %+v", payload)
	}
	if payload.Shortages[0].ProcurementRequestID != "req-1001" {
		t.Fatalf("expected procurement request id req-1001, got %+v", payload.Shortages[0])
	}

	secondReq := httptest.NewRequest(http.MethodPost, "/workorders/WO-10032/writeoff", nil)
	secondRR := httptest.NewRecorder()
	mux.ServeHTTP(secondRR, secondReq)
	if secondRR.Code != http.StatusOK {
		t.Fatalf("repeat writeoff: expected 200, got %d", secondRR.Code)
	}
	if procurementCalls != 1 {
		t.Fatalf("expected repeat writeoff to reuse procurement request, got %d calls", procurementCalls)
	}
}

func TestWriteoffIssuesStockAndIsIdempotent(t *testing.T) {
	resetPartsStore()

	lookupInventoryStockBySKU = func(sku string) (inventoryStockLookupResult, error) {
		return inventoryStockLookupResult{
			Found:     true,
			Available: 6,
			Item: inventoryStockItem{
				SKU:      sku,
				Location: "main",
				OnHand:   6,
				Reserved: 0,
			},
		}, nil
	}

	var issueCalls int
	issueInventoryStock = func(req inventoryStockIssueRequest) (inventoryStockItem, error) {
		issueCalls++
		return inventoryStockItem{
			SKU:      req.SKU,
			Location: req.Location,
			OnHand:   4,
			Reserved: 0,
		}, nil
	}

	var syncedStatus string
	updateExternalWorkorderStatus = func(workorderID, status string) error {
		syncedStatus = status
		return nil
	}

	mux := http.NewServeMux()
	RegisterHandlers(mux)

	saveReq := httptest.NewRequest(http.MethodPut, "/workorders/WO-10033/parts-plan", strings.NewReader(`{"lines":[{"sku":"PART-OIL","title":"Oil","quantity":2}]}`))
	saveReq.Header.Set("Content-Type", "application/json")
	saveRR := httptest.NewRecorder()
	mux.ServeHTTP(saveRR, saveReq)
	if saveRR.Code != http.StatusOK {
		t.Fatalf("save plan: expected 200, got %d", saveRR.Code)
	}

	writeoffReq := httptest.NewRequest(http.MethodPost, "/workorders/WO-10033/writeoff", nil)
	writeoffRR := httptest.NewRecorder()
	mux.ServeHTTP(writeoffRR, writeoffReq)

	if writeoffRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", writeoffRR.Code)
	}
	if issueCalls != 1 {
		t.Fatalf("expected 1 stock issue call, got %d", issueCalls)
	}
	if syncedStatus != "ready" {
		t.Fatalf("expected ready status sync, got %q", syncedStatus)
	}
	if len(partsStore.usages) != 1 {
		t.Fatalf("expected 1 usage record, got %d", len(partsStore.usages))
	}
	if partsStore.usages[0].Action != "writeoff" {
		t.Fatalf("expected writeoff usage action, got %+v", partsStore.usages[0])
	}

	repeatReq := httptest.NewRequest(http.MethodPost, "/workorders/WO-10033/writeoff", nil)
	repeatRR := httptest.NewRecorder()
	mux.ServeHTTP(repeatRR, repeatReq)

	if repeatRR.Code != http.StatusOK {
		t.Fatalf("repeat writeoff: expected 200, got %d", repeatRR.Code)
	}
	if issueCalls != 1 {
		t.Fatalf("expected repeat writeoff not to issue stock again, got %d calls", issueCalls)
	}
}

func TestResetPersistedStateRestoresSeedPartStock(t *testing.T) {
	partsStore.Lock()
	partsStore.seq = 0
	partsStore.procurementSeq = 0
	partsStore.eventSeq = 0
	partsStore.usages = nil
	partsStore.plans = nil
	partsStore.stockByPartCode = nil
	partsStore.procurements = nil
	partsStore.events = nil
	partsStore.Unlock()

	resetPersistedState()

	partsStore.RLock()
	defer partsStore.RUnlock()

	if len(partsStore.stockByPartCode) == 0 {
		t.Fatalf("expected seed part stock to be restored")
	}
	part, ok := partsStore.stockByPartCode["PART-FILTER"]
	if !ok {
		t.Fatalf("expected PART-FILTER seed part stock to be restored")
	}
	if part.Available != 1 || part.ReorderPoint != 2 {
		t.Fatalf("expected PART-FILTER seed values, got %+v", part)
	}
}

func TestReplayPartsPlanAcceptsFirstJournalPayload(t *testing.T) {
	resetPartsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	lookupInventoryStockBySKU = func(sku string) (inventoryStockLookupResult, error) {
		return inventoryStockLookupResult{
			Found:     true,
			Available: 2,
			Item: inventoryStockItem{
				SKU:      sku,
				Location: "main",
				OnHand:   3,
				Reserved: 1,
			},
		}, nil
	}
	t.Cleanup(func() {
		lookupInventoryStockBySKU = defaultLookupInventoryStockBySKU
	})

	req := httptest.NewRequest(http.MethodPut, "/workorders/WO-PLAN-CHECK/parts-plan", strings.NewReader(`{"lines":[{"sku":"PART-FILTER","title":"Filter","quantity":2}]}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected first journal parts-plan payload to succeed with 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestBuildPlanViewsUsesCurrentAvailabilityForWrittenOffLines(t *testing.T) {
	resetPartsStore()
	lookupInventoryStockBySKU = func(sku string) (inventoryStockLookupResult, error) {
		return inventoryStockLookupResult{
			Found:     true,
			Available: 17,
			Item: inventoryStockItem{
				SKU:      sku,
				Location: "main",
				OnHand:   20,
				Reserved: 3,
			},
		}, nil
	}

	views, err := buildPlanViews([]workorderPartsPlanLine{
		{
			SKU:      "PART-AIR-FILTER",
			Title:    "Air filter",
			Quantity: 3,
			State:    "written_off",
		},
	})
	if err != nil {
		t.Fatalf("build plan views: %v", err)
	}
	if len(views) != 1 {
		t.Fatalf("expected 1 view, got %d", len(views))
	}
	if views[0].AvailableQuantity != 17 {
		t.Fatalf("expected current available quantity 17, got %+v", views[0])
	}
	if views[0].MissingQuantity != 0 {
		t.Fatalf("expected no shortage for written off line, got %+v", views[0])
	}
}
