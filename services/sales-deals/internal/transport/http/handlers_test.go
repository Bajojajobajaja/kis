package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetSalesDealsStore() {
	salesDealsStore.Lock()
	salesDealsStore.seq = 0
	salesDealsStore.paymentSeq = 0
	salesDealsStore.deals = nil
	salesDealsStore.payments = nil
	salesDealsStore.Unlock()

	salesDealsAuditStore.Lock()
	salesDealsAuditStore.seq = 0
	salesDealsAuditStore.events = nil
	salesDealsAuditStore.Unlock()

	salesDealsDomainEventStore.Lock()
	salesDealsDomainEventStore.seq = 0
	salesDealsDomainEventStore.events = nil
	salesDealsDomainEventStore.Unlock()
}

func createDeal(t *testing.T, mux *http.ServeMux, userID string) deal {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/deals", strings.NewReader(`{"client_id":"cl-1","vehicle_vin":"VIN123","amount":1000}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Role", "sales_agent")
	req.Header.Set("X-User-ID", userID)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", rr.Code)
	}

	var d deal
	if err := json.NewDecoder(rr.Body).Decode(&d); err != nil {
		t.Fatalf("decode deal: %v", err)
	}
	return d
}

func TestCloseDealSagaCompensation(t *testing.T) {
	resetSalesDealsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	created := createDeal(t, mux, "agent-1")

	closeReq := httptest.NewRequest(http.MethodPost, "/deals/"+created.ID+"/close", strings.NewReader(`{"simulate_finance_failure":true}`))
	closeReq.Header.Set("Content-Type", "application/json")
	closeReq.Header.Set("X-Role", "sales_agent")
	closeReq.Header.Set("X-User-ID", "agent-1")
	closeRR := httptest.NewRecorder()
	mux.ServeHTTP(closeRR, closeReq)

	if closeRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", closeRR.Code)
	}

	var got struct {
		Result string `json:"result"`
		Deal   deal   `json:"deal"`
	}
	if err := json.NewDecoder(closeRR.Body).Decode(&got); err != nil {
		t.Fatalf("decode close response: %v", err)
	}
	if got.Result != "compensated" {
		t.Fatalf("expected compensated result, got %q", got.Result)
	}
	if got.Deal.ReservedVIN != "" || got.Deal.Status != "open" {
		t.Fatalf("expected reservation rollback and open status, got %+v", got.Deal)
	}
}

func TestSalesAgentCannotEditForeignDeal(t *testing.T) {
	resetSalesDealsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	created := createDeal(t, mux, "agent-1")

	updateReq := httptest.NewRequest(http.MethodPost, "/deals/"+created.ID+"/stages", strings.NewReader(`{"stage":"won"}`))
	updateReq.Header.Set("Content-Type", "application/json")
	updateReq.Header.Set("X-Role", "sales_agent")
	updateReq.Header.Set("X-User-ID", "agent-2")
	updateRR := httptest.NewRecorder()
	mux.ServeHTTP(updateRR, updateReq)

	if updateRR.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d", updateRR.Code)
	}
}

func TestInvalidStageTransition(t *testing.T) {
	resetSalesDealsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	created := createDeal(t, mux, "agent-1")
	updateReq := httptest.NewRequest(http.MethodPost, "/deals/"+created.ID+"/stages", strings.NewReader(`{"stage":"delivered"}`))
	updateReq.Header.Set("Content-Type", "application/json")
	updateReq.Header.Set("X-Role", "sales_agent")
	updateReq.Header.Set("X-User-ID", "agent-1")
	updateRR := httptest.NewRecorder()
	mux.ServeHTTP(updateRR, updateReq)

	if updateRR.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", updateRR.Code)
	}
}

func TestRecordPaymentPublishesEvent(t *testing.T) {
	resetSalesDealsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	created := createDeal(t, mux, "agent-1")

	stageReq := httptest.NewRequest(http.MethodPost, "/deals/"+created.ID+"/stages", strings.NewReader(`{"stage":"qualified"}`))
	stageReq.Header.Set("Content-Type", "application/json")
	stageReq.Header.Set("X-Role", "sales_agent")
	stageReq.Header.Set("X-User-ID", "agent-1")
	stageRR := httptest.NewRecorder()
	mux.ServeHTTP(stageRR, stageReq)
	if stageRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", stageRR.Code)
	}

	payReq := httptest.NewRequest(http.MethodPost, "/deals/"+created.ID+"/payments", strings.NewReader(`{"amount":1000,"method":"card"}`))
	payReq.Header.Set("Content-Type", "application/json")
	payReq.Header.Set("X-Role", "sales_agent")
	payReq.Header.Set("X-User-ID", "agent-1")
	payRR := httptest.NewRecorder()
	mux.ServeHTTP(payRR, payReq)
	if payRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", payRR.Code)
	}

	eventsReq := httptest.NewRequest(http.MethodGet, "/events?event_type=SalePaid", nil)
	eventsRR := httptest.NewRecorder()
	mux.ServeHTTP(eventsRR, eventsReq)
	if eventsRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", eventsRR.Code)
	}

	var events []dealDomainEvent
	if err := json.NewDecoder(eventsRR.Body).Decode(&events); err != nil {
		t.Fatalf("decode events response: %v", err)
	}
	if len(events) == 0 {
		t.Fatal("expected SalePaid event to be published")
	}
}
