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
	MissingQuantity int       `json:"missing_quantity"`
	Status          string    `json:"status"`
	CreatedAt       time.Time `json:"created_at"`
}

type partsDomainEvent struct {
	ID          string         `json:"id"`
	EventType   string         `json:"event_type"`
	WorkorderID string         `json:"workorder_id,omitempty"`
	Payload     map[string]any `json:"payload,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
}

var partsStore = struct {
	sync.RWMutex
	seq             int
	procurementSeq  int
	eventSeq        int
	usages          []partsUsage
	stockByPartCode map[string]partStock
	procurements    []procurementRequest
	events          []partsDomainEvent
}{
	stockByPartCode: map[string]partStock{
		"P-1":         {PartCode: "P-1", Available: 10, Reserved: 0, Consumed: 0, ReorderPoint: 3},
		"PART-OIL":    {PartCode: "PART-OIL", Available: 4, Reserved: 0, Consumed: 0, ReorderPoint: 2},
		"PART-FILTER": {PartCode: "PART-FILTER", Available: 1, Reserved: 0, Consumed: 0, ReorderPoint: 2},
	},
}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)
	mux.HandleFunc("/workorders/", workorderPartsHandler)
	mux.HandleFunc("/stock", stockHandler)
	mux.HandleFunc("/procurement/requests", procurementRequestsHandler)
	mux.HandleFunc("/events", partsEventsHandler)
}

func workorderPartsHandler(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 3 || parts[0] != "workorders" || parts[2] != "parts" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}

	workorderID := parts[1]

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
				request := appendProcurementRequest(workorderID, partCode, missing)
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

		partsStore.seq++
		entity := partsUsage{
			ID:          fmt.Sprintf("pu-%04d", partsStore.seq),
			WorkorderID: workorderID,
			PartCode:    partCode,
			Quantity:    req.Quantity,
			Action:      action,
			CreatedAt:   time.Now().UTC(),
		}
		partsStore.usages = append(partsStore.usages, entity)
		respondJSON(w, http.StatusCreated, map[string]any{
			"usage": entity,
			"stock": stock,
		})
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
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

func appendProcurementRequest(workorderID, partCode string, missingQuantity int) procurementRequest {
	partsStore.procurementSeq++
	request := procurementRequest{
		ID:              fmt.Sprintf("pr-%05d", partsStore.procurementSeq),
		WorkorderID:     workorderID,
		PartCode:        partCode,
		MissingQuantity: missingQuantity,
		Status:          "created",
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
