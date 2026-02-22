package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

type receiptLine struct {
	ID          string `json:"id"`
	SKU         string `json:"sku"`
	ExpectedQty int    `json:"expected_qty"`
	ReceivedQty int    `json:"received_qty"`
	AcceptedQty int    `json:"accepted_qty"`
	Location    string `json:"location"`
}

type receipt struct {
	ID            string        `json:"id"`
	PurchaseOrder string        `json:"purchase_order"`
	InvoiceNumber string        `json:"invoice_number"`
	Warehouse     string        `json:"warehouse"`
	Status        string        `json:"status"`
	Lines         []receiptLine `json:"lines,omitempty"`
	Discrepancies int           `json:"discrepancies"`
	CreatedAt     time.Time     `json:"created_at"`
	UpdatedAt     time.Time     `json:"updated_at"`
}

type discrepancy struct {
	ID          string    `json:"id"`
	ReceiptID   string    `json:"receipt_id"`
	SKU         string    `json:"sku"`
	ExpectedQty int       `json:"expected_qty"`
	ActualQty   int       `json:"actual_qty"`
	Reason      string    `json:"reason"`
	Resolution  string    `json:"resolution"`
	CreatedAt   time.Time `json:"created_at"`
}

type warehouseTask struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"`
	Warehouse string    `json:"warehouse"`
	SKU       string    `json:"sku"`
	Quantity  int       `json:"quantity"`
	SourceBin string    `json:"source_bin,omitempty"`
	TargetBin string    `json:"target_bin,omitempty"`
	Reference string    `json:"reference,omitempty"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type receivingEvent struct {
	ID        string         `json:"id"`
	EventType string         `json:"event_type"`
	EntityID  string         `json:"entity_id"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

var receivingStore = struct {
	sync.RWMutex
	receiptSeq     int
	lineSeq        int
	discrepancySeq int
	taskSeq        int
	eventSeq       int
	receipts       []receipt
	discrepancies  []discrepancy
	tasks          []warehouseTask
	events         []receivingEvent
}{
	receipts: []receipt{
		{
			ID:            "rc-00001",
			PurchaseOrder: "po-00001",
			InvoiceNumber: "inv-001",
			Warehouse:     "main",
			Status:        "receiving",
			Lines: []receiptLine{
				{ID: "rl-00001", SKU: "PART-OIL", ExpectedQty: 10, ReceivedQty: 10, AcceptedQty: 10, Location: "A-01"},
			},
			Discrepancies: 0,
			CreatedAt:     time.Now().UTC(),
			UpdatedAt:     time.Now().UTC(),
		},
	},
}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)
	mux.HandleFunc("/receipts", receiptsHandler)
	mux.HandleFunc("/receipts/", receiptDiscrepancyHandler)
	mux.HandleFunc("/warehouse/tasks", warehouseTasksHandler)
	mux.HandleFunc("/warehouse/tasks/", warehouseTaskStatusHandler)
	mux.HandleFunc("/events", receivingEventsHandler)
}

func receiptsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		receivingStore.RLock()
		defer receivingStore.RUnlock()
		statusFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status")))
		warehouseFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("warehouse")))
		poFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("purchase_order")))
		out := make([]receipt, 0, len(receivingStore.receipts))
		for _, entity := range receivingStore.receipts {
			if statusFilter != "" && strings.ToLower(entity.Status) != statusFilter {
				continue
			}
			if warehouseFilter != "" && strings.ToLower(entity.Warehouse) != warehouseFilter {
				continue
			}
			if poFilter != "" && strings.ToLower(entity.PurchaseOrder) != poFilter {
				continue
			}
			out = append(out, entity)
		}
		respondJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req struct {
			PurchaseOrder string `json:"purchase_order"`
			InvoiceNumber string `json:"invoice_number"`
			Warehouse     string `json:"warehouse"`
			Lines         []struct {
				SKU         string `json:"sku"`
				ExpectedQty int    `json:"expected_qty"`
				ReceivedQty int    `json:"received_qty"`
				AcceptedQty int    `json:"accepted_qty"`
				Location    string `json:"location"`
			} `json:"lines"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.PurchaseOrder == "" {
			respondError(w, http.StatusBadRequest, "purchase_order is required")
			return
		}

		receivingStore.Lock()
		defer receivingStore.Unlock()
		receivingStore.receiptSeq++
		now := time.Now().UTC()
		entity := receipt{
			ID:            fmt.Sprintf("rc-%05d", receivingStore.receiptSeq),
			PurchaseOrder: strings.TrimSpace(req.PurchaseOrder),
			InvoiceNumber: strings.TrimSpace(req.InvoiceNumber),
			Warehouse:     defaultValue(strings.ToLower(strings.TrimSpace(req.Warehouse)), "main"),
			Status:        "draft",
			CreatedAt:     now,
			UpdatedAt:     now,
		}
		if len(req.Lines) > 0 {
			entity.Status = "receiving"
			entity.Lines = make([]receiptLine, 0, len(req.Lines))
			for _, line := range req.Lines {
				if strings.TrimSpace(line.SKU) == "" || line.ExpectedQty <= 0 {
					continue
				}
				receivingStore.lineSeq++
				received := maxInt(line.ReceivedQty, 0)
				accepted := maxInt(line.AcceptedQty, 0)
				if accepted == 0 {
					accepted = received
				}
				if accepted > received {
					accepted = received
				}
				entity.Lines = append(entity.Lines, receiptLine{
					ID:          fmt.Sprintf("rl-%05d", receivingStore.lineSeq),
					SKU:         strings.ToUpper(strings.TrimSpace(line.SKU)),
					ExpectedQty: line.ExpectedQty,
					ReceivedQty: received,
					AcceptedQty: accepted,
					Location:    defaultValue(strings.ToUpper(strings.TrimSpace(line.Location)), "A-01"),
				})
			}
		}
		receivingStore.receipts = append(receivingStore.receipts, entity)
		appendReceivingEvent("ReceiptCreated", entity.ID, map[string]any{
			"purchase_order": entity.PurchaseOrder,
			"warehouse":      entity.Warehouse,
		})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func receiptDiscrepancyHandler(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 2 || parts[0] != "receipts" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}
	receiptID := parts[1]

	if len(parts) == 2 && r.Method == http.MethodGet {
		receivingStore.RLock()
		defer receivingStore.RUnlock()
		index := findReceiptIndex(receiptID)
		if index < 0 {
			respondError(w, http.StatusNotFound, "receipt not found")
			return
		}
		respondJSON(w, http.StatusOK, receivingStore.receipts[index])
		return
	}

	if len(parts) != 3 {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}

	switch parts[2] {
	case "lines":
		receiptLinesHandler(w, r, receiptID)
	case "status":
		receiptStatusHandler(w, r, receiptID)
	case "discrepancy":
		receiptDiscrepancyCreateHandler(w, r, receiptID)
	default:
		respondError(w, http.StatusNotFound, "route not found")
	}
}

func receiptLinesHandler(w http.ResponseWriter, r *http.Request, receiptID string) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Lines []struct {
			SKU         string `json:"sku"`
			ExpectedQty int    `json:"expected_qty"`
			ReceivedQty int    `json:"received_qty"`
			AcceptedQty int    `json:"accepted_qty"`
			Location    string `json:"location"`
		} `json:"lines"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(req.Lines) == 0 {
		respondError(w, http.StatusBadRequest, "lines are required")
		return
	}

	receivingStore.Lock()
	defer receivingStore.Unlock()
	index := findReceiptIndex(receiptID)
	if index < 0 {
		respondError(w, http.StatusNotFound, "receipt not found")
		return
	}
	entity := receivingStore.receipts[index]
	if entity.Status == "closed" || entity.Status == "cancelled" {
		respondError(w, http.StatusConflict, "cannot modify closed/cancelled receipt")
		return
	}

	for _, line := range req.Lines {
		sku := strings.ToUpper(strings.TrimSpace(line.SKU))
		if sku == "" || line.ExpectedQty <= 0 {
			respondError(w, http.StatusBadRequest, "sku and positive expected_qty are required")
			return
		}
		received := maxInt(line.ReceivedQty, 0)
		accepted := maxInt(line.AcceptedQty, 0)
		if accepted == 0 {
			accepted = received
		}
		if accepted > received {
			respondError(w, http.StatusBadRequest, "accepted_qty cannot exceed received_qty")
			return
		}
		location := defaultValue(strings.ToUpper(strings.TrimSpace(line.Location)), "A-01")
		lineIndex := findReceiptLineIndex(entity, sku, location)
		if lineIndex >= 0 {
			entity.Lines[lineIndex].ExpectedQty += line.ExpectedQty
			entity.Lines[lineIndex].ReceivedQty += received
			entity.Lines[lineIndex].AcceptedQty += accepted
			continue
		}
		receivingStore.lineSeq++
		entity.Lines = append(entity.Lines, receiptLine{
			ID:          fmt.Sprintf("rl-%05d", receivingStore.lineSeq),
			SKU:         sku,
			ExpectedQty: line.ExpectedQty,
			ReceivedQty: received,
			AcceptedQty: accepted,
			Location:    location,
		})
	}

	sort.Slice(entity.Lines, func(i, j int) bool {
		if entity.Lines[i].SKU == entity.Lines[j].SKU {
			return entity.Lines[i].Location < entity.Lines[j].Location
		}
		return entity.Lines[i].SKU < entity.Lines[j].SKU
	})
	if entity.Status == "draft" {
		entity.Status = "receiving"
	}
	entity.UpdatedAt = time.Now().UTC()
	receivingStore.receipts[index] = entity
	appendReceivingEvent("ReceiptLinesRegistered", entity.ID, map[string]any{"line_count": len(req.Lines)})
	respondJSON(w, http.StatusOK, entity)
}

func receiptStatusHandler(w http.ResponseWriter, r *http.Request, receiptID string) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if !isAllowedReceiptStatus(status) {
		respondError(w, http.StatusBadRequest, "unsupported status")
		return
	}

	receivingStore.Lock()
	defer receivingStore.Unlock()
	index := findReceiptIndex(receiptID)
	if index < 0 {
		respondError(w, http.StatusNotFound, "receipt not found")
		return
	}
	entity := receivingStore.receipts[index]
	if !isAllowedReceiptTransition(entity.Status, status) {
		respondError(w, http.StatusConflict, "invalid status transition")
		return
	}
	if status == "closed" && hasOpenTasks(entity.ID) {
		respondError(w, http.StatusConflict, "cannot close receipt with open warehouse tasks")
		return
	}

	if status == "putaway" {
		created := 0
		for _, line := range entity.Lines {
			if line.AcceptedQty <= 0 || hasOpenPutawayTask(entity.ID, line.SKU, line.Location) {
				continue
			}
			receivingStore.taskSeq++
			now := time.Now().UTC()
			task := warehouseTask{
				ID:        fmt.Sprintf("wt-%05d", receivingStore.taskSeq),
				Type:      "putaway",
				Warehouse: entity.Warehouse,
				SKU:       line.SKU,
				Quantity:  line.AcceptedQty,
				SourceBin: "receiving-dock",
				TargetBin: defaultValue(line.Location, "A-01"),
				Reference: entity.ID,
				Status:    "new",
				CreatedAt: now,
				UpdatedAt: now,
			}
			receivingStore.tasks = append(receivingStore.tasks, task)
			created++
		}
		appendReceivingEvent("PutawayTasksCreated", entity.ID, map[string]any{"count": created})
	}

	oldStatus := entity.Status
	entity.Status = status
	entity.UpdatedAt = time.Now().UTC()
	receivingStore.receipts[index] = entity
	appendReceivingEvent("ReceiptStatusChanged", entity.ID, map[string]any{"from": oldStatus, "to": status})
	respondJSON(w, http.StatusOK, entity)
}

func receiptDiscrepancyCreateHandler(w http.ResponseWriter, r *http.Request, receiptID string) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		SKU         string `json:"sku"`
		ExpectedQty int    `json:"expected_qty"`
		ActualQty   int    `json:"actual_qty"`
		Reason      string `json:"reason"`
		Resolution  string `json:"resolution"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.Reason) == "" {
		respondError(w, http.StatusBadRequest, "reason is required")
		return
	}

	receivingStore.Lock()
	defer receivingStore.Unlock()
	receiptIndex := findReceiptIndex(receiptID)
	if receiptIndex < 0 {
		respondError(w, http.StatusNotFound, "receipt not found")
		return
	}

	receivingStore.discrepancySeq++
	entity := discrepancy{
		ID:          fmt.Sprintf("dc-%05d", receivingStore.discrepancySeq),
		ReceiptID:   receiptID,
		SKU:         strings.ToUpper(strings.TrimSpace(req.SKU)),
		ExpectedQty: req.ExpectedQty,
		ActualQty:   req.ActualQty,
		Reason:      strings.TrimSpace(req.Reason),
		Resolution:  strings.TrimSpace(req.Resolution),
		CreatedAt:   time.Now().UTC(),
	}
	receivingStore.discrepancies = append(receivingStore.discrepancies, entity)
	receivingStore.receipts[receiptIndex].Discrepancies++
	if receivingStore.receipts[receiptIndex].Status == "draft" {
		receivingStore.receipts[receiptIndex].Status = "receiving"
	}
	receivingStore.receipts[receiptIndex].UpdatedAt = time.Now().UTC()
	appendReceivingEvent("ReceiptDiscrepancyReported", receiptID, map[string]any{
		"sku":    entity.SKU,
		"reason": entity.Reason,
	})
	respondJSON(w, http.StatusCreated, entity)
}

func warehouseTasksHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		receivingStore.RLock()
		defer receivingStore.RUnlock()
		typeFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("type")))
		statusFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status")))
		refFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("reference")))
		out := make([]warehouseTask, 0, len(receivingStore.tasks))
		for _, entity := range receivingStore.tasks {
			if typeFilter != "" && strings.ToLower(entity.Type) != typeFilter {
				continue
			}
			if statusFilter != "" && strings.ToLower(entity.Status) != statusFilter {
				continue
			}
			if refFilter != "" && strings.ToLower(entity.Reference) != refFilter {
				continue
			}
			out = append(out, entity)
		}
		respondJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req struct {
			Type      string `json:"type"`
			Warehouse string `json:"warehouse"`
			SKU       string `json:"sku"`
			Quantity  int    `json:"quantity"`
			SourceBin string `json:"source_bin"`
			TargetBin string `json:"target_bin"`
			Reference string `json:"reference"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		taskType := strings.ToLower(strings.TrimSpace(req.Type))
		if !isAllowedTaskType(taskType) {
			respondError(w, http.StatusBadRequest, "unsupported task type")
			return
		}
		if strings.TrimSpace(req.SKU) == "" || req.Quantity <= 0 {
			respondError(w, http.StatusBadRequest, "sku and positive quantity are required")
			return
		}

		now := time.Now().UTC()
		receivingStore.Lock()
		defer receivingStore.Unlock()
		receivingStore.taskSeq++
		entity := warehouseTask{
			ID:        fmt.Sprintf("wt-%05d", receivingStore.taskSeq),
			Type:      taskType,
			Warehouse: defaultValue(strings.ToLower(strings.TrimSpace(req.Warehouse)), "main"),
			SKU:       strings.ToUpper(strings.TrimSpace(req.SKU)),
			Quantity:  req.Quantity,
			SourceBin: strings.ToUpper(strings.TrimSpace(req.SourceBin)),
			TargetBin: strings.ToUpper(strings.TrimSpace(req.TargetBin)),
			Reference: strings.TrimSpace(req.Reference),
			Status:    "new",
			CreatedAt: now,
			UpdatedAt: now,
		}
		receivingStore.tasks = append(receivingStore.tasks, entity)
		appendReceivingEvent("WarehouseTaskCreated", entity.ID, map[string]any{
			"type":      entity.Type,
			"reference": entity.Reference,
		})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func warehouseTaskStatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 4 || parts[0] != "warehouse" || parts[1] != "tasks" || parts[3] != "status" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}
	taskID := parts[2]

	var req struct {
		Status string `json:"status"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if !isAllowedTaskStatus(status) {
		respondError(w, http.StatusBadRequest, "unsupported status")
		return
	}

	receivingStore.Lock()
	defer receivingStore.Unlock()
	index := findTaskIndex(taskID)
	if index < 0 {
		respondError(w, http.StatusNotFound, "task not found")
		return
	}
	current := receivingStore.tasks[index].Status
	if !isAllowedTaskTransition(current, status) {
		respondError(w, http.StatusConflict, "invalid status transition")
		return
	}

	receivingStore.tasks[index].Status = status
	receivingStore.tasks[index].UpdatedAt = time.Now().UTC()
	entity := receivingStore.tasks[index]
	eventType := "WarehouseTaskStatusChanged"
	if status == "done" {
		switch entity.Type {
		case "putaway":
			eventType = "PutawayCompleted"
		case "picking":
			eventType = "PickingCompleted"
		case "issue":
			eventType = "GoodsIssued"
		}
	}
	appendReceivingEvent(eventType, entity.ID, map[string]any{"from": current, "to": status})
	respondJSON(w, http.StatusOK, entity)
}

func receivingEventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	receivingStore.RLock()
	defer receivingStore.RUnlock()
	respondJSON(w, http.StatusOK, receivingStore.events)
}

func findReceiptIndex(id string) int {
	for i := range receivingStore.receipts {
		if receivingStore.receipts[i].ID == id {
			return i
		}
	}
	return -1
}

func findTaskIndex(id string) int {
	for i := range receivingStore.tasks {
		if receivingStore.tasks[i].ID == id {
			return i
		}
	}
	return -1
}

func findReceiptLineIndex(entity receipt, sku, location string) int {
	for i := range entity.Lines {
		if entity.Lines[i].SKU == sku && entity.Lines[i].Location == location {
			return i
		}
	}
	return -1
}

func hasOpenPutawayTask(receiptID, sku, location string) bool {
	for _, task := range receivingStore.tasks {
		if task.Type != "putaway" || task.Reference != receiptID || task.SKU != sku {
			continue
		}
		if location != "" && task.TargetBin != location {
			continue
		}
		if task.Status == "new" || task.Status == "in_progress" {
			return true
		}
	}
	return false
}

func hasOpenTasks(receiptID string) bool {
	for _, task := range receivingStore.tasks {
		if task.Reference == receiptID && (task.Status == "new" || task.Status == "in_progress") {
			return true
		}
	}
	return false
}

func isAllowedReceiptStatus(status string) bool {
	switch status {
	case "draft", "receiving", "received", "putaway", "closed", "cancelled":
		return true
	default:
		return false
	}
}

func isAllowedReceiptTransition(from, to string) bool {
	if from == to {
		return true
	}
	allowed := map[string]map[string]bool{
		"draft":     {"receiving": true, "cancelled": true},
		"receiving": {"received": true, "cancelled": true},
		"received":  {"putaway": true, "closed": true},
		"putaway":   {"closed": true},
	}
	return allowed[from][to]
}

func isAllowedTaskType(taskType string) bool {
	switch taskType {
	case "putaway", "picking", "issue":
		return true
	default:
		return false
	}
}

func isAllowedTaskStatus(status string) bool {
	switch status {
	case "new", "in_progress", "done", "cancelled":
		return true
	default:
		return false
	}
}

func isAllowedTaskTransition(from, to string) bool {
	if from == to {
		return true
	}
	allowed := map[string]map[string]bool{
		"new":         {"in_progress": true, "done": true, "cancelled": true},
		"in_progress": {"done": true, "cancelled": true},
	}
	return allowed[from][to]
}

func appendReceivingEvent(eventType, entityID string, payload map[string]any) {
	receivingStore.eventSeq++
	receivingStore.events = append(receivingStore.events, receivingEvent{
		ID:        fmt.Sprintf("ire-%05d", receivingStore.eventSeq),
		EventType: eventType,
		EntityID:  entityID,
		Payload:   payload,
		CreatedAt: time.Now().UTC(),
	})
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func defaultValue(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "inventory-receiving",
		"status":  "ok",
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "inventory-receiving",
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
