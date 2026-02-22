package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetBillingStore() {
	billingStore.Lock()
	defer billingStore.Unlock()
	billingStore.invoiceSeq = 0
	billingStore.actSeq = 0
	billingStore.paymentSeq = 0
	billingStore.eventSeq = 0
	billingStore.invoices = nil
	billingStore.acts = nil
	billingStore.payments = nil
	billingStore.events = nil
}

func TestCreateActClosesInvoice(t *testing.T) {
	resetBillingStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	invoiceReq := httptest.NewRequest(http.MethodPost, "/service-invoices", strings.NewReader(`{"workorder_id":"wo-1","labor_total":100,"parts_total":50}`))
	invoiceReq.Header.Set("Content-Type", "application/json")
	invoiceRR := httptest.NewRecorder()
	mux.ServeHTTP(invoiceRR, invoiceReq)

	if invoiceRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", invoiceRR.Code)
	}

	var created serviceInvoice
	if err := json.NewDecoder(invoiceRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode invoice: %v", err)
	}

	paymentReq := httptest.NewRequest(http.MethodPost, "/payments", strings.NewReader(`{"invoice_id":"`+created.ID+`","amount":150,"method":"card"}`))
	paymentReq.Header.Set("Content-Type", "application/json")
	paymentRR := httptest.NewRecorder()
	mux.ServeHTTP(paymentRR, paymentReq)
	if paymentRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", paymentRR.Code)
	}

	actReq := httptest.NewRequest(http.MethodPost, "/acts", strings.NewReader(`{"invoice_id":"`+created.ID+`"}`))
	actReq.Header.Set("Content-Type", "application/json")
	actRR := httptest.NewRecorder()
	mux.ServeHTTP(actRR, actReq)

	if actRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", actRR.Code)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/service-invoices", nil)
	listRR := httptest.NewRecorder()
	mux.ServeHTTP(listRR, listReq)

	var invoices []serviceInvoice
	if err := json.NewDecoder(listRR.Body).Decode(&invoices); err != nil {
		t.Fatalf("decode invoices list: %v", err)
	}
	if len(invoices) != 1 || invoices[0].Status != "closed" {
		t.Fatalf("expected closed invoice status, got %+v", invoices)
	}
}

func TestCannotCreateActBeforePayment(t *testing.T) {
	resetBillingStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	invoiceReq := httptest.NewRequest(http.MethodPost, "/service-invoices", strings.NewReader(`{"workorder_id":"wo-2","labor_total":100,"parts_total":10}`))
	invoiceReq.Header.Set("Content-Type", "application/json")
	invoiceRR := httptest.NewRecorder()
	mux.ServeHTTP(invoiceRR, invoiceReq)
	if invoiceRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", invoiceRR.Code)
	}

	var created serviceInvoice
	if err := json.NewDecoder(invoiceRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode invoice: %v", err)
	}

	actReq := httptest.NewRequest(http.MethodPost, "/acts", strings.NewReader(`{"invoice_id":"`+created.ID+`"}`))
	actReq.Header.Set("Content-Type", "application/json")
	actRR := httptest.NewRecorder()
	mux.ServeHTTP(actRR, actReq)
	if actRR.Code != http.StatusConflict {
		t.Fatalf("expected status 409, got %d", actRR.Code)
	}
}
