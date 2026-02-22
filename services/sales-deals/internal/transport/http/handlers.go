package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

type deal struct {
	ID                   string    `json:"id"`
	ClientID             string    `json:"client_id"`
	OwnerID              string    `json:"owner_id"`
	VehicleVIN           string    `json:"vehicle_vin"`
	Amount               float64   `json:"amount"`
	PaidAmount           float64   `json:"paid_amount"`
	Stage                string    `json:"stage"`
	Status               string    `json:"status"`
	PaymentStatus        string    `json:"payment_status"`
	DeliveryStatus       string    `json:"delivery_status"`
	ReservedVIN          string    `json:"reserved_vin,omitempty"`
	ReservedAt           string    `json:"reserved_at,omitempty"`
	ReservationExpiresAt string    `json:"reservation_expires_at,omitempty"`
	LastModifiedAt       time.Time `json:"last_modified_at"`
}

type sagaStep struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Note   string `json:"note,omitempty"`
}

type dealAuditEvent struct {
	ID        string         `json:"id"`
	ActorID   string         `json:"actor_id"`
	Action    string         `json:"action"`
	ObjectID  string         `json:"object_id"`
	Before    map[string]any `json:"before,omitempty"`
	After     map[string]any `json:"after,omitempty"`
	TraceID   string         `json:"trace_id,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

type accessContext struct {
	UserID string
	Roles  map[string]bool
}

type salePayment struct {
	ID            string    `json:"id"`
	DealID        string    `json:"deal_id"`
	Amount        float64   `json:"amount"`
	Method        string    `json:"method"`
	Reference     string    `json:"reference,omitempty"`
	ReceiptNumber string    `json:"receipt_number,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

type dealDomainEvent struct {
	ID        string         `json:"id"`
	EventType string         `json:"event_type"`
	DealID    string         `json:"deal_id"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

var salesDealsStore = struct {
	sync.RWMutex
	seq        int
	paymentSeq int
	deals      []deal
	payments   []salePayment
}{}

var salesDealsAuditStore = struct {
	sync.RWMutex
	seq    int
	events []dealAuditEvent
}{}

var salesDealsDomainEventStore = struct {
	sync.RWMutex
	seq    int
	events []dealDomainEvent
}{}

var allowedDealStageTransitions = map[string]map[string]bool{
	"new": {
		"qualified": true,
		"lost":      true,
	},
	"qualified": {
		"vehicle_reserved": true,
		"lost":             true,
	},
	"vehicle_reserved": {
		"contract_issued": true,
		"lost":            true,
	},
	"contract_issued": {
		"invoice_issued": true,
		"lost":           true,
	},
	"invoice_issued": {
		"payment_pending": true,
		"paid":            true,
		"lost":            true,
	},
	"payment_pending": {
		"paid": true,
		"lost": true,
	},
	"paid": {
		"delivered": true,
	},
	"delivered": {
		"closed": true,
	},
	"closed": {},
	"lost":   {},
}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)

	mux.HandleFunc("/deals", dealsHandler)
	mux.HandleFunc("/deals/", dealActionHandler)
	mux.HandleFunc("/payments", paymentsHandler)
	mux.HandleFunc("/events", dealEventsHandler)
	mux.HandleFunc("/audit/trail", dealsAuditTrailHandler)
}

func dealsHandler(w http.ResponseWriter, r *http.Request) {
	access := readAccessContext(r)

	switch r.Method {
	case http.MethodGet:
		if !hasAnyRole(access, "platform_admin", "sales_manager", "sales_agent") {
			respondError(w, http.StatusForbidden, "rbac: role is not allowed for deals read")
			return
		}

		salesDealsStore.RLock()
		defer salesDealsStore.RUnlock()
		if hasAnyRole(access, "platform_admin", "sales_manager") {
			respondJSON(w, http.StatusOK, salesDealsStore.deals)
			return
		}

		// Object-level access for sales_agent: only own deals.
		filtered := make([]deal, 0)
		for _, d := range salesDealsStore.deals {
			if d.OwnerID == access.UserID {
				filtered = append(filtered, d)
			}
		}
		respondJSON(w, http.StatusOK, filtered)
	case http.MethodPost:
		if !hasAnyRole(access, "platform_admin", "sales_manager", "sales_agent") {
			respondError(w, http.StatusForbidden, "rbac: role is not allowed for deals create")
			return
		}

		var req struct {
			ClientID   string  `json:"client_id"`
			OwnerID    string  `json:"owner_id"`
			VehicleVIN string  `json:"vehicle_vin"`
			Amount     float64 `json:"amount"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.ClientID == "" {
			respondError(w, http.StatusBadRequest, "client_id is required")
			return
		}

		ownerID := req.OwnerID
		if ownerID == "" {
			ownerID = access.UserID
		}
		if ownerID == "" {
			respondError(w, http.StatusBadRequest, "owner_id is required (or provide X-User-ID)")
			return
		}

		if hasAnyRole(access, "sales_agent") && !hasAnyRole(access, "platform_admin", "sales_manager") && ownerID != access.UserID {
			respondError(w, http.StatusForbidden, "rbac: sales_agent can create only own deals")
			return
		}

		salesDealsStore.Lock()
		defer salesDealsStore.Unlock()
		salesDealsStore.seq++
		entity := deal{
			ID:             fmt.Sprintf("dl-%04d", salesDealsStore.seq),
			ClientID:       req.ClientID,
			OwnerID:        ownerID,
			VehicleVIN:     req.VehicleVIN,
			Amount:         req.Amount,
			PaidAmount:     0,
			Stage:          "new",
			Status:         "open",
			PaymentStatus:  "unpaid",
			DeliveryStatus: "pending",
			LastModifiedAt: time.Now().UTC(),
		}
		salesDealsStore.deals = append(salesDealsStore.deals, entity)
		appendDealAuditEvent(
			defaultValue(access.UserID, "system"),
			"create_deal",
			entity.ID,
			nil,
			snapshotDeal(entity),
			strings.TrimSpace(r.Header.Get("X-Trace-ID")),
		)
		appendDealDomainEvent("DealCreated", entity.ID, map[string]any{
			"client_id":   entity.ClientID,
			"owner_id":    entity.OwnerID,
			"vehicle_vin": entity.VehicleVIN,
			"amount":      entity.Amount,
		})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func dealActionHandler(w http.ResponseWriter, r *http.Request) {
	path := strings.Trim(r.URL.Path, "/")
	parts := strings.Split(path, "/")
	if len(parts) != 3 || parts[0] != "deals" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}

	dealID := parts[1]
	action := parts[2]

	switch action {
	case "stages":
		updateStageHandler(w, r, dealID)
	case "reserve-vehicle":
		reserveVehicleHandler(w, r, dealID)
	case "payments":
		recordPaymentHandler(w, r, dealID)
	case "close":
		closeDealSagaHandler(w, r, dealID)
	default:
		respondError(w, http.StatusNotFound, "route not found")
	}
}

func dealsAuditTrailHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	salesDealsAuditStore.RLock()
	defer salesDealsAuditStore.RUnlock()
	respondJSON(w, http.StatusOK, salesDealsAuditStore.events)
}

func paymentsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	access := readAccessContext(r)
	if !hasAnyRole(access, "platform_admin", "sales_manager", "sales_agent") {
		respondError(w, http.StatusForbidden, "rbac: role is not allowed for payments read")
		return
	}

	salesDealsStore.RLock()
	defer salesDealsStore.RUnlock()
	dealIDFilter := strings.TrimSpace(r.URL.Query().Get("deal_id"))
	filtered := make([]salePayment, 0)
	for _, payment := range salesDealsStore.payments {
		if dealIDFilter != "" && payment.DealID != dealIDFilter {
			continue
		}
		if hasAnyRole(access, "platform_admin", "sales_manager") {
			filtered = append(filtered, payment)
			continue
		}
		if dealIndex := findDealIndex(payment.DealID); dealIndex >= 0 && salesDealsStore.deals[dealIndex].OwnerID == access.UserID {
			filtered = append(filtered, payment)
		}
	}
	respondJSON(w, http.StatusOK, filtered)
}

func dealEventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	salesDealsDomainEventStore.RLock()
	defer salesDealsDomainEventStore.RUnlock()
	eventTypeFilter := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("event_type")))
	if eventTypeFilter == "" {
		respondJSON(w, http.StatusOK, salesDealsDomainEventStore.events)
		return
	}

	filtered := make([]dealDomainEvent, 0)
	for _, event := range salesDealsDomainEventStore.events {
		if strings.ToLower(event.EventType) == eventTypeFilter {
			filtered = append(filtered, event)
		}
	}
	respondJSON(w, http.StatusOK, filtered)
}

func updateStageHandler(w http.ResponseWriter, r *http.Request, dealID string) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		Stage string `json:"stage"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Stage == "" {
		respondError(w, http.StatusBadRequest, "stage is required")
		return
	}

	salesDealsStore.Lock()
	defer salesDealsStore.Unlock()
	index := findDealIndex(dealID)
	if index < 0 {
		respondError(w, http.StatusNotFound, "deal not found")
		return
	}
	if !canWriteDeal(readAccessContext(r), salesDealsStore.deals[index]) {
		respondError(w, http.StatusForbidden, "rbac: endpoint/object access denied")
		return
	}

	before := snapshotDeal(salesDealsStore.deals[index])
	stage := normalizeDealStage(req.Stage)
	if !isAllowedStageTransition(salesDealsStore.deals[index].Stage, stage) {
		respondError(w, http.StatusBadRequest, "invalid stage transition")
		return
	}

	salesDealsStore.deals[index].Stage = stage
	if stage == "closed" {
		salesDealsStore.deals[index].Status = "won"
	}
	if stage == "lost" {
		salesDealsStore.deals[index].Status = "lost"
	}
	if stage == "payment_pending" && salesDealsStore.deals[index].PaymentStatus == "unpaid" {
		salesDealsStore.deals[index].PaymentStatus = "pending"
	}
	if stage == "paid" {
		salesDealsStore.deals[index].PaidAmount = salesDealsStore.deals[index].Amount
		salesDealsStore.deals[index].PaymentStatus = "paid"
		appendDealDomainEvent("SalePaid", salesDealsStore.deals[index].ID, map[string]any{
			"amount": salesDealsStore.deals[index].Amount,
		})
	}
	if stage == "delivered" {
		salesDealsStore.deals[index].DeliveryStatus = "delivered"
		appendDealDomainEvent("VehicleDelivered", salesDealsStore.deals[index].ID, map[string]any{
			"vin": salesDealsStore.deals[index].VehicleVIN,
		})
	}
	if stage == "contract_issued" {
		appendDealDomainEvent("ContractIssued", salesDealsStore.deals[index].ID, map[string]any{
			"client_id": salesDealsStore.deals[index].ClientID,
		})
	}
	salesDealsStore.deals[index].LastModifiedAt = time.Now().UTC()
	appendDealAuditEvent(
		defaultValue(readAccessContext(r).UserID, "system"),
		"update_status",
		salesDealsStore.deals[index].ID,
		before,
		snapshotDeal(salesDealsStore.deals[index]),
		strings.TrimSpace(r.Header.Get("X-Trace-ID")),
	)
	respondJSON(w, http.StatusOK, salesDealsStore.deals[index])
}

func reserveVehicleHandler(w http.ResponseWriter, r *http.Request, dealID string) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		VIN        string `json:"vin"`
		TTLMinutes int    `json:"ttl_minutes"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.VIN == "" {
		respondError(w, http.StatusBadRequest, "vin is required")
		return
	}

	salesDealsStore.Lock()
	defer salesDealsStore.Unlock()
	index := findDealIndex(dealID)
	if index < 0 {
		respondError(w, http.StatusNotFound, "deal not found")
		return
	}
	if !canWriteDeal(readAccessContext(r), salesDealsStore.deals[index]) {
		respondError(w, http.StatusForbidden, "rbac: endpoint/object access denied")
		return
	}

	before := snapshotDeal(salesDealsStore.deals[index])
	now := time.Now().UTC()
	ttlMinutes := defaultInt(req.TTLMinutes, 120)
	if ttlMinutes <= 0 || ttlMinutes > 14*24*60 {
		respondError(w, http.StatusBadRequest, "ttl_minutes must be in range 1..20160")
		return
	}
	if !isAllowedStageTransition(salesDealsStore.deals[index].Stage, "vehicle_reserved") {
		respondError(w, http.StatusBadRequest, "invalid stage transition")
		return
	}
	salesDealsStore.deals[index].ReservedVIN = req.VIN
	salesDealsStore.deals[index].ReservedAt = now.Format(time.RFC3339)
	salesDealsStore.deals[index].ReservationExpiresAt = now.Add(time.Duration(ttlMinutes) * time.Minute).Format(time.RFC3339)
	salesDealsStore.deals[index].Stage = "vehicle_reserved"
	salesDealsStore.deals[index].LastModifiedAt = now
	appendDealAuditEvent(
		defaultValue(readAccessContext(r).UserID, "system"),
		"reserve_vehicle",
		salesDealsStore.deals[index].ID,
		before,
		snapshotDeal(salesDealsStore.deals[index]),
		strings.TrimSpace(r.Header.Get("X-Trace-ID")),
	)
	appendDealDomainEvent("VehicleReserved", salesDealsStore.deals[index].ID, map[string]any{
		"vin":            req.VIN,
		"reservation_to": salesDealsStore.deals[index].ReservationExpiresAt,
	})

	respondJSON(w, http.StatusOK, salesDealsStore.deals[index])
}

func recordPaymentHandler(w http.ResponseWriter, r *http.Request, dealID string) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		Amount        float64 `json:"amount"`
		Method        string  `json:"method"`
		Reference     string  `json:"reference"`
		ReceiptNumber string  `json:"receipt_number"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Amount <= 0 {
		respondError(w, http.StatusBadRequest, "amount must be positive")
		return
	}

	salesDealsStore.Lock()
	defer salesDealsStore.Unlock()
	index := findDealIndex(dealID)
	if index < 0 {
		respondError(w, http.StatusNotFound, "deal not found")
		return
	}
	if !canWriteDeal(readAccessContext(r), salesDealsStore.deals[index]) {
		respondError(w, http.StatusForbidden, "rbac: endpoint/object access denied")
		return
	}

	before := snapshotDeal(salesDealsStore.deals[index])
	now := time.Now().UTC()
	salesDealsStore.paymentSeq++
	payment := salePayment{
		ID:            fmt.Sprintf("dpm-%05d", salesDealsStore.paymentSeq),
		DealID:        dealID,
		Amount:        req.Amount,
		Method:        defaultValue(req.Method, "bank_transfer"),
		Reference:     req.Reference,
		ReceiptNumber: req.ReceiptNumber,
		CreatedAt:     now,
	}
	salesDealsStore.payments = append(salesDealsStore.payments, payment)

	salesDealsStore.deals[index].PaidAmount += req.Amount
	if salesDealsStore.deals[index].PaidAmount >= salesDealsStore.deals[index].Amount {
		salesDealsStore.deals[index].PaidAmount = salesDealsStore.deals[index].Amount
		salesDealsStore.deals[index].PaymentStatus = "paid"
		if isAllowedStageTransition(salesDealsStore.deals[index].Stage, "paid") {
			salesDealsStore.deals[index].Stage = "paid"
		}
		appendDealDomainEvent("SalePaid", salesDealsStore.deals[index].ID, map[string]any{
			"amount":         req.Amount,
			"payment_method": payment.Method,
			"reference":      payment.Reference,
		})
	} else {
		salesDealsStore.deals[index].PaymentStatus = "partial"
		if isAllowedStageTransition(salesDealsStore.deals[index].Stage, "payment_pending") {
			salesDealsStore.deals[index].Stage = "payment_pending"
		}
	}
	salesDealsStore.deals[index].LastModifiedAt = now
	appendDealAuditEvent(
		defaultValue(readAccessContext(r).UserID, "system"),
		"record_payment",
		salesDealsStore.deals[index].ID,
		before,
		snapshotDeal(salesDealsStore.deals[index]),
		strings.TrimSpace(r.Header.Get("X-Trace-ID")),
	)

	respondJSON(w, http.StatusCreated, map[string]any{
		"payment": payment,
		"deal":    salesDealsStore.deals[index],
	})
}

func closeDealSagaHandler(w http.ResponseWriter, r *http.Request, dealID string) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		SimulateInventoryFailure bool `json:"simulate_inventory_failure"`
		SimulateFinanceFailure   bool `json:"simulate_finance_failure"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	salesDealsStore.Lock()
	defer salesDealsStore.Unlock()
	index := findDealIndex(dealID)
	if index < 0 {
		respondError(w, http.StatusNotFound, "deal not found")
		return
	}
	if !canWriteDeal(readAccessContext(r), salesDealsStore.deals[index]) {
		respondError(w, http.StatusForbidden, "rbac: endpoint/object access denied")
		return
	}

	steps := make([]sagaStep, 0, 4)
	entity := salesDealsStore.deals[index]
	before := snapshotDeal(entity)
	now := time.Now().UTC()

	if req.SimulateInventoryFailure {
		steps = append(steps, sagaStep{Name: "inventory.reserve", Status: "failed", Note: "inventory rejected reserve"})
		entity.Stage = "close_failed"
		entity.Status = "open"
		entity.LastModifiedAt = now
		salesDealsStore.deals[index] = entity
		appendDealAuditEvent(
			defaultValue(readAccessContext(r).UserID, "system"),
			"close",
			entity.ID,
			before,
			snapshotDeal(entity),
			strings.TrimSpace(r.Header.Get("X-Trace-ID")),
		)
		respondJSON(w, http.StatusOK, map[string]any{
			"saga":   "sales-close",
			"result": "failed",
			"steps":  steps,
			"deal":   entity,
		})
		return
	}

	entity.ReservedVIN = entity.VehicleVIN
	entity.ReservedAt = now.Format(time.RFC3339)
	entity.ReservationExpiresAt = now.Add(2 * time.Hour).Format(time.RFC3339)
	entity.Stage = "vehicle_reserved"
	steps = append(steps, sagaStep{Name: "inventory.reserve", Status: "completed"})
	appendDealDomainEvent("VehicleReserved", entity.ID, map[string]any{
		"vin":            entity.ReservedVIN,
		"reservation_to": entity.ReservationExpiresAt,
	})

	if req.SimulateFinanceFailure {
		steps = append(steps, sagaStep{Name: "finance.invoice", Status: "failed", Note: "finance timeout"})

		// Compensation: rollback inventory reservation.
		entity.ReservedVIN = ""
		entity.ReservedAt = ""
		entity.ReservationExpiresAt = ""
		entity.Stage = "compensated"
		entity.Status = "open"
		steps = append(steps, sagaStep{Name: "inventory.release", Status: "completed"})
		entity.LastModifiedAt = now
		salesDealsStore.deals[index] = entity
		appendDealAuditEvent(
			defaultValue(readAccessContext(r).UserID, "system"),
			"close",
			entity.ID,
			before,
			snapshotDeal(entity),
			strings.TrimSpace(r.Header.Get("X-Trace-ID")),
		)

		respondJSON(w, http.StatusOK, map[string]any{
			"saga":   "sales-close",
			"result": "compensated",
			"steps":  steps,
			"deal":   entity,
		})
		return
	}

	steps = append(steps, sagaStep{Name: "finance.invoice", Status: "completed"})
	steps = append(steps, sagaStep{Name: "inventory.commit", Status: "completed"})
	entity.Stage = "closed"
	entity.Status = "won"
	entity.PaidAmount = entity.Amount
	entity.PaymentStatus = "paid"
	entity.DeliveryStatus = "delivered"
	entity.LastModifiedAt = now
	salesDealsStore.deals[index] = entity
	appendDealDomainEvent("SalePaid", entity.ID, map[string]any{
		"amount": entity.Amount,
	})
	appendDealDomainEvent("VehicleDelivered", entity.ID, map[string]any{
		"vin": entity.VehicleVIN,
	})
	appendDealAuditEvent(
		defaultValue(readAccessContext(r).UserID, "system"),
		"close",
		entity.ID,
		before,
		snapshotDeal(entity),
		strings.TrimSpace(r.Header.Get("X-Trace-ID")),
	)

	respondJSON(w, http.StatusOK, map[string]any{
		"saga":   "sales-close",
		"result": "completed",
		"steps":  steps,
		"deal":   entity,
	})
}

func canWriteDeal(access accessContext, entity deal) bool {
	if hasAnyRole(access, "platform_admin", "sales_manager") {
		return true
	}
	if hasAnyRole(access, "sales_agent") {
		return access.UserID != "" && access.UserID == entity.OwnerID
	}
	return false
}

func readAccessContext(r *http.Request) accessContext {
	userID := strings.TrimSpace(r.Header.Get("X-User-ID"))
	rolesRaw := r.Header.Get("X-Role")
	if rolesRaw == "" {
		rolesRaw = r.Header.Get("X-Roles")
	}

	roles := map[string]bool{}
	for _, raw := range strings.Split(rolesRaw, ",") {
		role := strings.TrimSpace(strings.ToLower(raw))
		if role != "" {
			roles[role] = true
		}
	}
	return accessContext{
		UserID: userID,
		Roles:  roles,
	}
}

func hasAnyRole(access accessContext, allowed ...string) bool {
	for _, role := range allowed {
		if access.Roles[strings.ToLower(role)] {
			return true
		}
	}
	return false
}

func findDealIndex(id string) int {
	for i := range salesDealsStore.deals {
		if salesDealsStore.deals[i].ID == id {
			return i
		}
	}
	return -1
}

func appendDealAuditEvent(actorID, action, objectID string, before, after map[string]any, traceID string) {
	salesDealsAuditStore.Lock()
	defer salesDealsAuditStore.Unlock()
	salesDealsAuditStore.seq++
	salesDealsAuditStore.events = append(salesDealsAuditStore.events, dealAuditEvent{
		ID:        fmt.Sprintf("sda-%06d", salesDealsAuditStore.seq),
		ActorID:   actorID,
		Action:    action,
		ObjectID:  objectID,
		Before:    before,
		After:     after,
		TraceID:   traceID,
		CreatedAt: time.Now().UTC(),
	})
}

func appendDealDomainEvent(eventType, dealID string, payload map[string]any) {
	salesDealsDomainEventStore.Lock()
	defer salesDealsDomainEventStore.Unlock()
	salesDealsDomainEventStore.seq++
	salesDealsDomainEventStore.events = append(salesDealsDomainEventStore.events, dealDomainEvent{
		ID:        fmt.Sprintf("sde-%06d", salesDealsDomainEventStore.seq),
		EventType: eventType,
		DealID:    dealID,
		Payload:   payload,
		CreatedAt: time.Now().UTC(),
	})
}

func snapshotDeal(entity deal) map[string]any {
	raw, err := json.Marshal(entity)
	if err != nil {
		return map[string]any{}
	}

	out := map[string]any{}
	if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]any{}
	}
	return out
}

func defaultValue(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func defaultInt(value, fallback int) int {
	if value == 0 {
		return fallback
	}
	return value
}

func normalizeDealStage(stage string) string {
	normalized := strings.ToLower(strings.TrimSpace(stage))
	normalized = strings.ReplaceAll(normalized, "-", "_")
	normalized = strings.ReplaceAll(normalized, " ", "_")
	if normalized == "won" {
		return "closed"
	}
	return normalized
}

func isAllowedStageTransition(from, to string) bool {
	fromNorm := normalizeDealStage(from)
	toNorm := normalizeDealStage(to)
	if fromNorm == toNorm {
		return true
	}
	allowed, ok := allowedDealStageTransitions[fromNorm]
	if !ok {
		return false
	}
	return allowed[toNorm]
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "sales-deals",
		"status":  "ok",
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "sales-deals",
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
