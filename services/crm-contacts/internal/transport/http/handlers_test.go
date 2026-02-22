package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetCRMContactsStore() {
	crmContactsStore.Lock()
	defer crmContactsStore.Unlock()
	crmContactsStore.clientSeq = 0
	crmContactsStore.contactSeq = 0
	crmContactsStore.interactionSeq = 0
	crmContactsStore.clients = nil
	crmContactsStore.contacts = nil
	crmContactsStore.interactions = nil
}

func TestClientsCreateAndDefaultType(t *testing.T) {
	resetCRMContactsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/clients", strings.NewReader(`{"name":"Acme","preferences":["SUV","suv"],"tags":["VIP","vip"]}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", rr.Code)
	}

	var got client
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Type != "individual" {
		t.Fatalf("expected default type individual, got %q", got.Type)
	}
	if len(got.Preferences) != 1 || got.Preferences[0] != "suv" {
		t.Fatalf("expected normalized preferences, got %+v", got.Preferences)
	}
	if len(got.Tags) != 1 || got.Tags[0] != "vip" {
		t.Fatalf("expected normalized tags, got %+v", got.Tags)
	}
}

func TestContactsValidation(t *testing.T) {
	resetCRMContactsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/contacts", strings.NewReader(`{"name":"John"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rr.Code)
	}
}

func TestContactForUnknownClient(t *testing.T) {
	resetCRMContactsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/contacts", strings.NewReader(`{"client_id":"cl-404","name":"John"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", rr.Code)
	}
}

func TestClientCardAggregatesHistory(t *testing.T) {
	resetCRMContactsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	clientReq := httptest.NewRequest(http.MethodPost, "/clients", strings.NewReader(`{"name":"ACME Corp","phone":"+7 (999) 111-22-33"}`))
	clientReq.Header.Set("Content-Type", "application/json")
	clientRR := httptest.NewRecorder()
	mux.ServeHTTP(clientRR, clientReq)
	if clientRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", clientRR.Code)
	}

	var created client
	if err := json.NewDecoder(clientRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode client: %v", err)
	}

	contactReq := httptest.NewRequest(http.MethodPost, "/contacts", strings.NewReader(`{"client_id":"`+created.ID+`","name":"Jane","email":"Jane@Example.com"}`))
	contactReq.Header.Set("Content-Type", "application/json")
	contactRR := httptest.NewRecorder()
	mux.ServeHTTP(contactRR, contactReq)
	if contactRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", contactRR.Code)
	}

	var createdContact contact
	if err := json.NewDecoder(contactRR.Body).Decode(&createdContact); err != nil {
		t.Fatalf("decode contact: %v", err)
	}

	interactionReq := httptest.NewRequest(http.MethodPost, "/interactions", strings.NewReader(`{"client_id":"`+created.ID+`","contact_id":"`+createdContact.ID+`","kind":"call","note":"Initial qualification"}`))
	interactionReq.Header.Set("Content-Type", "application/json")
	interactionRR := httptest.NewRecorder()
	mux.ServeHTTP(interactionRR, interactionReq)
	if interactionRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", interactionRR.Code)
	}

	cardReq := httptest.NewRequest(http.MethodGet, "/clients/"+created.ID, nil)
	cardRR := httptest.NewRecorder()
	mux.ServeHTTP(cardRR, cardReq)
	if cardRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", cardRR.Code)
	}

	var card clientCard
	if err := json.NewDecoder(cardRR.Body).Decode(&card); err != nil {
		t.Fatalf("decode card: %v", err)
	}
	if card.Summary.ContactsCount != 1 {
		t.Fatalf("expected contacts_count=1, got %d", card.Summary.ContactsCount)
	}
	if card.Summary.InteractionsCount != 1 {
		t.Fatalf("expected interactions_count=1, got %d", card.Summary.InteractionsCount)
	}
}

func TestUpdateClientPreferences(t *testing.T) {
	resetCRMContactsStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	createReq := httptest.NewRequest(http.MethodPost, "/clients", strings.NewReader(`{"name":"ACME"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRR := httptest.NewRecorder()
	mux.ServeHTTP(createRR, createReq)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", createRR.Code)
	}

	var created client
	if err := json.NewDecoder(createRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode created client: %v", err)
	}

	updateReq := httptest.NewRequest(http.MethodPut, "/clients/"+created.ID, strings.NewReader(`{"preferences":["sedan","Sedan"],"tags":["fleet"]}`))
	updateReq.Header.Set("Content-Type", "application/json")
	updateRR := httptest.NewRecorder()
	mux.ServeHTTP(updateRR, updateReq)
	if updateRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", updateRR.Code)
	}

	var updated client
	if err := json.NewDecoder(updateRR.Body).Decode(&updated); err != nil {
		t.Fatalf("decode updated client: %v", err)
	}
	if len(updated.Preferences) != 1 || updated.Preferences[0] != "sedan" {
		t.Fatalf("expected normalized preferences, got %+v", updated.Preferences)
	}
	if len(updated.Tags) != 1 || updated.Tags[0] != "fleet" {
		t.Fatalf("expected tags [fleet], got %+v", updated.Tags)
	}
}
