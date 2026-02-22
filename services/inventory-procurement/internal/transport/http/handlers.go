package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

type procurementPolicy struct {
	SKU               string    `json:"sku"`
	MinQty            int       `json:"min_qty"`
	MaxQty            int       `json:"max_qty"`
	ReorderPoint      int       `json:"reorder_point"`
	PreferredSupplier string    `json:"preferred_supplier"`
	LeadTimeDays      int       `json:"lead_time_days"`
	UpdatedAt         time.Time `json:"updated_at"`
}

type procurementRequest struct {
	ID        string    `json:"id"`
	SKU       string    `json:"sku"`
	Quantity  int       `json:"quantity"`
	Reason    string    `json:"reason"`
	Priority  string    `json:"priority"`
	Source    string    `json:"source"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type purchaseOrder struct {
	ID            string    `json:"id"`
	RequestID     string    `json:"request_id"`
	Supplier      string    `json:"supplier"`
	Status        string    `json:"status"`
	ExpectedDate  string    `json:"expected_date"`
	CreatedAt     time.Time `json:"created_at"`
	LastUpdatedAt time.Time `json:"last_updated_at"`
}

type procurementEvent struct {
	ID        string         `json:"id"`
	EventType string         `json:"event_type"`
	EntityID  string         `json:"entity_id"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

var procurementStore = struct {
	sync.RWMutex
	requestSeq int
	orderSeq   int
	eventSeq   int
	policies   []procurementPolicy
	requests   []procurementRequest
	orders     []purchaseOrder
	events     []procurementEvent
}{
	policies: []procurementPolicy{
		{SKU: "PART-OIL", MinQty: 5, MaxQty: 30, ReorderPoint: 8, PreferredSupplier: "Best Parts", LeadTimeDays: 5, UpdatedAt: time.Now().UTC()},
		{SKU: "PART-FILTER", MinQty: 4, MaxQty: 25, ReorderPoint: 6, PreferredSupplier: "Filter Hub", LeadTimeDays: 7, UpdatedAt: time.Now().UTC()},
	},
}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)
	mux.HandleFunc("/procurement/policies", policiesHandler)
	mux.HandleFunc("/procurement/requests", requestsHandler)
	mux.HandleFunc("/procurement/requests/", requestStatusHandler)
	mux.HandleFunc("/purchase-orders", ordersHandler)
	mux.HandleFunc("/purchase-orders/", orderStatusHandler)
	mux.HandleFunc("/procurement/replenishment/run", replenishmentRunHandler)
	mux.HandleFunc("/events", procurementEventsHandler)
}

func policiesHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		procurementStore.RLock()
		defer procurementStore.RUnlock()
		respondJSON(w, http.StatusOK, procurementStore.policies)
	case http.MethodPost:
		var req procurementPolicy
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if strings.TrimSpace(req.SKU) == "" {
			respondError(w, http.StatusBadRequest, "sku is required")
			return
		}
		if req.MinQty < 0 || req.MaxQty < 0 || req.ReorderPoint < 0 || req.LeadTimeDays < 0 {
			respondError(w, http.StatusBadRequest, "policy values must be non-negative")
			return
		}
		if req.MaxQty > 0 && req.MinQty > req.MaxQty {
			respondError(w, http.StatusBadRequest, "min_qty cannot exceed max_qty")
			return
		}

		procurementStore.Lock()
		defer procurementStore.Unlock()
		req.SKU = strings.ToUpper(strings.TrimSpace(req.SKU))
		req.PreferredSupplier = strings.TrimSpace(req.PreferredSupplier)
		req.UpdatedAt = time.Now().UTC()
		index := findPolicyIndex(req.SKU)
		if index >= 0 {
			procurementStore.policies[index] = req
			appendProcurementEvent("ReplenishmentPolicyUpdated", req.SKU, map[string]any{"reorder_point": req.ReorderPoint, "max_qty": req.MaxQty})
			respondJSON(w, http.StatusOK, req)
			return
		}
		procurementStore.policies = append(procurementStore.policies, req)
		appendProcurementEvent("ReplenishmentPolicyCreated", req.SKU, map[string]any{"reorder_point": req.ReorderPoint, "max_qty": req.MaxQty})
		respondJSON(w, http.StatusCreated, req)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func requestsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		procurementStore.RLock()
		defer procurementStore.RUnlock()
		statusFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status")))
		skuFilter := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("sku")))
		out := make([]procurementRequest, 0, len(procurementStore.requests))
		for _, entity := range procurementStore.requests {
			if statusFilter != "" && strings.ToLower(entity.Status) != statusFilter {
				continue
			}
			if skuFilter != "" && entity.SKU != skuFilter {
				continue
			}
			out = append(out, entity)
		}
		respondJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req struct {
			SKU      string `json:"sku"`
			Quantity int    `json:"quantity"`
			Reason   string `json:"reason"`
			Priority string `json:"priority"`
			Source   string `json:"source"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if strings.TrimSpace(req.SKU) == "" || req.Quantity <= 0 {
			respondError(w, http.StatusBadRequest, "sku and positive quantity are required")
			return
		}

		procurementStore.Lock()
		defer procurementStore.Unlock()
		entity := createProcurementRequestLocked(
			strings.ToUpper(strings.TrimSpace(req.SKU)),
			req.Quantity,
			defaultValue(strings.TrimSpace(req.Reason), "manual request"),
			defaultValue(strings.ToLower(strings.TrimSpace(req.Priority)), "normal"),
			defaultValue(strings.ToLower(strings.TrimSpace(req.Source)), "manual"),
		)
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func requestStatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 4 || parts[0] != "procurement" || parts[1] != "requests" || parts[3] != "status" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}
	requestID := parts[2]

	var req struct {
		Status string `json:"status"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if !isAllowedRequestStatus(status) {
		respondError(w, http.StatusBadRequest, "unsupported status")
		return
	}

	procurementStore.Lock()
	defer procurementStore.Unlock()
	index := findRequestIndex(requestID)
	if index < 0 {
		respondError(w, http.StatusNotFound, "request not found")
		return
	}
	current := procurementStore.requests[index].Status
	if !isAllowedRequestTransition(current, status) {
		respondError(w, http.StatusConflict, "invalid status transition")
		return
	}
	procurementStore.requests[index].Status = status
	procurementStore.requests[index].UpdatedAt = time.Now().UTC()
	appendProcurementEvent("ProcurementRequestStatusChanged", procurementStore.requests[index].ID, map[string]any{"from": current, "to": status})
	respondJSON(w, http.StatusOK, procurementStore.requests[index])
}

func ordersHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		procurementStore.RLock()
		defer procurementStore.RUnlock()
		statusFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status")))
		out := make([]purchaseOrder, 0, len(procurementStore.orders))
		for _, entity := range procurementStore.orders {
			if statusFilter != "" && strings.ToLower(entity.Status) != statusFilter {
				continue
			}
			out = append(out, entity)
		}
		respondJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req struct {
			RequestID    string `json:"request_id"`
			Supplier     string `json:"supplier"`
			ExpectedDate string `json:"expected_date"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.RequestID == "" {
			respondError(w, http.StatusBadRequest, "request_id is required")
			return
		}

		now := time.Now().UTC()
		procurementStore.Lock()
		defer procurementStore.Unlock()
		requestIndex := findRequestIndex(req.RequestID)
		if requestIndex < 0 {
			respondError(w, http.StatusNotFound, "request not found")
			return
		}
		request := procurementStore.requests[requestIndex]
		if request.Status != "approved" && request.Status != "new" {
			respondError(w, http.StatusConflict, "request must be new or approved before PO creation")
			return
		}

		supplier := strings.TrimSpace(req.Supplier)
		if supplier == "" {
			policyIndex := findPolicyIndex(request.SKU)
			if policyIndex >= 0 {
				supplier = procurementStore.policies[policyIndex].PreferredSupplier
			}
		}
		supplier = defaultValue(supplier, "default-supplier")

		procurementStore.orderSeq++
		entity := purchaseOrder{
			ID:            fmt.Sprintf("po-%05d", procurementStore.orderSeq),
			RequestID:     req.RequestID,
			Supplier:      supplier,
			Status:        "created",
			ExpectedDate:  req.ExpectedDate,
			CreatedAt:     now,
			LastUpdatedAt: now,
		}
		procurementStore.orders = append(procurementStore.orders, entity)
		procurementStore.requests[requestIndex].Status = "ordered"
		procurementStore.requests[requestIndex].UpdatedAt = now
		appendProcurementEvent("PurchaseOrderCreated", entity.ID, map[string]any{"request_id": entity.RequestID, "supplier": entity.Supplier})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func orderStatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 3 || parts[0] != "purchase-orders" || parts[2] != "status" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}
	orderID := parts[1]

	var req struct {
		Status string `json:"status"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if !isAllowedOrderStatus(status) {
		respondError(w, http.StatusBadRequest, "unsupported status")
		return
	}

	procurementStore.Lock()
	defer procurementStore.Unlock()
	index := findOrderIndex(orderID)
	if index < 0 {
		respondError(w, http.StatusNotFound, "order not found")
		return
	}
	current := procurementStore.orders[index].Status
	if !isAllowedOrderTransition(current, status) {
		respondError(w, http.StatusConflict, "invalid status transition")
		return
	}
	procurementStore.orders[index].Status = status
	procurementStore.orders[index].LastUpdatedAt = time.Now().UTC()
	appendProcurementEvent("PurchaseOrderStatusChanged", procurementStore.orders[index].ID, map[string]any{"from": current, "to": status})
	respondJSON(w, http.StatusOK, procurementStore.orders[index])
}

func replenishmentRunHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		StockPositions []struct {
			SKU      string `json:"sku"`
			OnHand   int    `json:"on_hand"`
			Reserved int    `json:"reserved"`
		} `json:"stock_positions"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(req.StockPositions) == 0 {
		respondError(w, http.StatusBadRequest, "stock_positions are required")
		return
	}

	stockBySKU := map[string]struct{ OnHand, Reserved int }{}
	for _, position := range req.StockPositions {
		sku := strings.ToUpper(strings.TrimSpace(position.SKU))
		if sku == "" {
			continue
		}
		current := stockBySKU[sku]
		current.OnHand += position.OnHand
		current.Reserved += position.Reserved
		stockBySKU[sku] = current
	}

	procurementStore.Lock()
	defer procurementStore.Unlock()
	created := make([]procurementRequest, 0)
	for _, policy := range procurementStore.policies {
		position, ok := stockBySKU[policy.SKU]
		if !ok {
			continue
		}
		available := position.OnHand - position.Reserved
		if available > policy.ReorderPoint {
			continue
		}
		if hasOpenRequest(policy.SKU) {
			continue
		}
		target := policy.MaxQty
		if target == 0 {
			target = maxInt(policy.ReorderPoint*2, policy.MinQty*2)
		}
		qty := maxInt(target-available, 0)
		if qty == 0 {
			continue
		}
		created = append(created, createProcurementRequestLocked(policy.SKU, qty, "replenishment run", "normal", "auto-replenishment"))
	}
	respondJSON(w, http.StatusOK, map[string]any{"created": created, "count": len(created)})
}

func procurementEventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	procurementStore.RLock()
	defer procurementStore.RUnlock()
	respondJSON(w, http.StatusOK, procurementStore.events)
}

func createProcurementRequestLocked(sku string, qty int, reason, priority, source string) procurementRequest {
	procurementStore.requestSeq++
	now := time.Now().UTC()
	entity := procurementRequest{
		ID:        fmt.Sprintf("pr-%04d", procurementStore.requestSeq),
		SKU:       sku,
		Quantity:  qty,
		Reason:    reason,
		Priority:  priority,
		Source:    source,
		Status:    "new",
		CreatedAt: now,
		UpdatedAt: now,
	}
	procurementStore.requests = append(procurementStore.requests, entity)
	appendProcurementEvent("ProcurementRequestCreated", entity.ID, map[string]any{"sku": entity.SKU, "quantity": entity.Quantity, "source": entity.Source})
	return entity
}

func findPolicyIndex(sku string) int {
	for i := range procurementStore.policies {
		if procurementStore.policies[i].SKU == sku {
			return i
		}
	}
	return -1
}

func findRequestIndex(id string) int {
	for i := range procurementStore.requests {
		if procurementStore.requests[i].ID == id {
			return i
		}
	}
	return -1
}

func findOrderIndex(id string) int {
	for i := range procurementStore.orders {
		if procurementStore.orders[i].ID == id {
			return i
		}
	}
	return -1
}

func hasOpenRequest(sku string) bool {
	for _, request := range procurementStore.requests {
		if request.SKU != sku {
			continue
		}
		if request.Status == "new" || request.Status == "approved" || request.Status == "ordered" {
			return true
		}
	}
	return false
}

func appendProcurementEvent(eventType, entityID string, payload map[string]any) {
	procurementStore.eventSeq++
	procurementStore.events = append(procurementStore.events, procurementEvent{
		ID:        fmt.Sprintf("ipe-%05d", procurementStore.eventSeq),
		EventType: eventType,
		EntityID:  entityID,
		Payload:   payload,
		CreatedAt: time.Now().UTC(),
	})
}

func isAllowedRequestStatus(status string) bool {
	switch status {
	case "new", "approved", "ordered", "closed", "cancelled":
		return true
	default:
		return false
	}
}

func isAllowedRequestTransition(from, to string) bool {
	if from == to {
		return true
	}
	allowed := map[string]map[string]bool{
		"new":      {"approved": true, "cancelled": true},
		"approved": {"ordered": true, "cancelled": true},
		"ordered":  {"closed": true},
	}
	return allowed[from][to]
}

func isAllowedOrderStatus(status string) bool {
	switch status {
	case "created", "sent", "partially_received", "received", "cancelled":
		return true
	default:
		return false
	}
}

func isAllowedOrderTransition(from, to string) bool {
	if from == to {
		return true
	}
	allowed := map[string]map[string]bool{
		"created":            {"sent": true, "cancelled": true},
		"sent":               {"partially_received": true, "received": true, "cancelled": true},
		"partially_received": {"received": true},
	}
	return allowed[from][to]
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "inventory-procurement",
		"status":  "ok",
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "inventory-procurement",
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
