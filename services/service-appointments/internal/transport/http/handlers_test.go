package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetAppointmentStore() {
	appointmentStore.Lock()
	defer appointmentStore.Unlock()
	appointmentStore.seq = 0
	appointmentStore.eventSeq = 0
	appointmentStore.appointments = nil
	appointmentStore.events = nil
	appointmentStore.slots = []slot{
		{ID: "sl-001", Start: "2026-02-20T09:00:00Z", End: "2026-02-20T10:00:00Z", Bay: "A1", Status: "available", Capacity: 1, ReservedCount: 0},
		{ID: "sl-002", Start: "2026-02-20T10:00:00Z", End: "2026-02-20T11:00:00Z", Bay: "A2", Status: "available", Capacity: 1, ReservedCount: 0},
		{ID: "sl-003", Start: "2026-02-20T11:00:00Z", End: "2026-02-20T12:00:00Z", Bay: "B1", Status: "available", Capacity: 1, ReservedCount: 0},
	}
}

func TestCreateAppointment(t *testing.T) {
	resetAppointmentStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/appointments", strings.NewReader(`{"client_id":"cl-1","vehicle_vin":"VIN1","slot_id":"sl-001"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", rr.Code)
	}

	var got appointment
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Status != "scheduled" {
		t.Fatalf("expected status scheduled, got %q", got.Status)
	}
	if got.ServiceBay != "A1" {
		t.Fatalf("expected service bay A1, got %q", got.ServiceBay)
	}
}

func TestAppointmentValidation(t *testing.T) {
	resetAppointmentStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/appointments", strings.NewReader(`{"client_id":"cl-1"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rr.Code)
	}
}

func TestAppointmentSlotCapacity(t *testing.T) {
	resetAppointmentStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	firstReq := httptest.NewRequest(http.MethodPost, "/appointments", strings.NewReader(`{"client_id":"cl-1","vehicle_vin":"VIN1","slot_id":"sl-001"}`))
	firstReq.Header.Set("Content-Type", "application/json")
	firstRR := httptest.NewRecorder()
	mux.ServeHTTP(firstRR, firstReq)
	if firstRR.Code != http.StatusCreated {
		t.Fatalf("expected first appointment status 201, got %d", firstRR.Code)
	}

	secondReq := httptest.NewRequest(http.MethodPost, "/appointments", strings.NewReader(`{"client_id":"cl-2","vehicle_vin":"VIN2","slot_id":"sl-001"}`))
	secondReq.Header.Set("Content-Type", "application/json")
	secondRR := httptest.NewRecorder()
	mux.ServeHTTP(secondRR, secondReq)
	if secondRR.Code != http.StatusConflict {
		t.Fatalf("expected second appointment status 409, got %d", secondRR.Code)
	}
}

func TestCalendarLoadEndpoint(t *testing.T) {
	resetAppointmentStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	createReq := httptest.NewRequest(http.MethodPost, "/appointments", strings.NewReader(`{"client_id":"cl-1","vehicle_vin":"VIN1","slot_id":"sl-001"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRR := httptest.NewRecorder()
	mux.ServeHTTP(createRR, createReq)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", createRR.Code)
	}

	loadReq := httptest.NewRequest(http.MethodGet, "/calendar/load", nil)
	loadRR := httptest.NewRecorder()
	mux.ServeHTTP(loadRR, loadReq)
	if loadRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", loadRR.Code)
	}

	var payload []map[string]any
	if err := json.NewDecoder(loadRR.Body).Decode(&payload); err != nil {
		t.Fatalf("decode load payload: %v", err)
	}
	if len(payload) == 0 {
		t.Fatal("expected non-empty load payload")
	}
}

func TestCancelAppointmentReleasesSlot(t *testing.T) {
	resetAppointmentStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	createReq := httptest.NewRequest(http.MethodPost, "/appointments", strings.NewReader(`{"client_id":"cl-1","vehicle_vin":"VIN1","slot_id":"sl-001"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRR := httptest.NewRecorder()
	mux.ServeHTTP(createRR, createReq)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", createRR.Code)
	}

	var created appointment
	if err := json.NewDecoder(createRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode appointment: %v", err)
	}

	cancelReq := httptest.NewRequest(http.MethodPost, "/appointments/"+created.ID+"/status", strings.NewReader(`{"status":"cancelled"}`))
	cancelReq.Header.Set("Content-Type", "application/json")
	cancelRR := httptest.NewRecorder()
	mux.ServeHTTP(cancelRR, cancelReq)
	if cancelRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", cancelRR.Code)
	}

	secondReq := httptest.NewRequest(http.MethodPost, "/appointments", strings.NewReader(`{"client_id":"cl-2","vehicle_vin":"VIN2","slot_id":"sl-001"}`))
	secondReq.Header.Set("Content-Type", "application/json")
	secondRR := httptest.NewRecorder()
	mux.ServeHTTP(secondRR, secondReq)
	if secondRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", secondRR.Code)
	}
}
