package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

type serviceInvoice struct {
	ID          string    `json:"id"`
	WorkorderID string    `json:"workorder_id"`
	LaborTotal  float64   `json:"labor_total"`
	PartsTotal  float64   `json:"parts_total"`
	GrandTotal  float64   `json:"grand_total"`
	PaidTotal   float64   `json:"paid_total"`
	Currency    string    `json:"currency"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type completionAct struct {
	ID        string    `json:"id"`
	InvoiceID string    `json:"invoice_id"`
	Workorder string    `json:"workorder_id"`
	CreatedAt time.Time `json:"created_at"`
}

type servicePayment struct {
	ID        string    `json:"id"`
	InvoiceID string    `json:"invoice_id"`
	Amount    float64   `json:"amount"`
	Method    string    `json:"method"`
	CreatedAt time.Time `json:"created_at"`
}

type billingEvent struct {
	ID        string         `json:"id"`
	EventType string         `json:"event_type"`
	EntityID  string         `json:"entity_id"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

var billingStore = struct {
	sync.RWMutex
	invoiceSeq int
	actSeq     int
	paymentSeq int
	eventSeq   int
	invoices   []serviceInvoice
	acts       []completionAct
	payments   []servicePayment
	events     []billingEvent
}{}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)
	mux.HandleFunc("/service-invoices", invoicesHandler)
	mux.HandleFunc("/acts", actsHandler)
	mux.HandleFunc("/payments", paymentsHandler)
	mux.HandleFunc("/events", billingEventsHandler)
}

func invoicesHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		billingStore.RLock()
		defer billingStore.RUnlock()
		statusFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status")))
		workorderFilter := strings.TrimSpace(r.URL.Query().Get("workorder_id"))
		out := make([]serviceInvoice, 0, len(billingStore.invoices))
		for _, invoice := range billingStore.invoices {
			if statusFilter != "" && strings.ToLower(invoice.Status) != statusFilter {
				continue
			}
			if workorderFilter != "" && invoice.WorkorderID != workorderFilter {
				continue
			}
			out = append(out, invoice)
		}
		respondJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req struct {
			WorkorderID string  `json:"workorder_id"`
			LaborTotal  float64 `json:"labor_total"`
			PartsTotal  float64 `json:"parts_total"`
			Currency    string  `json:"currency"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.WorkorderID == "" {
			respondError(w, http.StatusBadRequest, "workorder_id is required")
			return
		}
		if req.LaborTotal < 0 || req.PartsTotal < 0 {
			respondError(w, http.StatusBadRequest, "labor_total and parts_total must be >= 0")
			return
		}
		currency := strings.ToUpper(strings.TrimSpace(req.Currency))
		if currency == "" {
			currency = "RUB"
		}

		billingStore.Lock()
		defer billingStore.Unlock()
		billingStore.invoiceSeq++
		now := time.Now().UTC()
		entity := serviceInvoice{
			ID:          fmt.Sprintf("si-%05d", billingStore.invoiceSeq),
			WorkorderID: req.WorkorderID,
			LaborTotal:  roundMoney(req.LaborTotal),
			PartsTotal:  roundMoney(req.PartsTotal),
			GrandTotal:  roundMoney(req.LaborTotal + req.PartsTotal),
			PaidTotal:   0,
			Currency:    currency,
			Status:      "issued",
			CreatedAt:   now,
			UpdatedAt:   now,
		}
		billingStore.invoices = append(billingStore.invoices, entity)
		appendBillingEvent("ServiceInvoiceIssued", entity.ID, map[string]any{
			"workorder_id": entity.WorkorderID,
			"grand_total":  entity.GrandTotal,
			"currency":     entity.Currency,
		})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func actsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		billingStore.RLock()
		defer billingStore.RUnlock()
		respondJSON(w, http.StatusOK, billingStore.acts)
	case http.MethodPost:
		var req struct {
			InvoiceID string `json:"invoice_id"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.InvoiceID == "" {
			respondError(w, http.StatusBadRequest, "invoice_id is required")
			return
		}

		billingStore.Lock()
		defer billingStore.Unlock()

		invoiceIndex := findInvoiceIndex(req.InvoiceID)
		if invoiceIndex < 0 {
			respondError(w, http.StatusNotFound, "invoice not found")
			return
		}

		invoice := billingStore.invoices[invoiceIndex]
		if invoice.Status == "closed" {
			respondError(w, http.StatusConflict, "invoice already closed")
			return
		}
		if invoice.Status != "paid" {
			respondError(w, http.StatusConflict, "invoice must be fully paid before act creation")
			return
		}

		invoice.Status = "closed"
		invoice.UpdatedAt = time.Now().UTC()
		billingStore.invoices[invoiceIndex] = invoice
		billingStore.actSeq++
		entity := completionAct{
			ID:        fmt.Sprintf("act-%05d", billingStore.actSeq),
			InvoiceID: req.InvoiceID,
			Workorder: invoice.WorkorderID,
			CreatedAt: time.Now().UTC(),
		}
		billingStore.acts = append(billingStore.acts, entity)
		appendBillingEvent("CompletionActIssued", entity.ID, map[string]any{
			"invoice_id":   entity.InvoiceID,
			"workorder_id": entity.Workorder,
		})
		appendBillingEvent("WorkorderClosed", invoice.WorkorderID, map[string]any{
			"invoice_id": invoice.ID,
		})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func paymentsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		billingStore.RLock()
		defer billingStore.RUnlock()
		respondJSON(w, http.StatusOK, billingStore.payments)
	case http.MethodPost:
		var req struct {
			InvoiceID string  `json:"invoice_id"`
			Amount    float64 `json:"amount"`
			Method    string  `json:"method"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.InvoiceID == "" {
			respondError(w, http.StatusBadRequest, "invoice_id is required")
			return
		}
		if req.Amount <= 0 {
			respondError(w, http.StatusBadRequest, "amount must be positive")
			return
		}
		method := strings.ToLower(strings.TrimSpace(req.Method))
		if method == "" {
			method = "cash"
		}

		billingStore.Lock()
		defer billingStore.Unlock()
		invoiceIndex := findInvoiceIndex(req.InvoiceID)
		if invoiceIndex < 0 {
			respondError(w, http.StatusNotFound, "invoice not found")
			return
		}
		invoice := billingStore.invoices[invoiceIndex]
		if invoice.Status == "closed" {
			respondError(w, http.StatusConflict, "invoice is closed")
			return
		}

		billingStore.paymentSeq++
		payment := servicePayment{
			ID:        fmt.Sprintf("sp-%05d", billingStore.paymentSeq),
			InvoiceID: req.InvoiceID,
			Amount:    roundMoney(req.Amount),
			Method:    method,
			CreatedAt: time.Now().UTC(),
		}
		billingStore.payments = append(billingStore.payments, payment)
		invoice.PaidTotal = roundMoney(invoice.PaidTotal + payment.Amount)
		if invoice.PaidTotal >= invoice.GrandTotal {
			invoice.PaidTotal = invoice.GrandTotal
			invoice.Status = "paid"
			appendBillingEvent("ServicePaid", invoice.ID, map[string]any{
				"workorder_id": invoice.WorkorderID,
				"paid_total":   invoice.PaidTotal,
				"currency":     invoice.Currency,
			})
		} else {
			invoice.Status = "partially_paid"
		}
		invoice.UpdatedAt = time.Now().UTC()
		billingStore.invoices[invoiceIndex] = invoice
		appendBillingEvent("PaymentReceived", payment.ID, map[string]any{
			"invoice_id": payment.InvoiceID,
			"amount":     payment.Amount,
			"method":     payment.Method,
		})
		respondJSON(w, http.StatusCreated, map[string]any{
			"payment": payment,
			"invoice": invoice,
		})
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func billingEventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	billingStore.RLock()
	defer billingStore.RUnlock()
	respondJSON(w, http.StatusOK, billingStore.events)
}

func findInvoiceIndex(id string) int {
	for i := range billingStore.invoices {
		if billingStore.invoices[i].ID == id {
			return i
		}
	}
	return -1
}

func appendBillingEvent(eventType, entityID string, payload map[string]any) {
	billingStore.eventSeq++
	billingStore.events = append(billingStore.events, billingEvent{
		ID:        fmt.Sprintf("sbe-%05d", billingStore.eventSeq),
		EventType: eventType,
		EntityID:  entityID,
		Payload:   payload,
		CreatedAt: time.Now().UTC(),
	})
}

func roundMoney(value float64) float64 {
	return float64(int(value*100+0.5)) / 100
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "service-billing",
		"status":  "ok",
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "service-billing",
		"status":  "ready",
	})
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return fmt.Errorf("invalid json: %w", err)
	}
	return nil
}

func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, map[string]string{"error": message})
}

func respondJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
