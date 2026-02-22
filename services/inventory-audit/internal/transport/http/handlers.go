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

type inventoryAuditTask struct {
	ID          string    `json:"id"`
	Warehouse   string    `json:"warehouse"`
	Scope       string    `json:"scope"`
	Status      string    `json:"status"`
	CreatedBy   string    `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
	StartedAt   time.Time `json:"started_at,omitempty"`
	CompletedAt time.Time `json:"completed_at,omitempty"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type inventoryCountLine struct {
	ID        string    `json:"id"`
	TaskID    string    `json:"task_id"`
	Warehouse string    `json:"warehouse"`
	SKU       string    `json:"sku"`
	Location  string    `json:"location"`
	BookQty   int       `json:"book_qty"`
	FactQty   int       `json:"fact_qty"`
	Variance  int       `json:"variance"`
	Status    string    `json:"status"`
	Note      string    `json:"note"`
	CountedAt time.Time `json:"counted_at"`
}

type stockAdjustment struct {
	ID         string    `json:"id"`
	TaskID     string    `json:"task_id"`
	SKU        string    `json:"sku"`
	Location   string    `json:"location"`
	Delta      int       `json:"delta"`
	Reason     string    `json:"reason"`
	ApprovedBy string    `json:"approved_by"`
	CreatedAt  time.Time `json:"created_at"`
}

type inventoryCheck struct {
	ID         string    `json:"id"`
	Warehouse  string    `json:"warehouse"`
	SKU        string    `json:"sku"`
	BookQty    int       `json:"book_qty"`
	FactQty    int       `json:"fact_qty"`
	Variance   int       `json:"variance"`
	Status     string    `json:"status"`
	CheckedAt  time.Time `json:"checked_at"`
	RecordedAt time.Time `json:"recorded_at"`
}

type auditEvent struct {
	ID        string         `json:"id"`
	EventType string         `json:"event_type"`
	EntityID  string         `json:"entity_id"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

var auditStore = struct {
	sync.RWMutex
	taskSeq       int
	lineSeq       int
	adjustmentSeq int
	eventSeq      int
	tasks         []inventoryAuditTask
	lines         []inventoryCountLine
	adjustments   []stockAdjustment
	events        []auditEvent
}{}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)
	mux.HandleFunc("/inventory-audits", auditsHandler)
	mux.HandleFunc("/inventory-audits/", auditByIDHandler)
	mux.HandleFunc("/inventory-checks", checksHandler)
	mux.HandleFunc("/adjustments", adjustmentsHandler)
	mux.HandleFunc("/events", eventsHandler)
}

func auditsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		auditStore.RLock()
		defer auditStore.RUnlock()
		statusFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status")))
		warehouseFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("warehouse")))
		out := make([]inventoryAuditTask, 0, len(auditStore.tasks))
		for _, entity := range auditStore.tasks {
			if statusFilter != "" && strings.ToLower(entity.Status) != statusFilter {
				continue
			}
			if warehouseFilter != "" && strings.ToLower(entity.Warehouse) != warehouseFilter {
				continue
			}
			out = append(out, entity)
		}
		respondJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req struct {
			Warehouse string `json:"warehouse"`
			Scope     string `json:"scope"`
			CreatedBy string `json:"created_by"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		now := time.Now().UTC()
		auditStore.Lock()
		defer auditStore.Unlock()
		auditStore.taskSeq++
		entity := inventoryAuditTask{
			ID:        fmt.Sprintf("iat-%05d", auditStore.taskSeq),
			Warehouse: defaultValue(strings.ToLower(strings.TrimSpace(req.Warehouse)), "main"),
			Scope:     defaultValue(strings.TrimSpace(req.Scope), "cycle-count"),
			Status:    "new",
			CreatedBy: defaultValue(strings.TrimSpace(req.CreatedBy), "system"),
			CreatedAt: now,
			UpdatedAt: now,
		}
		auditStore.tasks = append(auditStore.tasks, entity)
		appendAuditEvent("InventoryAuditTaskCreated", entity.ID, map[string]any{
			"warehouse": entity.Warehouse,
			"scope":     entity.Scope,
		})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func auditByIDHandler(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 2 || parts[0] != "inventory-audits" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}
	taskID := parts[1]

	if len(parts) == 2 && r.Method == http.MethodGet {
		getAuditTaskHandler(w, taskID)
		return
	}
	if len(parts) != 3 {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}
	switch parts[2] {
	case "counts":
		auditCountsHandler(w, r, taskID)
	case "status":
		auditStatusHandler(w, r, taskID)
	case "reconcile":
		auditReconcileHandler(w, r, taskID)
	case "adjustments":
		taskAdjustmentsHandler(w, r, taskID)
	default:
		respondError(w, http.StatusNotFound, "route not found")
	}
}

func getAuditTaskHandler(w http.ResponseWriter, taskID string) {
	auditStore.RLock()
	defer auditStore.RUnlock()
	index := findTaskIndex(taskID)
	if index < 0 {
		respondError(w, http.StatusNotFound, "audit task not found")
		return
	}
	lines := make([]inventoryCountLine, 0)
	for _, line := range auditStore.lines {
		if line.TaskID == taskID {
			lines = append(lines, line)
		}
	}
	adjustments := make([]stockAdjustment, 0)
	for _, adjustment := range auditStore.adjustments {
		if adjustment.TaskID == taskID {
			adjustments = append(adjustments, adjustment)
		}
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"task":           auditStore.tasks[index],
		"lines":          lines,
		"adjustments":    adjustments,
		"variance_count": pendingVarianceCountLocked(taskID),
	})
}

func auditCountsHandler(w http.ResponseWriter, r *http.Request, taskID string) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Lines []struct {
			SKU      string `json:"sku"`
			Location string `json:"location"`
			BookQty  int    `json:"book_qty"`
			FactQty  int    `json:"fact_qty"`
			Note     string `json:"note"`
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

	now := time.Now().UTC()
	auditStore.Lock()
	defer auditStore.Unlock()
	taskIndex := findTaskIndex(taskID)
	if taskIndex < 0 {
		respondError(w, http.StatusNotFound, "audit task not found")
		return
	}
	task := auditStore.tasks[taskIndex]
	if task.Status == "closed" || task.Status == "cancelled" {
		respondError(w, http.StatusConflict, "cannot add counts to closed/cancelled task")
		return
	}
	if task.Status == "new" {
		task.Status = "in_progress"
		task.StartedAt = now
	}

	recorded := make([]inventoryCountLine, 0, len(req.Lines))
	for _, line := range req.Lines {
		sku := strings.ToUpper(strings.TrimSpace(line.SKU))
		if sku == "" {
			respondError(w, http.StatusBadRequest, "sku is required")
			return
		}
		if line.BookQty < 0 || line.FactQty < 0 {
			respondError(w, http.StatusBadRequest, "book_qty and fact_qty must be non-negative")
			return
		}
		auditStore.lineSeq++
		entity := inventoryCountLine{
			ID:        fmt.Sprintf("icl-%05d", auditStore.lineSeq),
			TaskID:    task.ID,
			Warehouse: task.Warehouse,
			SKU:       sku,
			Location:  defaultValue(strings.ToUpper(strings.TrimSpace(line.Location)), "MAIN"),
			BookQty:   line.BookQty,
			FactQty:   line.FactQty,
			Variance:  line.FactQty - line.BookQty,
			Status:    "counted",
			Note:      strings.TrimSpace(line.Note),
			CountedAt: now,
		}
		if entity.Variance == 0 {
			entity.Status = "reconciled"
		}
		auditStore.lines = append(auditStore.lines, entity)
		recorded = append(recorded, entity)
		appendAuditEvent("InventoryCountRecorded", entity.ID, map[string]any{
			"task_id":  entity.TaskID,
			"sku":      entity.SKU,
			"variance": entity.Variance,
		})
		if entity.Variance != 0 {
			appendAuditEvent("InventoryVarianceDetected", entity.ID, map[string]any{
				"task_id": entity.TaskID,
				"sku":     entity.SKU,
			})
		}
	}

	task.UpdatedAt = now
	auditStore.tasks[taskIndex] = task
	respondJSON(w, http.StatusCreated, map[string]any{
		"task":  task,
		"lines": recorded,
		"count": len(recorded),
	})
}

func auditStatusHandler(w http.ResponseWriter, r *http.Request, taskID string) {
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
	if !isAllowedTaskStatus(status) {
		respondError(w, http.StatusBadRequest, "unsupported status")
		return
	}

	now := time.Now().UTC()
	auditStore.Lock()
	defer auditStore.Unlock()
	index := findTaskIndex(taskID)
	if index < 0 {
		respondError(w, http.StatusNotFound, "audit task not found")
		return
	}
	current := auditStore.tasks[index].Status
	if !isAllowedTaskTransition(current, status) {
		respondError(w, http.StatusConflict, "invalid status transition")
		return
	}
	if status == "closed" && pendingVarianceCountLocked(taskID) > 0 {
		respondError(w, http.StatusConflict, "cannot close task with unreconciled variances")
		return
	}

	auditStore.tasks[index].Status = status
	auditStore.tasks[index].UpdatedAt = now
	if status == "in_progress" && auditStore.tasks[index].StartedAt.IsZero() {
		auditStore.tasks[index].StartedAt = now
	}
	if status == "completed" || status == "closed" {
		auditStore.tasks[index].CompletedAt = now
	}
	appendAuditEvent("InventoryAuditTaskStatusChanged", taskID, map[string]any{"from": current, "to": status})
	respondJSON(w, http.StatusOK, auditStore.tasks[index])
}

func auditReconcileHandler(w http.ResponseWriter, r *http.Request, taskID string) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		AutoAdjust bool   `json:"auto_adjust"`
		Reason     string `json:"reason"`
		ApprovedBy string `json:"approved_by"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	now := time.Now().UTC()
	auditStore.Lock()
	defer auditStore.Unlock()
	taskIndex := findTaskIndex(taskID)
	if taskIndex < 0 {
		respondError(w, http.StatusNotFound, "audit task not found")
		return
	}
	task := auditStore.tasks[taskIndex]
	if task.Status == "closed" || task.Status == "cancelled" {
		respondError(w, http.StatusConflict, "cannot reconcile closed/cancelled task")
		return
	}

	adjustments := make([]stockAdjustment, 0)
	varianceCount := 0
	for i := range auditStore.lines {
		line := &auditStore.lines[i]
		if line.TaskID != taskID || line.Variance == 0 || line.Status == "adjusted" {
			continue
		}
		varianceCount++
		if req.AutoAdjust {
			auditStore.adjustmentSeq++
			adjustment := stockAdjustment{
				ID:         fmt.Sprintf("adj-%05d", auditStore.adjustmentSeq),
				TaskID:     taskID,
				SKU:        line.SKU,
				Location:   line.Location,
				Delta:      line.Variance,
				Reason:     defaultValue(strings.TrimSpace(req.Reason), "inventory reconciliation"),
				ApprovedBy: defaultValue(strings.TrimSpace(req.ApprovedBy), "system"),
				CreatedAt:  now,
			}
			auditStore.adjustments = append(auditStore.adjustments, adjustment)
			adjustments = append(adjustments, adjustment)
			line.Status = "adjusted"
			appendAuditEvent("StockAdjusted", adjustment.ID, map[string]any{
				"task_id": adjustment.TaskID,
				"sku":     adjustment.SKU,
				"delta":   adjustment.Delta,
			})
			continue
		}
		line.Status = "reconciled"
	}

	task.Status = "completed"
	task.CompletedAt = now
	task.UpdatedAt = now
	auditStore.tasks[taskIndex] = task
	appendAuditEvent("InventoryReconciliationCompleted", task.ID, map[string]any{
		"auto_adjust": req.AutoAdjust,
		"variances":   varianceCount,
		"adjustments": len(adjustments),
	})
	respondJSON(w, http.StatusOK, map[string]any{
		"task":        task,
		"variances":   varianceCount,
		"adjustments": adjustments,
	})
}

func taskAdjustmentsHandler(w http.ResponseWriter, r *http.Request, taskID string) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	auditStore.RLock()
	defer auditStore.RUnlock()
	out := make([]stockAdjustment, 0)
	for _, entity := range auditStore.adjustments {
		if entity.TaskID == taskID {
			out = append(out, entity)
		}
	}
	respondJSON(w, http.StatusOK, out)
}

func checksHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		auditStore.RLock()
		defer auditStore.RUnlock()
		out := make([]inventoryCheck, 0, len(auditStore.lines))
		for _, line := range auditStore.lines {
			out = append(out, inventoryCheck{
				ID:         line.ID,
				Warehouse:  line.Warehouse,
				SKU:        line.SKU,
				BookQty:    line.BookQty,
				FactQty:    line.FactQty,
				Variance:   line.Variance,
				Status:     line.Status,
				CheckedAt:  line.CountedAt,
				RecordedAt: line.CountedAt,
			})
		}
		respondJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req struct {
			Warehouse string `json:"warehouse"`
			SKU       string `json:"sku"`
			Location  string `json:"location"`
			BookQty   int    `json:"book_qty"`
			FactQty   int    `json:"fact_qty"`
			Note      string `json:"note"`
			TaskID    string `json:"task_id"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.Warehouse == "" || req.SKU == "" {
			respondError(w, http.StatusBadRequest, "warehouse and sku are required")
			return
		}
		if req.BookQty < 0 || req.FactQty < 0 {
			respondError(w, http.StatusBadRequest, "book_qty and fact_qty must be non-negative")
			return
		}

		now := time.Now().UTC()
		auditStore.Lock()
		defer auditStore.Unlock()
		taskID := strings.TrimSpace(req.TaskID)
		if taskID == "" {
			auditStore.taskSeq++
			taskID = fmt.Sprintf("iat-%05d", auditStore.taskSeq)
			task := inventoryAuditTask{
				ID:        taskID,
				Warehouse: strings.ToLower(strings.TrimSpace(req.Warehouse)),
				Scope:     "ad-hoc",
				Status:    "in_progress",
				CreatedBy: "inventory-check-api",
				CreatedAt: now,
				StartedAt: now,
				UpdatedAt: now,
			}
			auditStore.tasks = append(auditStore.tasks, task)
			appendAuditEvent("InventoryAuditTaskCreated", task.ID, map[string]any{"scope": task.Scope, "warehouse": task.Warehouse})
		}

		taskIndex := findTaskIndex(taskID)
		if taskIndex < 0 {
			respondError(w, http.StatusNotFound, "task not found")
			return
		}

		auditStore.lineSeq++
		line := inventoryCountLine{
			ID:        fmt.Sprintf("icl-%05d", auditStore.lineSeq),
			TaskID:    taskID,
			Warehouse: strings.ToLower(strings.TrimSpace(req.Warehouse)),
			SKU:       strings.ToUpper(strings.TrimSpace(req.SKU)),
			Location:  defaultValue(strings.ToUpper(strings.TrimSpace(req.Location)), "MAIN"),
			BookQty:   req.BookQty,
			FactQty:   req.FactQty,
			Variance:  req.FactQty - req.BookQty,
			Status:    "counted",
			Note:      strings.TrimSpace(req.Note),
			CountedAt: now,
		}
		if line.Variance == 0 {
			line.Status = "reconciled"
		}
		auditStore.lines = append(auditStore.lines, line)
		task := auditStore.tasks[taskIndex]
		task.Status = "in_progress"
		task.UpdatedAt = now
		auditStore.tasks[taskIndex] = task
		appendAuditEvent("InventoryCountRecorded", line.ID, map[string]any{"task_id": line.TaskID, "variance": line.Variance})

		check := inventoryCheck{
			ID:         line.ID,
			Warehouse:  line.Warehouse,
			SKU:        line.SKU,
			BookQty:    line.BookQty,
			FactQty:    line.FactQty,
			Variance:   line.Variance,
			Status:     line.Status,
			CheckedAt:  line.CountedAt,
			RecordedAt: line.CountedAt,
		}
		respondJSON(w, http.StatusCreated, check)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func adjustmentsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	taskFilter := strings.TrimSpace(r.URL.Query().Get("task_id"))
	skuFilter := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("sku")))
	auditStore.RLock()
	defer auditStore.RUnlock()
	out := make([]stockAdjustment, 0, len(auditStore.adjustments))
	for _, entity := range auditStore.adjustments {
		if taskFilter != "" && entity.TaskID != taskFilter {
			continue
		}
		if skuFilter != "" && entity.SKU != skuFilter {
			continue
		}
		out = append(out, entity)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	respondJSON(w, http.StatusOK, out)
}

func eventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	auditStore.RLock()
	defer auditStore.RUnlock()
	respondJSON(w, http.StatusOK, auditStore.events)
}

func findTaskIndex(id string) int {
	for i := range auditStore.tasks {
		if auditStore.tasks[i].ID == id {
			return i
		}
	}
	return -1
}

func pendingVarianceCountLocked(taskID string) int {
	count := 0
	for _, line := range auditStore.lines {
		if line.TaskID != taskID || line.Variance == 0 {
			continue
		}
		if line.Status == "adjusted" || line.Status == "reconciled" {
			continue
		}
		count++
	}
	return count
}

func isAllowedTaskStatus(status string) bool {
	switch status {
	case "new", "in_progress", "completed", "closed", "cancelled":
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
		"new":         {"in_progress": true, "cancelled": true},
		"in_progress": {"completed": true, "cancelled": true},
		"completed":   {"closed": true},
	}
	return allowed[from][to]
}

func appendAuditEvent(eventType, entityID string, payload map[string]any) {
	auditStore.eventSeq++
	auditStore.events = append(auditStore.events, auditEvent{
		ID:        fmt.Sprintf("iae-%05d", auditStore.eventSeq),
		EventType: eventType,
		EntityID:  entityID,
		Payload:   payload,
		CreatedAt: time.Now().UTC(),
	})
}

func defaultValue(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "inventory-audit",
		"status":  "ok",
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "inventory-audit",
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
