package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetSalesDocsStore() {
	salesDocsStore.Lock()
	defer salesDocsStore.Unlock()
	salesDocsStore.seq = 0
	salesDocsStore.eventSeq = 0
	salesDocsStore.documents = nil
	salesDocsStore.events = nil
	salesDocsStore.templates = []template{
		{ID: "tpl-contract", Name: "Sales Contract", Type: "contract"},
		{ID: "tpl-invoice", Name: "Sales Invoice", Type: "invoice"},
		{ID: "tpl-transfer", Name: "Transfer Act", Type: "transfer_act"},
		{ID: "tpl-receipt", Name: "Payment Receipt", Type: "receipt"},
	}
}

func TestGenerateDocument(t *testing.T) {
	resetSalesDocsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/documents/generate", strings.NewReader(`{"template_id":"tpl-invoice","deal_id":"dl-1","total":1234}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", rr.Code)
	}

	var got document
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !strings.HasPrefix(got.Number, "INV-") {
		t.Fatalf("expected INV number prefix, got %q", got.Number)
	}
	if got.Status != "issued" {
		t.Fatalf("expected status issued, got %q", got.Status)
	}
}

func TestGenerateContractPublishesEvent(t *testing.T) {
	resetSalesDocsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/documents/generate", strings.NewReader(`{"template_id":"tpl-contract","deal_id":"dl-1","total":45000}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", rr.Code)
	}

	eventsReq := httptest.NewRequest(http.MethodGet, "/events?event_type=ContractIssued", nil)
	eventsRR := httptest.NewRecorder()
	mux.ServeHTTP(eventsRR, eventsReq)
	if eventsRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", eventsRR.Code)
	}

	var events []salesDocEvent
	if err := json.NewDecoder(eventsRR.Body).Decode(&events); err != nil {
		t.Fatalf("decode events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 ContractIssued event, got %d", len(events))
	}
}

func TestTemplatesIncludeReceipt(t *testing.T) {
	resetSalesDocsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodGet, "/documents/templates", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var templates []template
	if err := json.NewDecoder(rr.Body).Decode(&templates); err != nil {
		t.Fatalf("decode templates: %v", err)
	}

	hasReceipt := false
	for _, tpl := range templates {
		if tpl.Type == "receipt" {
			hasReceipt = true
			break
		}
	}
	if !hasReceipt {
		t.Fatal("expected receipt template to be available")
	}
}

func TestGenerateDocumentUnknownTemplate(t *testing.T) {
	resetSalesDocsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/documents/generate", strings.NewReader(`{"template_id":"tpl-unknown","deal_id":"dl-1"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rr.Code)
	}
}
