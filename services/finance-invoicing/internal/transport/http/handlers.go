package httptransport

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const financeInvoicingDevSeedEnvKey = "FINANCE_INVOICING_DEV_SEED_ENABLED"

type invoice struct {
	ID          string    `json:"id"`
	Number      string    `json:"number"`
	Subject     string    `json:"subject"`
	PartyID     string    `json:"party_id"`
	PartyName   string    `json:"party_name,omitempty"`
	Kind        string    `json:"kind"`
	Amount      float64   `json:"amount"`
	PaidAmount  float64   `json:"paid_amount"`
	Currency    string    `json:"currency"`
	DueDate     string    `json:"due_date,omitempty"`
	Status      string    `json:"status"`
	ExternalRef string    `json:"external_ref,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type payment struct {
	ID         string    `json:"id"`
	InvoiceID  string    `json:"invoice_id"`
	Amount     float64   `json:"amount"`
	Method     string    `json:"method"`
	ExternalID string    `json:"external_id,omitempty"`
	Note       string    `json:"note,omitempty"`
	PaidAt     time.Time `json:"paid_at"`
	CreatedAt  time.Time `json:"created_at"`
}

type reconciliationResult struct {
	Matched  int       `json:"matched"`
	Skipped  int       `json:"skipped"`
	Errors   []string  `json:"errors,omitempty"`
	Payments []payment `json:"payments,omitempty"`
}

type invoicingEvent struct {
	ID        string         `json:"id"`
	EventType string         `json:"event_type"`
	EntityID  string         `json:"entity_id"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

var financeInvoicingStore = struct {
	sync.RWMutex
	invoiceSeq int
	paymentSeq int
	eventSeq   int
	invoices   []invoice
	payments   []payment
	events     []invoicingEvent
}{}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)

	mux.HandleFunc("/invoices", invoicesHandler)
	mux.HandleFunc("/invoices/", invoiceByIDHandler)
	mux.HandleFunc("/payments", paymentsHandler)
	mux.HandleFunc("/payments/reconcile", reconcileHandler)
	mux.HandleFunc("/ar-ap/summary", summaryHandler)
	mux.HandleFunc("/dev/reset", devResetHandler)
	mux.HandleFunc("/events", eventsHandler)
}

func invoicesHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		financeInvoicingStore.RLock()
		defer financeInvoicingStore.RUnlock()
		statusFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status")))
		kindFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("kind")))
		partyFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("party_id")))
		out := make([]invoice, 0, len(financeInvoicingStore.invoices))
		for _, entity := range financeInvoicingStore.invoices {
			if statusFilter != "" && strings.ToLower(entity.Status) != statusFilter {
				continue
			}
			if kindFilter != "" && strings.ToLower(entity.Kind) != kindFilter {
				continue
			}
			if partyFilter != "" && strings.ToLower(entity.PartyID) != partyFilter {
				continue
			}
			out = append(out, entity)
		}
		respondJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req struct {
			Number      string  `json:"number"`
			Subject     string  `json:"subject"`
			PartyID     string  `json:"party_id"`
			PartyName   string  `json:"party_name"`
			ClientID    string  `json:"client_id"`
			Amount      float64 `json:"amount"`
			Kind        string  `json:"kind"`
			Currency    string  `json:"currency"`
			DueDate     string  `json:"due_date"`
			ExternalRef string  `json:"external_ref"`
			CreatedAt   string  `json:"created_at"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		partyID := defaultValue(strings.TrimSpace(req.PartyID), strings.TrimSpace(req.ClientID))
		if partyID == "" || req.Amount <= 0 {
			respondError(w, http.StatusBadRequest, "party_id and positive amount are required")
			return
		}
		kind := strings.ToLower(defaultValue(strings.TrimSpace(req.Kind), "ar"))
		if !isAllowedInvoiceKind(kind) {
			respondError(w, http.StatusBadRequest, "kind must be ar or ap")
			return
		}

		now := time.Now().UTC()
		createdAt, err := resolveInvoiceCreatedAt(req.CreatedAt, now)
		if err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		financeInvoicingStore.Lock()
		defer financeInvoicingStore.Unlock()
		financeInvoicingStore.invoiceSeq++
		number, err := resolveInvoiceNumber(req.Number, kind, financeInvoicingStore.invoiceSeq)
		if err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		entity := invoice{
			ID:          fmt.Sprintf("inv-%05d", financeInvoicingStore.invoiceSeq),
			Number:      number,
			Subject:     defaultValue(strings.TrimSpace(req.Subject), "Invoice"),
			PartyID:     partyID,
			PartyName:   strings.TrimSpace(req.PartyName),
			Kind:        kind,
			Amount:      round2(req.Amount),
			PaidAmount:  0,
			Currency:    strings.ToUpper(defaultValue(strings.TrimSpace(req.Currency), "USD")),
			DueDate:     strings.TrimSpace(req.DueDate),
			Status:      "issued",
			ExternalRef: strings.TrimSpace(req.ExternalRef),
			CreatedAt:   createdAt,
			UpdatedAt:   now,
		}
		financeInvoicingStore.invoices = append(financeInvoicingStore.invoices, entity)
		appendInvoicingEvent("InvoiceCreated", entity.ID, map[string]any{
			"number": entity.Number,
			"kind":   entity.Kind,
			"amount": entity.Amount,
		})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func devResetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !isFinanceInvoicingDevSeedEnabled() {
		respondError(w, http.StatusForbidden, "dev reset is disabled")
		return
	}

	financeInvoicingStore.Lock()
	resetFinanceInvoicingStoreLocked()
	financeInvoicingStore.Unlock()

	respondJSON(w, http.StatusOK, map[string]any{
		"status":    "reset",
		"invoices":  0,
		"payments":  0,
		"events":    0,
		"timestamp": time.Now().UTC(),
	})
}

func invoiceByIDHandler(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 2 || parts[0] != "invoices" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}
	invoiceID := parts[1]

	if len(parts) == 2 && r.Method == http.MethodGet {
		financeInvoicingStore.RLock()
		defer financeInvoicingStore.RUnlock()
		index := findInvoiceIndex(invoiceID)
		if index < 0 {
			respondError(w, http.StatusNotFound, "invoice not found")
			return
		}
		respondJSON(w, http.StatusOK, financeInvoicingStore.invoices[index])
		return
	}

	if len(parts) == 3 && parts[2] == "status" && r.Method == http.MethodPost {
		var req struct {
			Status string `json:"status"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		status := strings.ToLower(strings.TrimSpace(req.Status))
		if !isAllowedInvoiceStatus(status) {
			respondError(w, http.StatusBadRequest, "unsupported status")
			return
		}

		financeInvoicingStore.Lock()
		defer financeInvoicingStore.Unlock()
		index := findInvoiceIndex(invoiceID)
		if index < 0 {
			respondError(w, http.StatusNotFound, "invoice not found")
			return
		}
		current := financeInvoicingStore.invoices[index].Status
		if !isAllowedInvoiceTransition(current, status) {
			respondError(w, http.StatusConflict, "invalid status transition")
			return
		}
		financeInvoicingStore.invoices[index].Status = status
		financeInvoicingStore.invoices[index].UpdatedAt = time.Now().UTC()
		appendInvoicingEvent("InvoiceStatusChanged", invoiceID, map[string]any{"from": current, "to": status})
		respondJSON(w, http.StatusOK, financeInvoicingStore.invoices[index])
		return
	}

	respondError(w, http.StatusNotFound, "route not found")
}

func paymentsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		financeInvoicingStore.RLock()
		defer financeInvoicingStore.RUnlock()
		invoiceFilter := strings.TrimSpace(r.URL.Query().Get("invoice_id"))
		out := make([]payment, 0, len(financeInvoicingStore.payments))
		for _, entity := range financeInvoicingStore.payments {
			if invoiceFilter != "" && entity.InvoiceID != invoiceFilter {
				continue
			}
			out = append(out, entity)
		}
		respondJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req struct {
			InvoiceID  string  `json:"invoice_id"`
			Amount     float64 `json:"amount"`
			Method     string  `json:"method"`
			ExternalID string  `json:"external_id"`
			Note       string  `json:"note"`
			PaidAt     string  `json:"paid_at"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.InvoiceID == "" || req.Amount <= 0 {
			respondError(w, http.StatusBadRequest, "invoice_id and positive amount are required")
			return
		}

		financeInvoicingStore.Lock()
		defer financeInvoicingStore.Unlock()

		invoiceIndex := findInvoiceIndex(req.InvoiceID)
		if invoiceIndex < 0 {
			respondError(w, http.StatusNotFound, "invoice not found")
			return
		}
		invoice := financeInvoicingStore.invoices[invoiceIndex]
		if invoice.Status == "cancelled" {
			respondError(w, http.StatusConflict, "cannot pay cancelled invoice")
			return
		}

		paidAt := time.Now().UTC()
		if strings.TrimSpace(req.PaidAt) != "" {
			if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(req.PaidAt)); err == nil {
				paidAt = parsed.UTC()
			}
		}

		financeInvoicingStore.paymentSeq++
		entity := payment{
			ID:         fmt.Sprintf("pay-%05d", financeInvoicingStore.paymentSeq),
			InvoiceID:  req.InvoiceID,
			Amount:     round2(req.Amount),
			Method:     strings.ToLower(defaultValue(req.Method, "bank_transfer")),
			ExternalID: strings.TrimSpace(req.ExternalID),
			Note:       strings.TrimSpace(req.Note),
			PaidAt:     paidAt,
			CreatedAt:  time.Now().UTC(),
		}
		financeInvoicingStore.payments = append(financeInvoicingStore.payments, entity)
		invoice.PaidAmount = round2(invoice.PaidAmount + entity.Amount)
		if invoice.PaidAmount >= invoice.Amount {
			invoice.PaidAmount = invoice.Amount
			invoice.Status = "paid"
		} else {
			invoice.Status = "partially_paid"
		}
		invoice.UpdatedAt = time.Now().UTC()
		financeInvoicingStore.invoices[invoiceIndex] = invoice
		appendInvoicingEvent("PaymentReceived", entity.ID, map[string]any{
			"invoice_id": entity.InvoiceID,
			"amount":     entity.Amount,
			"method":     entity.Method,
		})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func reconcileHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Source   string `json:"source"`
		Payments []struct {
			ExternalID string  `json:"external_id"`
			InvoiceID  string  `json:"invoice_id"`
			Amount     float64 `json:"amount"`
			Method     string  `json:"method"`
			PaidAt     string  `json:"paid_at"`
		} `json:"payments"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(req.Payments) == 0 {
		respondError(w, http.StatusBadRequest, "payments are required")
		return
	}

	financeInvoicingStore.Lock()
	defer financeInvoicingStore.Unlock()
	result := reconciliationResult{
		Payments: make([]payment, 0),
		Errors:   make([]string, 0),
	}
	for _, incoming := range req.Payments {
		if strings.TrimSpace(incoming.InvoiceID) == "" || incoming.Amount <= 0 {
			result.Skipped++
			result.Errors = append(result.Errors, "invalid payment payload")
			continue
		}
		if incoming.ExternalID != "" && hasPaymentByExternalID(incoming.ExternalID) {
			result.Skipped++
			continue
		}
		invoiceIndex := findInvoiceIndex(incoming.InvoiceID)
		if invoiceIndex < 0 {
			result.Skipped++
			result.Errors = append(result.Errors, fmt.Sprintf("invoice not found: %s", incoming.InvoiceID))
			continue
		}
		paidAt := time.Now().UTC()
		if strings.TrimSpace(incoming.PaidAt) != "" {
			if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(incoming.PaidAt)); err == nil {
				paidAt = parsed.UTC()
			}
		}
		financeInvoicingStore.paymentSeq++
		entity := payment{
			ID:         fmt.Sprintf("pay-%05d", financeInvoicingStore.paymentSeq),
			InvoiceID:  incoming.InvoiceID,
			Amount:     round2(incoming.Amount),
			Method:     strings.ToLower(defaultValue(incoming.Method, "bank_transfer")),
			ExternalID: strings.TrimSpace(incoming.ExternalID),
			Note:       "reconciled from " + defaultValue(strings.TrimSpace(req.Source), "external-source"),
			PaidAt:     paidAt,
			CreatedAt:  time.Now().UTC(),
		}
		financeInvoicingStore.payments = append(financeInvoicingStore.payments, entity)
		result.Payments = append(result.Payments, entity)
		result.Matched++

		invoice := financeInvoicingStore.invoices[invoiceIndex]
		invoice.PaidAmount = round2(invoice.PaidAmount + entity.Amount)
		if invoice.PaidAmount >= invoice.Amount {
			invoice.PaidAmount = invoice.Amount
			invoice.Status = "paid"
		} else {
			invoice.Status = "partially_paid"
		}
		invoice.UpdatedAt = time.Now().UTC()
		financeInvoicingStore.invoices[invoiceIndex] = invoice
		appendInvoicingEvent("PaymentReconciled", entity.ID, map[string]any{
			"invoice_id": entity.InvoiceID,
			"amount":     entity.Amount,
			"source":     req.Source,
		})
	}
	respondJSON(w, http.StatusOK, result)
}

func summaryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	financeInvoicingStore.RLock()
	defer financeInvoicingStore.RUnlock()

	arOpen := 0.0
	apOpen := 0.0
	arPaid := 0.0
	apPaid := 0.0
	overdue := 0
	for _, entity := range financeInvoicingStore.invoices {
		openAmount := round2(entity.Amount - entity.PaidAmount)
		if entity.Kind == "ap" {
			if openAmount > 0 {
				apOpen += openAmount
			}
			apPaid += entity.PaidAmount
		} else {
			if openAmount > 0 {
				arOpen += openAmount
			}
			arPaid += entity.PaidAmount
		}
		if entity.Status == "overdue" {
			overdue++
		}
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"ar_open":      round2(arOpen),
		"ap_open":      round2(apOpen),
		"ar_paid":      round2(arPaid),
		"ap_paid":      round2(apPaid),
		"overdue_docs": overdue,
		"invoices":     len(financeInvoicingStore.invoices),
		"payments":     len(financeInvoicingStore.payments),
	})
}

func eventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	financeInvoicingStore.RLock()
	defer financeInvoicingStore.RUnlock()
	out := append([]invoicingEvent(nil), financeInvoicingStore.events...)
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	respondJSON(w, http.StatusOK, out)
}

func findInvoiceIndex(id string) int {
	for i := range financeInvoicingStore.invoices {
		if financeInvoicingStore.invoices[i].ID == id {
			return i
		}
	}
	return -1
}

func hasPaymentByExternalID(externalID string) bool {
	for _, entity := range financeInvoicingStore.payments {
		if entity.ExternalID == externalID {
			return true
		}
	}
	return false
}

func buildInvoiceNumber(kind string, seq int) string {
	prefix := "AR"
	if kind == "ap" {
		prefix = "AP"
	}
	return fmt.Sprintf("%s-%05d", prefix, seq)
}

func isAllowedInvoiceKind(kind string) bool {
	return kind == "ar" || kind == "ap"
}

func isAllowedInvoiceStatus(status string) bool {
	switch status {
	case "draft", "issued", "partially_paid", "paid", "overdue", "cancelled", "disputed":
		return true
	default:
		return false
	}
}

func isAllowedInvoiceTransition(from, to string) bool {
	if from == to {
		return true
	}
	allowed := map[string]map[string]bool{
		"draft":          {"issued": true, "cancelled": true},
		"issued":         {"partially_paid": true, "paid": true, "overdue": true, "cancelled": true, "disputed": true},
		"partially_paid": {"paid": true, "overdue": true, "disputed": true},
		"overdue":        {"partially_paid": true, "paid": true, "disputed": true},
		"disputed":       {"issued": true, "cancelled": true},
	}
	return allowed[from][to]
}

func appendInvoicingEvent(eventType, entityID string, payload map[string]any) {
	financeInvoicingStore.eventSeq++
	financeInvoicingStore.events = append(financeInvoicingStore.events, invoicingEvent{
		ID:        fmt.Sprintf("fie-%05d", financeInvoicingStore.eventSeq),
		EventType: eventType,
		EntityID:  entityID,
		Payload:   payload,
		CreatedAt: time.Now().UTC(),
	})
}

func resetFinanceInvoicingStoreLocked() {
	financeInvoicingStore.invoiceSeq = 0
	financeInvoicingStore.paymentSeq = 0
	financeInvoicingStore.eventSeq = 0
	financeInvoicingStore.invoices = nil
	financeInvoicingStore.payments = nil
	financeInvoicingStore.events = nil
}

func resolveInvoiceCreatedAt(raw string, fallback time.Time) (time.Time, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fallback, nil
	}
	if !isFinanceInvoicingDevSeedEnabled() {
		return time.Time{}, fmt.Errorf("created_at is allowed only when %s=true", financeInvoicingDevSeedEnvKey)
	}
	parsed, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return time.Time{}, fmt.Errorf("created_at must be RFC3339")
	}
	return parsed.UTC(), nil
}

func resolveInvoiceNumber(raw, kind string, seq int) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return buildInvoiceNumber(kind, seq), nil
	}
	if !isFinanceInvoicingDevSeedEnabled() {
		return "", fmt.Errorf("number is allowed only when %s=true", financeInvoicingDevSeedEnvKey)
	}
	if len(trimmed) > 64 {
		return "", fmt.Errorf("number is too long")
	}
	return trimmed, nil
}

func isFinanceInvoicingDevSeedEnabled() bool {
	raw := strings.TrimSpace(os.Getenv(financeInvoicingDevSeedEnvKey))
	if raw == "" {
		return false
	}
	enabled, err := strconv.ParseBool(raw)
	if err == nil {
		return enabled
	}
	switch strings.ToLower(raw) {
	case "yes", "on":
		return true
	default:
		return false
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "finance-invoicing",
		"status":  "ok",
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "finance-invoicing",
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

func defaultValue(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}

func round2(value float64) float64 {
	return math.Round(value*100) / 100
}
