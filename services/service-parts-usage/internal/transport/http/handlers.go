package httptransport

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

type partsUsage struct {
	ID          string    `json:"id"`
	WorkorderID string    `json:"workorder_id"`
	PartCode    string    `json:"part_code"`
	Quantity    int       `json:"quantity"`
	Action      string    `json:"action"`
	CreatedAt   time.Time `json:"created_at"`
}

type partStock struct {
	PartCode     string `json:"part_code"`
	Available    int    `json:"available"`
	Reserved     int    `json:"reserved"`
	Consumed     int    `json:"consumed"`
	ReorderPoint int    `json:"reorder_point"`
}

type procurementRequest struct {
	ID              string    `json:"id"`
	WorkorderID     string    `json:"workorder_id"`
	PartCode        string    `json:"part_code"`
	SKU             string    `json:"sku,omitempty"`
	MissingQuantity int       `json:"missing_quantity"`
	Quantity        int       `json:"quantity,omitempty"`
	Status          string    `json:"status"`
	Source          string    `json:"source,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

type partsDomainEvent struct {
	ID          string         `json:"id"`
	EventType   string         `json:"event_type"`
	WorkorderID string         `json:"workorder_id,omitempty"`
	Payload     map[string]any `json:"payload,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
}

type workorderPartsPlanLine struct {
	SKU                  string `json:"sku"`
	Title                string `json:"title"`
	Quantity             int    `json:"quantity"`
	State                string `json:"state"`
	ProcurementRequestID string `json:"procurement_request_id,omitempty"`
}

type workorderPartsPlanLineView struct {
	SKU                  string `json:"sku"`
	Title                string `json:"title"`
	Quantity             int    `json:"quantity"`
	AvailableQuantity    int    `json:"available_quantity"`
	MissingQuantity      int    `json:"missing_quantity"`
	State                string `json:"state"`
	ProcurementRequestID string `json:"procurement_request_id,omitempty"`
}

type inventoryStockItem struct {
	ID           string    `json:"id"`
	SKU          string    `json:"sku"`
	Location     string    `json:"location"`
	OnHand       int       `json:"on_hand"`
	Reserved     int       `json:"reserved"`
	MinQty       int       `json:"min_qty"`
	ReorderPoint int       `json:"reorder_point"`
	LastMovedAt  time.Time `json:"last_movement_at"`
}

type externalProcurementRequest struct {
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

type workorderPartsWriteoffResponse struct {
	WorkorderID         string                       `json:"workorder_id"`
	Result              string                       `json:"result"`
	WorkorderStatus     string                       `json:"workorder_status"`
	IssuedLines         []workorderPartsPlanLineView `json:"issued_lines"`
	Shortages           []workorderPartsPlanLineView `json:"shortages"`
	ProcurementRequests []procurementRequest         `json:"procurement_requests"`
}

type inventoryStockLookupResult struct {
	Item      inventoryStockItem
	Found     bool
	Available int
}

type inventoryStockIssueRequest struct {
	SKU       string `json:"sku"`
	Location  string `json:"location"`
	Quantity  int    `json:"quantity"`
	Source    string `json:"source"`
	Reference string `json:"reference"`
}

type inventoryProcurementCreateRequest struct {
	SKU      string `json:"sku"`
	Quantity int    `json:"quantity"`
	Reason   string `json:"reason"`
	Priority string `json:"priority"`
	Source   string `json:"source"`
}

type workorderStatusUpdateRequest struct {
	Status string `json:"status"`
}

var partsStore = struct {
	sync.RWMutex
	seq             int
	procurementSeq  int
	eventSeq        int
	usages          []partsUsage
	plans           map[string][]workorderPartsPlanLine
	stockByPartCode map[string]partStock
	procurements    []procurementRequest
	events          []partsDomainEvent
}{
	plans: map[string][]workorderPartsPlanLine{},
	stockByPartCode: map[string]partStock{
		"P-1":         {PartCode: "P-1", Available: 10, Reserved: 0, Consumed: 0, ReorderPoint: 3},
		"PART-OIL":    {PartCode: "PART-OIL", Available: 4, Reserved: 0, Consumed: 0, ReorderPoint: 2},
		"PART-FILTER": {PartCode: "PART-FILTER", Available: 1, Reserved: 0, Consumed: 0, ReorderPoint: 2},
	},
}

var lookupInventoryStockBySKU = defaultLookupInventoryStockBySKU
var issueInventoryStock = defaultIssueInventoryStock
var createExternalProcurementRequest = defaultCreateExternalProcurementRequest
var updateExternalWorkorderStatus = defaultUpdateExternalWorkorderStatus

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)
	mux.HandleFunc("/workorders/", workorderPartsHandler)
	mux.HandleFunc("/usages", usagesHandler)
	mux.HandleFunc("/stock", stockHandler)
	mux.HandleFunc("/procurement/requests", procurementRequestsHandler)
	mux.HandleFunc("/events", partsEventsHandler)
}

func workorderPartsHandler(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 3 || parts[0] != "workorders" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}

	workorderID := strings.TrimSpace(parts[1])
	if workorderID == "" {
		respondError(w, http.StatusBadRequest, "workorder id is required")
		return
	}

	switch parts[2] {
	case "parts":
		handleWorkorderPartsUsage(w, r, workorderID)
	case "parts-plan":
		handleWorkorderPartsPlan(w, r, workorderID)
	case "writeoff":
		handleWorkorderWriteoff(w, r, workorderID)
	default:
		respondError(w, http.StatusNotFound, "route not found")
	}
}

func handleWorkorderPartsUsage(w http.ResponseWriter, r *http.Request, workorderID string) {
	switch r.Method {
	case http.MethodGet:
		partsStore.RLock()
		defer partsStore.RUnlock()
		filtered := make([]partsUsage, 0)
		for _, usage := range partsStore.usages {
			if usage.WorkorderID == workorderID {
				filtered = append(filtered, usage)
			}
		}
		respondJSON(w, http.StatusOK, filtered)
	case http.MethodPost:
		var req struct {
			PartCode string `json:"part_code"`
			Quantity int    `json:"quantity"`
			Action   string `json:"action"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.PartCode == "" || req.Quantity <= 0 {
			respondError(w, http.StatusBadRequest, "part_code and positive quantity are required")
			return
		}

		action := strings.ToLower(strings.TrimSpace(req.Action))
		if action == "" {
			action = "reserve"
		}
		if !isAllowedPartAction(action) {
			respondError(w, http.StatusBadRequest, "action must be reserve|consume|return")
			return
		}
		partCode := strings.ToUpper(strings.TrimSpace(req.PartCode))

		partsStore.Lock()
		defer partsStore.Unlock()
		stock := partsStore.stockByPartCode[partCode]
		if stock.PartCode == "" {
			stock = partStock{
				PartCode:     partCode,
				Available:    0,
				Reserved:     0,
				Consumed:     0,
				ReorderPoint: 1,
			}
		}

		switch action {
		case "reserve":
			if stock.Available < req.Quantity {
				missing := req.Quantity - stock.Available
				request := appendLegacyProcurementRequest(workorderID, partCode, missing)
				appendPartsEvent("PartsShortageDetected", workorderID, map[string]any{
					"part_code":         partCode,
					"required_quantity": req.Quantity,
					"available":         stock.Available,
					"missing_quantity":  missing,
					"procurement_id":    request.ID,
				})
				respondJSON(w, http.StatusConflict, map[string]any{
					"error":               "insufficient stock",
					"part_code":           partCode,
					"required_quantity":   req.Quantity,
					"available_quantity":  stock.Available,
					"missing_quantity":    missing,
					"procurement_request": request,
				})
				return
			}
			stock.Available -= req.Quantity
			stock.Reserved += req.Quantity
			appendPartsEvent("PartsReserved", workorderID, map[string]any{
				"part_code": partCode,
				"quantity":  req.Quantity,
			})
		case "consume":
			if stock.Reserved < req.Quantity {
				respondError(w, http.StatusConflict, "cannot consume quantity greater than reserved")
				return
			}
			stock.Reserved -= req.Quantity
			stock.Consumed += req.Quantity
			appendPartsEvent("PartsConsumed", workorderID, map[string]any{
				"part_code": partCode,
				"quantity":  req.Quantity,
			})
		case "return":
			if stock.Reserved+stock.Consumed < req.Quantity {
				respondError(w, http.StatusConflict, "cannot return quantity greater than reserved+consumed")
				return
			}
			toReturn := req.Quantity
			if stock.Reserved >= toReturn {
				stock.Reserved -= toReturn
			} else {
				fromReserved := stock.Reserved
				stock.Reserved = 0
				toReturn -= fromReserved
				stock.Consumed -= toReturn
			}
			stock.Available += req.Quantity
			appendPartsEvent("PartsReturned", workorderID, map[string]any{
				"part_code": partCode,
				"quantity":  req.Quantity,
			})
		}
		partsStore.stockByPartCode[partCode] = stock

		entity := appendUsageLocked(workorderID, partCode, req.Quantity, action)
		respondJSON(w, http.StatusCreated, map[string]any{
			"usage": entity,
			"stock": stock,
		})
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func usagesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	actionFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("action")))
	workorderFilter := strings.TrimSpace(r.URL.Query().Get("workorder_id"))

	partsStore.RLock()
	defer partsStore.RUnlock()

	filtered := make([]partsUsage, 0, len(partsStore.usages))
	for _, usage := range partsStore.usages {
		if actionFilter != "" && strings.ToLower(strings.TrimSpace(usage.Action)) != actionFilter {
			continue
		}
		if workorderFilter != "" && usage.WorkorderID != workorderFilter {
			continue
		}
		filtered = append(filtered, usage)
	}

	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].CreatedAt.After(filtered[j].CreatedAt)
	})
	respondJSON(w, http.StatusOK, filtered)
}

func handleWorkorderPartsPlan(w http.ResponseWriter, r *http.Request, workorderID string) {
	switch r.Method {
	case http.MethodGet:
		lines := copyPlanLines(workorderID)
		views, err := buildPlanViews(lines)
		if err != nil {
			respondError(w, http.StatusBadGateway, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, map[string]any{
			"workorder_id": workorderID,
			"lines":        views,
		})
	case http.MethodPut:
		var req struct {
			Lines []workorderPartsPlanLine `json:"lines"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}

		partsStore.Lock()
		current := append([]workorderPartsPlanLine(nil), partsStore.plans[workorderID]...)
		nextLines, err := mergePlanLines(req.Lines, current)
		if err != nil {
			partsStore.Unlock()
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		partsStore.plans[workorderID] = nextLines
		partsStore.Unlock()

		views, err := buildPlanViews(nextLines)
		if err != nil {
			respondError(w, http.StatusBadGateway, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, map[string]any{
			"workorder_id": workorderID,
			"lines":        views,
		})
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func handleWorkorderWriteoff(w http.ResponseWriter, r *http.Request, workorderID string) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	lines := copyPlanLines(workorderID)
	if len(lines) == 0 {
		respondError(w, http.StatusBadRequest, "parts plan is empty")
		return
	}

	pending := make([]workorderPartsPlanLine, 0, len(lines))
	for _, line := range lines {
		if line.State != "written_off" {
			pending = append(pending, line)
		}
	}

	if len(pending) == 0 {
		if err := updateExternalWorkorderStatus(workorderID, "ready"); err != nil {
			respondError(w, http.StatusBadGateway, err.Error())
			return
		}
		views, err := buildPlanViews(lines)
		if err != nil {
			respondError(w, http.StatusBadGateway, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, workorderPartsWriteoffResponse{
			WorkorderID:     workorderID,
			Result:          "written_off",
			WorkorderStatus: "ready",
			IssuedLines:     views,
		})
		return
	}

	type pendingCheck struct {
		Line   workorderPartsPlanLine
		Lookup inventoryStockLookupResult
	}

	checks := make([]pendingCheck, 0, len(pending))
	shortages := make([]pendingCheck, 0)
	for _, line := range pending {
		lookup, err := lookupInventoryStockBySKU(line.SKU)
		if err != nil {
			respondError(w, http.StatusBadGateway, err.Error())
			return
		}
		check := pendingCheck{Line: line, Lookup: lookup}
		checks = append(checks, check)
		if lookup.Available < line.Quantity {
			shortages = append(shortages, check)
		}
	}

	if len(shortages) > 0 {
		shortageViews := make([]workorderPartsPlanLineView, 0, len(shortages))
		createdRequests := make([]procurementRequest, 0)

		partsStore.Lock()
		current := append([]workorderPartsPlanLine(nil), partsStore.plans[workorderID]...)
		for _, shortage := range shortages {
			missing := shortage.Line.Quantity - shortage.Lookup.Available
			if missing < 0 {
				missing = 0
			}
			requestID := strings.TrimSpace(shortage.Line.ProcurementRequestID)
			if requestID == "" {
				externalRequest, err := createExternalProcurementRequest(inventoryProcurementCreateRequest{
					SKU:      shortage.Line.SKU,
					Quantity: missing,
					Reason:   fmt.Sprintf("workorder %s parts shortage", workorderID),
					Priority: "high",
					Source:   "service-parts-usage",
				})
				if err != nil {
					partsStore.Unlock()
					respondError(w, http.StatusBadGateway, err.Error())
					return
				}
				requestID = externalRequest.ID
				localRequest := procurementRequest{
					ID:              externalRequest.ID,
					WorkorderID:     workorderID,
					PartCode:        shortage.Line.SKU,
					SKU:             externalRequest.SKU,
					MissingQuantity: missing,
					Quantity:        externalRequest.Quantity,
					Status:          externalRequest.Status,
					Source:          externalRequest.Source,
					CreatedAt:       externalRequest.CreatedAt,
				}
				partsStore.procurements = append(partsStore.procurements, localRequest)
				createdRequests = append(createdRequests, localRequest)
				appendPartsEvent("ProcurementRequestCreated", workorderID, map[string]any{
					"procurement_id":   localRequest.ID,
					"part_code":        localRequest.PartCode,
					"missing_quantity": localRequest.MissingQuantity,
				})
			}

			for index := range current {
				if current[index].SKU != shortage.Line.SKU {
					continue
				}
				current[index].State = "waiting_procurement"
				current[index].ProcurementRequestID = requestID
				shortageViews = append(shortageViews, workorderPartsPlanLineView{
					SKU:                  current[index].SKU,
					Title:                current[index].Title,
					Quantity:             current[index].Quantity,
					AvailableQuantity:    shortage.Lookup.Available,
					MissingQuantity:      maxInt(current[index].Quantity-shortage.Lookup.Available, 0),
					State:                current[index].State,
					ProcurementRequestID: current[index].ProcurementRequestID,
				})
				appendPartsEvent("PartsShortageDetected", workorderID, map[string]any{
					"part_code":         current[index].SKU,
					"required_quantity": current[index].Quantity,
					"available":         shortage.Lookup.Available,
					"missing_quantity":  maxInt(current[index].Quantity-shortage.Lookup.Available, 0),
					"procurement_id":    current[index].ProcurementRequestID,
				})
				break
			}
		}
		partsStore.plans[workorderID] = current
		partsStore.Unlock()

		if err := updateExternalWorkorderStatus(workorderID, "waiting_parts"); err != nil {
			respondError(w, http.StatusBadGateway, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, workorderPartsWriteoffResponse{
			WorkorderID:         workorderID,
			Result:              "waiting_parts",
			WorkorderStatus:     "waiting_parts",
			Shortages:           shortageViews,
			ProcurementRequests: createdRequests,
		})
		return
	}

	issuedViews := make([]workorderPartsPlanLineView, 0, len(checks))
	partsStore.Lock()
	current := append([]workorderPartsPlanLine(nil), partsStore.plans[workorderID]...)
	partsStore.Unlock()

	for _, check := range checks {
		location := "main"
		if check.Lookup.Found && strings.TrimSpace(check.Lookup.Item.Location) != "" {
			location = check.Lookup.Item.Location
		}
		if _, err := issueInventoryStock(inventoryStockIssueRequest{
			SKU:       check.Line.SKU,
			Location:  location,
			Quantity:  check.Line.Quantity,
			Source:    "service-parts-usage",
			Reference: workorderID,
		}); err != nil {
			respondError(w, http.StatusBadGateway, err.Error())
			return
		}
		issuedViews = append(issuedViews, workorderPartsPlanLineView{
			SKU:                  check.Line.SKU,
			Title:                check.Line.Title,
			Quantity:             check.Line.Quantity,
			AvailableQuantity:    check.Line.Quantity,
			MissingQuantity:      0,
			State:                "written_off",
			ProcurementRequestID: check.Line.ProcurementRequestID,
		})
	}

	partsStore.Lock()
	for _, check := range checks {
		for index := range current {
			if current[index].SKU != check.Line.SKU {
				continue
			}
			current[index].State = "written_off"
			appendUsageLocked(workorderID, current[index].SKU, current[index].Quantity, "writeoff")
			appendPartsEvent("PartsWrittenOff", workorderID, map[string]any{
				"part_code": current[index].SKU,
				"quantity":  current[index].Quantity,
			})
			break
		}
	}
	partsStore.plans[workorderID] = current
	partsStore.Unlock()

	if err := updateExternalWorkorderStatus(workorderID, "ready"); err != nil {
		respondError(w, http.StatusBadGateway, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, workorderPartsWriteoffResponse{
		WorkorderID:     workorderID,
		Result:          "written_off",
		WorkorderStatus: "ready",
		IssuedLines:     issuedViews,
	})
}

func stockHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	partsStore.RLock()
	defer partsStore.RUnlock()
	keys := make([]string, 0, len(partsStore.stockByPartCode))
	for key := range partsStore.stockByPartCode {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]partStock, 0, len(keys))
	for _, key := range keys {
		out = append(out, partsStore.stockByPartCode[key])
	}
	respondJSON(w, http.StatusOK, out)
}

func procurementRequestsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	partsStore.RLock()
	defer partsStore.RUnlock()
	respondJSON(w, http.StatusOK, partsStore.procurements)
}

func partsEventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	partsStore.RLock()
	defer partsStore.RUnlock()
	respondJSON(w, http.StatusOK, partsStore.events)
}

func copyPlanLines(workorderID string) []workorderPartsPlanLine {
	partsStore.RLock()
	defer partsStore.RUnlock()
	return append([]workorderPartsPlanLine(nil), partsStore.plans[workorderID]...)
}

func buildPlanViews(lines []workorderPartsPlanLine) ([]workorderPartsPlanLineView, error) {
	views := make([]workorderPartsPlanLineView, 0, len(lines))
	for _, line := range lines {
		view := workorderPartsPlanLineView{
			SKU:                  line.SKU,
			Title:                line.Title,
			Quantity:             line.Quantity,
			State:                line.State,
			ProcurementRequestID: line.ProcurementRequestID,
		}
		lookup, err := lookupInventoryStockBySKU(line.SKU)
		if err != nil {
			return nil, err
		}
		view.AvailableQuantity = lookup.Available
		view.MissingQuantity = maxInt(line.Quantity-lookup.Available, 0)
		views = append(views, view)
	}
	return views, nil
}

func mergePlanLines(
	rawLines []workorderPartsPlanLine,
	current []workorderPartsPlanLine,
) ([]workorderPartsPlanLine, error) {
	nextBySKU := map[string]workorderPartsPlanLine{}
	currentBySKU := map[string]workorderPartsPlanLine{}
	for _, line := range current {
		currentBySKU[line.SKU] = line
	}

	for _, rawLine := range rawLines {
		sku := normalizePartCode(rawLine.SKU)
		if sku == "" {
			continue
		}
		if rawLine.Quantity <= 0 {
			return nil, fmt.Errorf("quantity must be positive for sku %s", sku)
		}
		title := strings.TrimSpace(rawLine.Title)
		nextLine, exists := nextBySKU[sku]
		if !exists {
			preserved := currentBySKU[sku]
			nextLine = workorderPartsPlanLine{
				SKU:                  sku,
				Title:                firstNonEmpty(title, preserved.Title, sku),
				Quantity:             rawLine.Quantity,
				State:                "draft",
				ProcurementRequestID: "",
			}
			if preserved.Quantity == rawLine.Quantity {
				nextLine.State = firstNonEmpty(preserved.State, "draft")
				nextLine.ProcurementRequestID = preserved.ProcurementRequestID
			}
			nextBySKU[sku] = nextLine
			continue
		}
		nextLine.Quantity += rawLine.Quantity
		if title != "" {
			nextLine.Title = title
		}
		nextLine.State = "draft"
		nextLine.ProcurementRequestID = ""
		nextBySKU[sku] = nextLine
	}

	keys := make([]string, 0, len(nextBySKU))
	for key := range nextBySKU {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	nextLines := make([]workorderPartsPlanLine, 0, len(keys))
	for _, key := range keys {
		line := nextBySKU[key]
		if line.Quantity <= 0 {
			continue
		}
		line.State = normalizePlanLineState(line.State)
		nextLines = append(nextLines, line)
	}
	return nextLines, nil
}

func appendLegacyProcurementRequest(workorderID, partCode string, missingQuantity int) procurementRequest {
	partsStore.procurementSeq++
	request := procurementRequest{
		ID:              fmt.Sprintf("pr-%05d", partsStore.procurementSeq),
		WorkorderID:     workorderID,
		PartCode:        partCode,
		SKU:             partCode,
		MissingQuantity: missingQuantity,
		Quantity:        missingQuantity,
		Status:          "created",
		Source:          "legacy-parts-usage",
		CreatedAt:       time.Now().UTC(),
	}
	partsStore.procurements = append(partsStore.procurements, request)
	appendPartsEvent("ProcurementRequestCreated", workorderID, map[string]any{
		"procurement_id":   request.ID,
		"part_code":        request.PartCode,
		"missing_quantity": request.MissingQuantity,
	})
	return request
}

func appendUsageLocked(workorderID, partCode string, quantity int, action string) partsUsage {
	partsStore.seq++
	entity := partsUsage{
		ID:          fmt.Sprintf("pu-%04d", partsStore.seq),
		WorkorderID: workorderID,
		PartCode:    partCode,
		Quantity:    quantity,
		Action:      action,
		CreatedAt:   time.Now().UTC(),
	}
	partsStore.usages = append(partsStore.usages, entity)
	return entity
}

func appendPartsEvent(eventType, workorderID string, payload map[string]any) {
	partsStore.eventSeq++
	partsStore.events = append(partsStore.events, partsDomainEvent{
		ID:          fmt.Sprintf("pue-%05d", partsStore.eventSeq),
		EventType:   eventType,
		WorkorderID: workorderID,
		Payload:     payload,
		CreatedAt:   time.Now().UTC(),
	})
}

func isAllowedPartAction(action string) bool {
	switch action {
	case "reserve", "consume", "return":
		return true
	default:
		return false
	}
}

func normalizePlanLineState(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "waiting_procurement", "written_off":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "draft"
	}
}

func normalizePartCode(value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func defaultLookupInventoryStockBySKU(sku string) (inventoryStockLookupResult, error) {
	baseURL := resolveServiceBaseURL("INVENTORY_STOCK_API_URL", "http://127.0.0.1:19093")
	endpoint := fmt.Sprintf("%s/stock?sku=%s", baseURL, url.QueryEscape(normalizePartCode(sku)))
	request, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return inventoryStockLookupResult{}, fmt.Errorf("build inventory stock request: %w", err)
	}
	request.Header.Set("Accept", "application/json")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return inventoryStockLookupResult{}, fmt.Errorf("lookup inventory stock: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return inventoryStockLookupResult{}, fmt.Errorf("lookup inventory stock failed: %s", response.Status)
	}

	var items []inventoryStockItem
	if err := json.NewDecoder(response.Body).Decode(&items); err != nil {
		return inventoryStockLookupResult{}, fmt.Errorf("decode inventory stock: %w", err)
	}
	if len(items) == 0 {
		return inventoryStockLookupResult{}, nil
	}

	item := items[0]
	return inventoryStockLookupResult{
		Item:      item,
		Found:     true,
		Available: maxInt(item.OnHand-item.Reserved, 0),
	}, nil
}

func defaultIssueInventoryStock(req inventoryStockIssueRequest) (inventoryStockItem, error) {
	baseURL := resolveServiceBaseURL("INVENTORY_STOCK_API_URL", "http://127.0.0.1:19093")
	endpoint := baseURL + "/stock/issue"
	return postJSON[inventoryStockIssueRequest, inventoryStockItem](endpoint, req, nil)
}

func defaultCreateExternalProcurementRequest(
	req inventoryProcurementCreateRequest,
) (externalProcurementRequest, error) {
	baseURL := resolveServiceBaseURL("INVENTORY_PROCUREMENT_API_URL", "http://127.0.0.1:19091")
	endpoint := baseURL + "/procurement/requests"
	return postJSON[inventoryProcurementCreateRequest, externalProcurementRequest](endpoint, req, nil)
}

func defaultUpdateExternalWorkorderStatus(workorderID, status string) error {
	baseURL := resolveServiceBaseURL("SERVICE_WORKORDERS_API_URL", "http://127.0.0.1:19105")
	endpoint := fmt.Sprintf("%s/workorders/%s/status", baseURL, url.PathEscape(strings.TrimSpace(workorderID)))
	headers := map[string]string{
		"X-Role":    "platform_admin",
		"X-User-ID": "service-parts-usage",
	}
	_, err := postJSON[workorderStatusUpdateRequest, map[string]any](endpoint, workorderStatusUpdateRequest{
		Status: status,
	}, headers)
	return err
}

func resolveServiceBaseURL(envKey, fallback string) string {
	value := strings.TrimSpace(os.Getenv(envKey))
	if value == "" {
		return fallback
	}
	return strings.TrimRight(value, "/")
}

func postJSON[Req any, Resp any](endpoint string, payload Req, headers map[string]string) (Resp, error) {
	var zero Resp

	raw, err := json.Marshal(payload)
	if err != nil {
		return zero, fmt.Errorf("marshal request payload: %w", err)
	}

	request, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return zero, fmt.Errorf("build request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	for key, value := range headers {
		request.Header.Set(key, value)
	}

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return zero, fmt.Errorf("request %s failed: %w", endpoint, err)
	}
	defer response.Body.Close()

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		var failure map[string]any
		if err := json.NewDecoder(response.Body).Decode(&failure); err == nil {
			if message, ok := failure["error"].(string); ok && message != "" {
				return zero, fmt.Errorf("%s", message)
			}
		}
		return zero, fmt.Errorf("request %s failed: %s", endpoint, response.Status)
	}

	var out Resp
	if err := json.NewDecoder(response.Body).Decode(&out); err != nil {
		return zero, fmt.Errorf("decode response from %s: %w", endpoint, err)
	}
	return out, nil
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "service-parts-usage",
		"status":  "ok",
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "service-parts-usage",
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
