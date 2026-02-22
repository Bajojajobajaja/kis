package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

type slot struct {
	ID            string `json:"id"`
	Start         string `json:"start"`
	End           string `json:"end"`
	Bay           string `json:"bay"`
	Status        string `json:"status"`
	Capacity      int    `json:"capacity"`
	ReservedCount int    `json:"reserved_count"`
}

type appointment struct {
	ID          string    `json:"id"`
	ClientID    string    `json:"client_id"`
	VehicleVIN  string    `json:"vehicle_vin"`
	Reason      string    `json:"reason"`
	AdvisorID   string    `json:"advisor_id,omitempty"`
	SlotID      string    `json:"slot_id"`
	ServiceBay  string    `json:"service_bay"`
	Status      string    `json:"status"`
	SLADeadline string    `json:"sla_deadline"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type appointmentEvent struct {
	ID        string         `json:"id"`
	EventType string         `json:"event_type"`
	EntityID  string         `json:"entity_id"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

var appointmentStore = struct {
	sync.RWMutex
	seq          int
	eventSeq     int
	slots        []slot
	appointments []appointment
	events       []appointmentEvent
}{
	slots: []slot{
		{ID: "sl-001", Start: "2026-02-20T09:00:00Z", End: "2026-02-20T10:00:00Z", Bay: "A1", Status: "available", Capacity: 1, ReservedCount: 0},
		{ID: "sl-002", Start: "2026-02-20T10:00:00Z", End: "2026-02-20T11:00:00Z", Bay: "A2", Status: "available", Capacity: 1, ReservedCount: 0},
		{ID: "sl-003", Start: "2026-02-20T11:00:00Z", End: "2026-02-20T12:00:00Z", Bay: "B1", Status: "available", Capacity: 1, ReservedCount: 0},
	},
}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)
	mux.HandleFunc("/slots", slotsHandler)
	mux.HandleFunc("/calendar/load", calendarLoadHandler)
	mux.HandleFunc("/appointments", appointmentsHandler)
	mux.HandleFunc("/appointments/", appointmentActionHandler)
	mux.HandleFunc("/events", appointmentEventsHandler)
}

func slotsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	appointmentStore.RLock()
	defer appointmentStore.RUnlock()
	bayFilter := strings.TrimSpace(strings.ToUpper(r.URL.Query().Get("bay")))
	filtered := make([]slot, 0, len(appointmentStore.slots))
	for _, entity := range appointmentStore.slots {
		if bayFilter != "" && strings.ToUpper(entity.Bay) != bayFilter {
			continue
		}
		filtered = append(filtered, entity)
	}
	respondJSON(w, http.StatusOK, filtered)
}

func calendarLoadHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	appointmentStore.RLock()
	defer appointmentStore.RUnlock()
	loadByBay := map[string]map[string]any{}
	for _, entity := range appointmentStore.slots {
		bay := entity.Bay
		if _, ok := loadByBay[bay]; !ok {
			loadByBay[bay] = map[string]any{
				"bay":       bay,
				"slots":     0,
				"reserved":  0,
				"capacity":  0,
				"workload":  0.0,
				"available": 0,
			}
		}
		loadByBay[bay]["slots"] = loadByBay[bay]["slots"].(int) + 1
		loadByBay[bay]["reserved"] = loadByBay[bay]["reserved"].(int) + entity.ReservedCount
		loadByBay[bay]["capacity"] = loadByBay[bay]["capacity"].(int) + defaultInt(entity.Capacity, 1)
		if entity.Status == "available" {
			loadByBay[bay]["available"] = loadByBay[bay]["available"].(int) + 1
		}
	}

	result := make([]map[string]any, 0, len(loadByBay))
	for _, value := range loadByBay {
		capacity := value["capacity"].(int)
		reserved := value["reserved"].(int)
		workload := 0.0
		if capacity > 0 {
			workload = roundPercent(float64(reserved) * 100 / float64(capacity))
		}
		value["workload"] = workload
		result = append(result, value)
	}
	respondJSON(w, http.StatusOK, result)
}

func appointmentsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		appointmentStore.RLock()
		defer appointmentStore.RUnlock()
		statusFilter := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("status")))
		filtered := make([]appointment, 0, len(appointmentStore.appointments))
		for _, entity := range appointmentStore.appointments {
			if statusFilter != "" && strings.ToLower(entity.Status) != statusFilter {
				continue
			}
			filtered = append(filtered, entity)
		}
		respondJSON(w, http.StatusOK, filtered)
	case http.MethodPost:
		var req struct {
			ClientID   string `json:"client_id"`
			VehicleVIN string `json:"vehicle_vin"`
			Reason     string `json:"reason"`
			SlotID     string `json:"slot_id"`
			AdvisorID  string `json:"advisor_id"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.ClientID == "" || req.VehicleVIN == "" || req.SlotID == "" {
			respondError(w, http.StatusBadRequest, "client_id, vehicle_vin and slot_id are required")
			return
		}

		appointmentStore.Lock()
		defer appointmentStore.Unlock()
		slotIndex := findSlotIndex(req.SlotID)
		if slotIndex < 0 {
			respondError(w, http.StatusNotFound, "slot not found")
			return
		}
		slotEntity := appointmentStore.slots[slotIndex]
		if slotEntity.Status != "available" {
			respondError(w, http.StatusConflict, "slot is not available")
			return
		}
		if slotEntity.ReservedCount >= defaultInt(slotEntity.Capacity, 1) {
			respondError(w, http.StatusConflict, "slot capacity exceeded")
			return
		}

		appointmentStore.seq++
		now := time.Now().UTC()
		slaDeadline := calculateAppointmentSLA(slotEntity.Start, now)
		entity := appointment{
			ID:          fmt.Sprintf("ap-%04d", appointmentStore.seq),
			ClientID:    req.ClientID,
			VehicleVIN:  strings.ToUpper(strings.TrimSpace(req.VehicleVIN)),
			Reason:      req.Reason,
			AdvisorID:   strings.TrimSpace(req.AdvisorID),
			SlotID:      req.SlotID,
			ServiceBay:  slotEntity.Bay,
			Status:      "scheduled",
			SLADeadline: slaDeadline.Format(time.RFC3339),
			CreatedAt:   now,
			UpdatedAt:   now,
		}
		appointmentStore.appointments = append(appointmentStore.appointments, entity)
		appointmentStore.slots[slotIndex].ReservedCount++
		if appointmentStore.slots[slotIndex].ReservedCount >= defaultInt(appointmentStore.slots[slotIndex].Capacity, 1) {
			appointmentStore.slots[slotIndex].Status = "reserved"
		}
		appendAppointmentEvent("BookingCreated", entity.ID, map[string]any{
			"slot_id":     entity.SlotID,
			"service_bay": entity.ServiceBay,
			"sla_due_at":  entity.SLADeadline,
		})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func appointmentActionHandler(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 3 || parts[0] != "appointments" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}

	appointmentID := parts[1]
	action := parts[2]
	switch action {
	case "status":
		updateAppointmentStatusHandler(w, r, appointmentID)
	default:
		respondError(w, http.StatusNotFound, "route not found")
	}
}

func updateAppointmentStatusHandler(w http.ResponseWriter, r *http.Request, appointmentID string) {
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
	if req.Status == "" {
		respondError(w, http.StatusBadRequest, "status is required")
		return
	}
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if !isAllowedAppointmentStatus(status) {
		respondError(w, http.StatusBadRequest, "unsupported status")
		return
	}

	appointmentStore.Lock()
	defer appointmentStore.Unlock()
	index := findAppointmentIndex(appointmentID)
	if index < 0 {
		respondError(w, http.StatusNotFound, "appointment not found")
		return
	}

	previousStatus := appointmentStore.appointments[index].Status
	slotIndex := findSlotIndex(appointmentStore.appointments[index].SlotID)
	if slotIndex < 0 {
		respondError(w, http.StatusNotFound, "slot not found for appointment")
		return
	}
	if consumesSlot(previousStatus) && !consumesSlot(status) {
		if appointmentStore.slots[slotIndex].ReservedCount > 0 {
			appointmentStore.slots[slotIndex].ReservedCount--
		}
		if appointmentStore.slots[slotIndex].ReservedCount < defaultInt(appointmentStore.slots[slotIndex].Capacity, 1) {
			appointmentStore.slots[slotIndex].Status = "available"
		}
	}
	if !consumesSlot(previousStatus) && consumesSlot(status) {
		if appointmentStore.slots[slotIndex].ReservedCount >= defaultInt(appointmentStore.slots[slotIndex].Capacity, 1) {
			respondError(w, http.StatusConflict, "slot capacity exceeded")
			return
		}
		appointmentStore.slots[slotIndex].ReservedCount++
		if appointmentStore.slots[slotIndex].ReservedCount >= defaultInt(appointmentStore.slots[slotIndex].Capacity, 1) {
			appointmentStore.slots[slotIndex].Status = "reserved"
		}
	}
	appointmentStore.appointments[index].Status = status
	appointmentStore.appointments[index].UpdatedAt = time.Now().UTC()
	appendAppointmentEvent("BookingStatusChanged", appointmentID, map[string]any{
		"from": previousStatus,
		"to":   status,
	})
	if status == "cancelled" {
		appendAppointmentEvent("BookingCancelled", appointmentID, map[string]any{
			"slot_id": appointmentStore.appointments[index].SlotID,
		})
	}
	respondJSON(w, http.StatusOK, appointmentStore.appointments[index])
}

func appointmentEventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	appointmentStore.RLock()
	defer appointmentStore.RUnlock()
	respondJSON(w, http.StatusOK, appointmentStore.events)
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "service-appointments",
		"status":  "ok",
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "service-appointments",
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

func findSlotIndex(slotID string) int {
	for i := range appointmentStore.slots {
		if appointmentStore.slots[i].ID == slotID {
			return i
		}
	}
	return -1
}

func findAppointmentIndex(appointmentID string) int {
	for i := range appointmentStore.appointments {
		if appointmentStore.appointments[i].ID == appointmentID {
			return i
		}
	}
	return -1
}

func calculateAppointmentSLA(slotStart string, fallback time.Time) time.Time {
	parsed, err := time.Parse(time.RFC3339, slotStart)
	if err != nil {
		return fallback.Add(2 * time.Hour)
	}
	return parsed.Add(-2 * time.Hour)
}

func appendAppointmentEvent(eventType, entityID string, payload map[string]any) {
	appointmentStore.eventSeq++
	appointmentStore.events = append(appointmentStore.events, appointmentEvent{
		ID:        fmt.Sprintf("ape-%05d", appointmentStore.eventSeq),
		EventType: eventType,
		EntityID:  entityID,
		Payload:   payload,
		CreatedAt: time.Now().UTC(),
	})
}

func defaultInt(value, fallback int) int {
	if value == 0 {
		return fallback
	}
	return value
}

func isAllowedAppointmentStatus(status string) bool {
	switch status {
	case "scheduled", "confirmed", "completed", "cancelled", "no_show":
		return true
	default:
		return false
	}
}

func roundPercent(value float64) float64 {
	return float64(int(value*100+0.5)) / 100
}

func consumesSlot(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "scheduled", "confirmed":
		return true
	default:
		return false
	}
}
