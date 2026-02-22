package httptransport

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

type stockItem struct {
	ID             string    `json:"id"`
	SKU            string    `json:"sku"`
	Location       string    `json:"location"`
	OnHand         int       `json:"on_hand"`
	Reserved       int       `json:"reserved"`
	MinQty         int       `json:"min_qty"`
	MaxQty         int       `json:"max_qty"`
	ReorderPoint   int       `json:"reorder_point"`
	LastMovementAt time.Time `json:"last_movement_at"`
}

type stockMovement struct {
	ID        string    `json:"id"`
	SKU       string    `json:"sku"`
	Type      string    `json:"type"`
	From      string    `json:"from,omitempty"`
	To        string    `json:"to,omitempty"`
	Quantity  int       `json:"quantity"`
	Note      string    `json:"note,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type stockEvent struct {
	ID        string         `json:"id"`
	EventType string         `json:"event_type"`
	EntityID  string         `json:"entity_id"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

type replenishmentRecommendation struct {
	SKU               string  `json:"sku"`
	Location          string  `json:"location"`
	Available         int     `json:"available"`
	ReorderPoint      int     `json:"reorder_point"`
	RecommendedQty    int     `json:"recommended_qty"`
	AverageDailyIssue float64 `json:"average_daily_issue"`
	DaysCover         float64 `json:"days_cover"`
	SlowMoving        bool    `json:"slow_moving"`
}

var stockStore = struct {
	sync.RWMutex
	itemSeq     int
	movementSeq int
	eventSeq    int
	items       []stockItem
	movements   []stockMovement
	events      []stockEvent
}{
	items: []stockItem{
		{ID: "st-0001", SKU: "PART-OIL", Location: "main", OnHand: 20, Reserved: 2, MinQty: 5, MaxQty: 40, ReorderPoint: 8, LastMovementAt: time.Now().UTC()},
		{ID: "st-0002", SKU: "PART-FILTER", Location: "main", OnHand: 3, Reserved: 1, MinQty: 4, MaxQty: 25, ReorderPoint: 6, LastMovementAt: time.Now().UTC()},
	},
}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)
	mux.HandleFunc("/stock", stockHandler)
	mux.HandleFunc("/stock/movements", movementsHandler)
	mux.HandleFunc("/stock/reserve", reserveHandler)
	mux.HandleFunc("/stock/release", releaseHandler)
	mux.HandleFunc("/stock/issue", issueHandler)
	mux.HandleFunc("/stock/replenishment/recommendations", replenishmentRecommendationsHandler)
	mux.HandleFunc("/events", stockEventsHandler)
}

func stockHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		stockStore.RLock()
		defer stockStore.RUnlock()
		skuFilter := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("sku")))
		locationFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("location")))
		out := make([]stockItem, 0, len(stockStore.items))
		for _, entity := range stockStore.items {
			if skuFilter != "" && entity.SKU != skuFilter {
				continue
			}
			if locationFilter != "" && strings.ToLower(entity.Location) != locationFilter {
				continue
			}
			out = append(out, entity)
		}
		respondJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req struct {
			SKU          string `json:"sku"`
			Location     string `json:"location"`
			OnHand       int    `json:"on_hand"`
			Reserved     int    `json:"reserved"`
			MinQty       int    `json:"min_qty"`
			MaxQty       int    `json:"max_qty"`
			ReorderPoint int    `json:"reorder_point"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if strings.TrimSpace(req.SKU) == "" {
			respondError(w, http.StatusBadRequest, "sku is required")
			return
		}
		if req.OnHand < 0 || req.Reserved < 0 {
			respondError(w, http.StatusBadRequest, "on_hand and reserved must be non-negative")
			return
		}
		if req.MaxQty > 0 && req.MinQty > req.MaxQty {
			respondError(w, http.StatusBadRequest, "min_qty cannot exceed max_qty")
			return
		}
		if req.Reserved > req.OnHand {
			respondError(w, http.StatusBadRequest, "reserved cannot exceed on_hand")
			return
		}

		stockStore.Lock()
		defer stockStore.Unlock()
		sku := strings.ToUpper(strings.TrimSpace(req.SKU))
		location := defaultValue(strings.ToLower(strings.TrimSpace(req.Location)), "main")
		index := findStockItemIndex(sku, location)
		now := time.Now().UTC()
		if index >= 0 {
			entity := stockStore.items[index]
			entity.OnHand = req.OnHand
			entity.Reserved = req.Reserved
			if req.MinQty > 0 {
				entity.MinQty = req.MinQty
			}
			if req.MaxQty > 0 {
				entity.MaxQty = req.MaxQty
			}
			if req.ReorderPoint > 0 {
				entity.ReorderPoint = req.ReorderPoint
			}
			entity.LastMovementAt = now
			stockStore.items[index] = entity
			appendStockEvent("StockAdjusted", entity.SKU+"@"+entity.Location, map[string]any{"on_hand": entity.OnHand, "reserved": entity.Reserved})
			respondJSON(w, http.StatusOK, entity)
			return
		}

		stockStore.itemSeq++
		entity := stockItem{
			ID:             fmt.Sprintf("st-%04d", stockStore.itemSeq),
			SKU:            sku,
			Location:       location,
			OnHand:         req.OnHand,
			Reserved:       req.Reserved,
			MinQty:         req.MinQty,
			MaxQty:         req.MaxQty,
			ReorderPoint:   fallbackInt(req.ReorderPoint, req.MinQty),
			LastMovementAt: now,
		}
		stockStore.items = append(stockStore.items, entity)
		appendStockEvent("StockPositionCreated", entity.SKU+"@"+entity.Location, map[string]any{"on_hand": entity.OnHand})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func movementsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		stockStore.RLock()
		defer stockStore.RUnlock()
		skuFilter := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("sku")))
		typeFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("type")))
		out := make([]stockMovement, 0, len(stockStore.movements))
		for _, entity := range stockStore.movements {
			if skuFilter != "" && entity.SKU != skuFilter {
				continue
			}
			if typeFilter != "" && strings.ToLower(entity.Type) != typeFilter {
				continue
			}
			out = append(out, entity)
		}
		respondJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req struct {
			SKU      string `json:"sku"`
			Type     string `json:"type"`
			From     string `json:"from"`
			To       string `json:"to"`
			Location string `json:"location"`
			Quantity int    `json:"quantity"`
			Note     string `json:"note"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		sku := strings.ToUpper(strings.TrimSpace(req.SKU))
		movementType := strings.ToLower(strings.TrimSpace(req.Type))
		if sku == "" || movementType == "" {
			respondError(w, http.StatusBadRequest, "sku and type are required")
			return
		}
		if movementType != "adjust" && req.Quantity <= 0 {
			respondError(w, http.StatusBadRequest, "quantity must be positive")
			return
		}
		if movementType == "adjust" && req.Quantity == 0 {
			respondError(w, http.StatusBadRequest, "quantity for adjust cannot be zero")
			return
		}

		stockStore.Lock()
		defer stockStore.Unlock()
		now := time.Now().UTC()
		from := normalizeLocation(req.From)
		to := normalizeLocation(req.To)
		location := normalizeLocation(req.Location)
		quantity := req.Quantity

		switch movementType {
		case "receipt":
			targetLocation := to
			if targetLocation == "" {
				targetLocation = defaultValue(location, "main")
			}
			item := getOrCreateStockItem(sku, targetLocation)
			item.OnHand += quantity
			item.LastMovementAt = now
			upsertStockItem(item)
			appendStockEvent("GoodsReceived", sku+"@"+targetLocation, map[string]any{"quantity": quantity})
		case "issue":
			sourceLocation := from
			if sourceLocation == "" {
				sourceLocation = defaultValue(location, "main")
			}
			index := findStockItemIndex(sku, sourceLocation)
			if index < 0 {
				respondError(w, http.StatusNotFound, "stock item not found")
				return
			}
			available := stockStore.items[index].OnHand - stockStore.items[index].Reserved
			if available < quantity {
				respondError(w, http.StatusBadRequest, "not enough available stock")
				return
			}
			stockStore.items[index].OnHand -= quantity
			stockStore.items[index].LastMovementAt = now
			appendStockEvent("PartsIssued", sku+"@"+sourceLocation, map[string]any{"quantity": quantity})
		case "transfer":
			if from == "" || to == "" {
				respondError(w, http.StatusBadRequest, "from and to are required for transfer")
				return
			}
			fromIndex := findStockItemIndex(sku, from)
			if fromIndex < 0 {
				respondError(w, http.StatusNotFound, "source stock item not found")
				return
			}
			available := stockStore.items[fromIndex].OnHand - stockStore.items[fromIndex].Reserved
			if available < quantity {
				respondError(w, http.StatusBadRequest, "not enough available stock for transfer")
				return
			}
			stockStore.items[fromIndex].OnHand -= quantity
			stockStore.items[fromIndex].LastMovementAt = now
			toItem := getOrCreateStockItem(sku, to)
			toItem.OnHand += quantity
			toItem.LastMovementAt = now
			upsertStockItem(toItem)
			appendStockEvent("StockTransferred", sku, map[string]any{"from": from, "to": to, "quantity": quantity})
		case "adjust":
			targetLocation := defaultValue(location, "main")
			index := findStockItemIndex(sku, targetLocation)
			if index < 0 {
				respondError(w, http.StatusNotFound, "stock item not found")
				return
			}
			if stockStore.items[index].OnHand+quantity < stockStore.items[index].Reserved {
				respondError(w, http.StatusBadRequest, "adjustment would violate reserved quantity")
				return
			}
			stockStore.items[index].OnHand += quantity
			stockStore.items[index].LastMovementAt = now
			appendStockEvent("StockAdjusted", sku+"@"+targetLocation, map[string]any{"delta": quantity})
		default:
			respondError(w, http.StatusBadRequest, "unsupported movement type")
			return
		}

		stockStore.movementSeq++
		movement := stockMovement{
			ID:        fmt.Sprintf("mv-%05d", stockStore.movementSeq),
			SKU:       sku,
			Type:      movementType,
			From:      from,
			To:        to,
			Quantity:  quantity,
			Note:      strings.TrimSpace(req.Note),
			CreatedAt: now,
		}
		stockStore.movements = append(stockStore.movements, movement)
		respondJSON(w, http.StatusCreated, movement)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func reserveHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		SKU       string `json:"sku"`
		Location  string `json:"location"`
		Quantity  int    `json:"quantity"`
		Reference string `json:"reference"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.SKU) == "" || req.Quantity <= 0 {
		respondError(w, http.StatusBadRequest, "sku and positive quantity are required")
		return
	}
	sku := strings.ToUpper(strings.TrimSpace(req.SKU))
	location := defaultValue(normalizeLocation(req.Location), "main")

	stockStore.Lock()
	defer stockStore.Unlock()
	index := findStockItemIndex(sku, location)
	if index < 0 {
		respondError(w, http.StatusNotFound, "stock item not found")
		return
	}
	available := stockStore.items[index].OnHand - stockStore.items[index].Reserved
	if available < req.Quantity {
		respondError(w, http.StatusBadRequest, "not enough available stock")
		return
	}
	stockStore.items[index].Reserved += req.Quantity
	stockStore.items[index].LastMovementAt = time.Now().UTC()
	appendStockEvent("StockReserved", sku+"@"+location, map[string]any{"quantity": req.Quantity, "reference": req.Reference})
	appendStockMovementLocked(sku, "reserve", "", location, req.Quantity, req.Reference)
	respondJSON(w, http.StatusOK, stockStore.items[index])
}

func releaseHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		SKU       string `json:"sku"`
		Location  string `json:"location"`
		Quantity  int    `json:"quantity"`
		Reference string `json:"reference"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.SKU) == "" || req.Quantity <= 0 {
		respondError(w, http.StatusBadRequest, "sku and positive quantity are required")
		return
	}
	sku := strings.ToUpper(strings.TrimSpace(req.SKU))
	location := defaultValue(normalizeLocation(req.Location), "main")

	stockStore.Lock()
	defer stockStore.Unlock()
	index := findStockItemIndex(sku, location)
	if index < 0 {
		respondError(w, http.StatusNotFound, "stock item not found")
		return
	}
	if stockStore.items[index].Reserved < req.Quantity {
		respondError(w, http.StatusBadRequest, "not enough reserved stock")
		return
	}
	stockStore.items[index].Reserved -= req.Quantity
	stockStore.items[index].LastMovementAt = time.Now().UTC()
	appendStockEvent("StockReleased", sku+"@"+location, map[string]any{"quantity": req.Quantity, "reference": req.Reference})
	appendStockMovementLocked(sku, "release", "", location, req.Quantity, req.Reference)
	respondJSON(w, http.StatusOK, stockStore.items[index])
}

func issueHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		SKU       string `json:"sku"`
		Location  string `json:"location"`
		Quantity  int    `json:"quantity"`
		Source    string `json:"source"`
		Reference string `json:"reference"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.SKU) == "" || req.Quantity <= 0 {
		respondError(w, http.StatusBadRequest, "sku and positive quantity are required")
		return
	}
	sku := strings.ToUpper(strings.TrimSpace(req.SKU))
	location := defaultValue(normalizeLocation(req.Location), "main")

	stockStore.Lock()
	defer stockStore.Unlock()
	index := findStockItemIndex(sku, location)
	if index < 0 {
		respondError(w, http.StatusNotFound, "stock item not found")
		return
	}
	item := stockStore.items[index]
	if item.OnHand < req.Quantity {
		respondError(w, http.StatusBadRequest, "not enough stock")
		return
	}
	if item.Reserved >= req.Quantity {
		item.Reserved -= req.Quantity
	}
	item.OnHand -= req.Quantity
	item.LastMovementAt = time.Now().UTC()
	stockStore.items[index] = item
	appendStockEvent("PartsIssued", sku+"@"+location, map[string]any{"quantity": req.Quantity, "source": req.Source, "reference": req.Reference})
	appendStockMovementLocked(sku, "issue", location, "", req.Quantity, req.Source+" "+req.Reference)
	respondJSON(w, http.StatusOK, item)
}

func replenishmentRecommendationsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	stockStore.RLock()
	defer stockStore.RUnlock()

	issueByKey := map[string]int{}
	windowStart := time.Now().UTC().Add(-30 * 24 * time.Hour)
	for _, movement := range stockStore.movements {
		if movement.Type != "issue" || movement.CreatedAt.Before(windowStart) {
			continue
		}
		location := defaultValue(strings.ToLower(strings.TrimSpace(movement.From)), "main")
		key := movement.SKU + "@" + location
		issueByKey[key] += movement.Quantity
	}

	recommendations := make([]replenishmentRecommendation, 0)
	for _, item := range stockStore.items {
		available := item.OnHand - item.Reserved
		key := item.SKU + "@" + item.Location
		avgDailyIssue := float64(issueByKey[key]) / 30.0
		daysCover := 999.0
		if avgDailyIssue > 0 {
			daysCover = round2(float64(available) / avgDailyIssue)
		}
		recommended := 0
		if available <= item.ReorderPoint || (item.MinQty > 0 && available < item.MinQty) {
			target := item.MaxQty
			if target == 0 {
				target = maxInt(item.ReorderPoint*2, item.MinQty*2)
			}
			recommended = maxInt(target-available, 0)
		}
		slowMoving := avgDailyIssue < 0.2 && available > item.ReorderPoint && item.OnHand > 0
		if recommended == 0 && !slowMoving {
			continue
		}
		recommendations = append(recommendations, replenishmentRecommendation{
			SKU:               item.SKU,
			Location:          item.Location,
			Available:         available,
			ReorderPoint:      item.ReorderPoint,
			RecommendedQty:    recommended,
			AverageDailyIssue: round2(avgDailyIssue),
			DaysCover:         daysCover,
			SlowMoving:        slowMoving,
		})
	}

	sort.Slice(recommendations, func(i, j int) bool {
		if recommendations[i].RecommendedQty == recommendations[j].RecommendedQty {
			return recommendations[i].SKU < recommendations[j].SKU
		}
		return recommendations[i].RecommendedQty > recommendations[j].RecommendedQty
	})
	respondJSON(w, http.StatusOK, recommendations)
}

func stockEventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	stockStore.RLock()
	defer stockStore.RUnlock()
	respondJSON(w, http.StatusOK, stockStore.events)
}

func findStockItemIndex(sku, location string) int {
	for i := range stockStore.items {
		if stockStore.items[i].SKU == sku && strings.EqualFold(stockStore.items[i].Location, location) {
			return i
		}
	}
	return -1
}

func getOrCreateStockItem(sku, location string) stockItem {
	index := findStockItemIndex(sku, location)
	if index >= 0 {
		return stockStore.items[index]
	}
	stockStore.itemSeq++
	return stockItem{
		ID:             fmt.Sprintf("st-%04d", stockStore.itemSeq),
		SKU:            sku,
		Location:       location,
		OnHand:         0,
		Reserved:       0,
		MinQty:         0,
		MaxQty:         0,
		ReorderPoint:   0,
		LastMovementAt: time.Now().UTC(),
	}
}

func upsertStockItem(value stockItem) {
	index := findStockItemIndex(value.SKU, value.Location)
	if index >= 0 {
		stockStore.items[index] = value
		return
	}
	stockStore.items = append(stockStore.items, value)
}

func appendStockMovementLocked(sku, movementType, from, to string, quantity int, note string) {
	stockStore.movementSeq++
	stockStore.movements = append(stockStore.movements, stockMovement{
		ID:        fmt.Sprintf("mv-%05d", stockStore.movementSeq),
		SKU:       sku,
		Type:      movementType,
		From:      normalizeLocation(from),
		To:        normalizeLocation(to),
		Quantity:  quantity,
		Note:      strings.TrimSpace(note),
		CreatedAt: time.Now().UTC(),
	})
}

func appendStockEvent(eventType, entityID string, payload map[string]any) {
	stockStore.eventSeq++
	stockStore.events = append(stockStore.events, stockEvent{
		ID:        fmt.Sprintf("ise-%05d", stockStore.eventSeq),
		EventType: eventType,
		EntityID:  entityID,
		Payload:   payload,
		CreatedAt: time.Now().UTC(),
	})
}

func normalizeLocation(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func fallbackInt(value, fallback int) int {
	if value != 0 {
		return value
	}
	return fallback
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func round2(value float64) float64 {
	return math.Round(value*100) / 100
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "inventory-stock",
		"status":  "ok",
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "inventory-stock",
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
