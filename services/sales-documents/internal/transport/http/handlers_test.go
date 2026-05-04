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
		t.Fatalf("expected status 201, got %d (%s)", rr.Code, rr.Body.String())
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

	req := httptest.NewRequest(http.MethodPost, "/documents/generate", strings.NewReader(`{"template_id":"tpl-contract","deal_id":"dl-1","source_document_id":"DOC-1","document_number":"CTR-70001","buyer_name":"Ivan Petrov","vehicle_title":"Toyota Camry 2020","vehicle_vin":"VIN-001","total":45000}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d (%s)", rr.Code, rr.Body.String())
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

func TestGenerateContractReturnsDownloadablePDF(t *testing.T) {
	resetSalesDocsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/documents/generate", strings.NewReader(`{"template_id":"tpl-contract","deal_id":"dl-1","source_document_id":"DOC-42","document_number":"CTR-80011","document_date":"2026-03-28","buyer_name":"Ivan Petrov","responsible":"Manager","vehicle_title":"Toyota Camry 2020","vehicle_vin":"VIN-001","vehicle_brand":"Toyota","vehicle_model":"Camry","vehicle_year":"2020","total":45000}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d (%s)", rr.Code, rr.Body.String())
	}

	var got document
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.DownloadURL == "" {
		t.Fatalf("expected download url, got %+v", got)
	}
	if got.ContentType != "application/pdf" {
		t.Fatalf("expected application/pdf, got %+v", got)
	}

	downloadReq := httptest.NewRequest(http.MethodGet, got.DownloadURL, nil)
	downloadRR := httptest.NewRecorder()
	mux.ServeHTTP(downloadRR, downloadReq)

	if downloadRR.Code != http.StatusOK {
		t.Fatalf("expected download status 200, got %d", downloadRR.Code)
	}
	if contentType := downloadRR.Header().Get("Content-Type"); contentType != "application/pdf" {
		t.Fatalf("expected application/pdf download, got %q", contentType)
	}
	if downloadRR.Body.Len() == 0 {
		t.Fatal("expected non-empty pdf payload")
	}
}

func TestGenerateContractUpsertsBySourceDocumentID(t *testing.T) {
	resetSalesDocsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	body := `{"template_id":"tpl-contract","deal_id":"dl-1","source_document_id":"DOC-42","document_number":"CTR-80011","buyer_name":"Ivan Petrov","vehicle_title":"Toyota Camry 2020","vehicle_vin":"VIN-001","total":45000}`
	firstReq := httptest.NewRequest(http.MethodPost, "/documents/generate", strings.NewReader(body))
	firstReq.Header.Set("Content-Type", "application/json")
	firstRR := httptest.NewRecorder()
	mux.ServeHTTP(firstRR, firstReq)
	if firstRR.Code != http.StatusCreated {
		t.Fatalf("expected first status 201, got %d (%s)", firstRR.Code, firstRR.Body.String())
	}

	secondReq := httptest.NewRequest(http.MethodPost, "/documents/generate", strings.NewReader(body))
	secondReq.Header.Set("Content-Type", "application/json")
	secondRR := httptest.NewRecorder()
	mux.ServeHTTP(secondRR, secondReq)
	if secondRR.Code != http.StatusCreated {
		t.Fatalf("expected second status 201, got %d (%s)", secondRR.Code, secondRR.Body.String())
	}

	var first document
	if err := json.NewDecoder(firstRR.Body).Decode(&first); err != nil {
		t.Fatalf("decode first response: %v", err)
	}
	var second document
	if err := json.NewDecoder(secondRR.Body).Decode(&second); err != nil {
		t.Fatalf("decode second response: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("expected document upsert to reuse id, got %q and %q", first.ID, second.ID)
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
