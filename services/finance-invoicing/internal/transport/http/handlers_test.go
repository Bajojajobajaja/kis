package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetFinanceInvoicingStore() {
	financeInvoicingStore.Lock()
	defer financeInvoicingStore.Unlock()
	financeInvoicingStore.invoiceSeq = 0
	financeInvoicingStore.paymentSeq = 0
	financeInvoicingStore.eventSeq = 0
	financeInvoicingStore.invoices = nil
	financeInvoicingStore.payments = nil
	financeInvoicingStore.events = nil
}

func TestPaymentLifecycle(t *testing.T) {
	resetFinanceInvoicingStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	invoiceReq := httptest.NewRequest(http.MethodPost, "/invoices", strings.NewReader(`{"party_id":"cl-1","party_name":"Client 1","kind":"ar","amount":1000}`))
	invoiceReq.Header.Set("Content-Type", "application/json")
	invoiceRR := httptest.NewRecorder()
	mux.ServeHTTP(invoiceRR, invoiceReq)

	if invoiceRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", invoiceRR.Code)
	}

	var created invoice
	if err := json.NewDecoder(invoiceRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode invoice response: %v", err)
	}

	payReq := httptest.NewRequest(http.MethodPost, "/payments", strings.NewReader(`{"invoice_id":"`+created.ID+`","amount":400}`))
	payReq.Header.Set("Content-Type", "application/json")
	payRR := httptest.NewRecorder()
	mux.ServeHTTP(payRR, payReq)

	if payRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", payRR.Code)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/invoices", nil)
	listRR := httptest.NewRecorder()
	mux.ServeHTTP(listRR, listReq)

	var invoices []invoice
	if err := json.NewDecoder(listRR.Body).Decode(&invoices); err != nil {
		t.Fatalf("decode invoices list: %v", err)
	}
	if len(invoices) != 1 || invoices[0].Status != "partially_paid" {
		t.Fatalf("expected invoice status partially_paid, got %+v", invoices)
	}

	payReq2 := httptest.NewRequest(http.MethodPost, "/payments", strings.NewReader(`{"invoice_id":"`+created.ID+`","amount":600}`))
	payReq2.Header.Set("Content-Type", "application/json")
	payRR2 := httptest.NewRecorder()
	mux.ServeHTTP(payRR2, payReq2)
	if payRR2.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", payRR2.Code)
	}

	listReq2 := httptest.NewRequest(http.MethodGet, "/invoices", nil)
	listRR2 := httptest.NewRecorder()
	mux.ServeHTTP(listRR2, listReq2)
	var invoices2 []invoice
	if err := json.NewDecoder(listRR2.Body).Decode(&invoices2); err != nil {
		t.Fatalf("decode invoices list: %v", err)
	}
	if len(invoices2) != 1 || invoices2[0].Status != "paid" {
		t.Fatalf("expected invoice status paid, got %+v", invoices2)
	}
}

func TestPaymentReconcile(t *testing.T) {
	resetFinanceInvoicingStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	invoiceReq := httptest.NewRequest(http.MethodPost, "/invoices", strings.NewReader(`{"party_id":"vendor-1","kind":"ap","amount":250}`))
	invoiceReq.Header.Set("Content-Type", "application/json")
	invoiceRR := httptest.NewRecorder()
	mux.ServeHTTP(invoiceRR, invoiceReq)
	if invoiceRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", invoiceRR.Code)
	}
	var created invoice
	if err := json.NewDecoder(invoiceRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode invoice response: %v", err)
	}

	reconcileReq := httptest.NewRequest(http.MethodPost, "/payments/reconcile", strings.NewReader(fmt.Sprintf(`{"source":"bank","payments":[{"external_id":"ext-1","invoice_id":"%s","amount":250}]}`, created.ID)))
	reconcileReq.Header.Set("Content-Type", "application/json")
	reconcileRR := httptest.NewRecorder()
	mux.ServeHTTP(reconcileRR, reconcileReq)
	if reconcileRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", reconcileRR.Code)
	}

	summaryReq := httptest.NewRequest(http.MethodGet, "/ar-ap/summary", nil)
	summaryRR := httptest.NewRecorder()
	mux.ServeHTTP(summaryRR, summaryReq)
	if summaryRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", summaryRR.Code)
	}
	var summary map[string]any
	if err := json.NewDecoder(summaryRR.Body).Decode(&summary); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	if summary["payments"] != float64(1) {
		t.Fatalf("expected 1 payment in summary, got %v", summary["payments"])
	}
}

func TestPaymentForUnknownInvoice(t *testing.T) {
	resetFinanceInvoicingStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/payments", strings.NewReader(`{"invoice_id":"inv-404","amount":10}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", rr.Code)
	}
}
