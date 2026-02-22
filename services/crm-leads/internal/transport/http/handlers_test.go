package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetCRMLeadsStore() {
	crmLeadsStore.Lock()
	defer crmLeadsStore.Unlock()
	crmLeadsStore.leadSeq = 0
	crmLeadsStore.activitySeq = 0
	crmLeadsStore.eventSeq = 0
	crmLeadsStore.leads = nil
	crmLeadsStore.activities = nil
	crmLeadsStore.events = nil
}

func TestLeadsCreateDefaults(t *testing.T) {
	resetCRMLeadsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/leads", strings.NewReader(`{"title":"Inbound lead","contact_phone":"+1 (555) 000-11-22"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", rr.Code)
	}

	var got lead
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Status != "new" {
		t.Fatalf("expected status new, got %q", got.Status)
	}
	if got.Source != "manual" {
		t.Fatalf("expected source manual, got %q", got.Source)
	}
	if got.Channel != "manual" {
		t.Fatalf("expected channel manual, got %q", got.Channel)
	}
	if got.Route != "sales" {
		t.Fatalf("expected route sales, got %q", got.Route)
	}
	if got.SLAStatus != "on_track" {
		t.Fatalf("expected sla_status on_track, got %q", got.SLAStatus)
	}
}

func TestLeadDedupByPhone(t *testing.T) {
	resetCRMLeadsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	create := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/leads", strings.NewReader(`{"title":"Inbound lead","contact_phone":"+7 (999) 111-22-33","route":"sales"}`))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, req)
		return rr
	}

	first := create()
	if first.Code != http.StatusCreated {
		t.Fatalf("expected first create status 201, got %d", first.Code)
	}

	second := create()
	if second.Code != http.StatusConflict {
		t.Fatalf("expected duplicate create status 409, got %d", second.Code)
	}

	var payload map[string]any
	if err := json.NewDecoder(second.Body).Decode(&payload); err != nil {
		t.Fatalf("decode duplicate payload: %v", err)
	}
	if payload["duplicate_lead_id"] == "" {
		t.Fatalf("expected duplicate_lead_id in payload, got %+v", payload)
	}
}

func TestQualifyLeadPublishesEvent(t *testing.T) {
	resetCRMLeadsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	createReq := httptest.NewRequest(http.MethodPost, "/leads", strings.NewReader(`{"title":"Inbound lead","contact_email":"lead@example.com"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRR := httptest.NewRecorder()
	mux.ServeHTTP(createRR, createReq)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", createRR.Code)
	}

	var created lead
	if err := json.NewDecoder(createRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode created lead: %v", err)
	}

	qualifyReq := httptest.NewRequest(http.MethodPost, "/leads/"+created.ID+"/qualify", strings.NewReader(`{"owner":"agent-1","note":"qualified by call"}`))
	qualifyReq.Header.Set("Content-Type", "application/json")
	qualifyRR := httptest.NewRecorder()
	mux.ServeHTTP(qualifyRR, qualifyReq)

	if qualifyRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", qualifyRR.Code)
	}

	var qualified lead
	if err := json.NewDecoder(qualifyRR.Body).Decode(&qualified); err != nil {
		t.Fatalf("decode qualified lead: %v", err)
	}
	if qualified.Status != "qualified" {
		t.Fatalf("expected status qualified, got %q", qualified.Status)
	}

	eventsReq := httptest.NewRequest(http.MethodGet, "/events?event_type=LeadQualified", nil)
	eventsRR := httptest.NewRecorder()
	mux.ServeHTTP(eventsRR, eventsReq)
	if eventsRR.Code != http.StatusOK {
		t.Fatalf("expected events status 200, got %d", eventsRR.Code)
	}

	var events []domainEvent
	if err := json.NewDecoder(eventsRR.Body).Decode(&events); err != nil {
		t.Fatalf("decode events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected one LeadQualified event, got %d", len(events))
	}
}

func TestActivitiesValidation(t *testing.T) {
	resetCRMLeadsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/activities", strings.NewReader(`{"lead_id":"ld-1"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rr.Code)
	}
}

func TestActivityForUnknownLead(t *testing.T) {
	resetCRMLeadsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/activities", strings.NewReader(`{"lead_id":"ld-404","type":"call"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", rr.Code)
	}
}
