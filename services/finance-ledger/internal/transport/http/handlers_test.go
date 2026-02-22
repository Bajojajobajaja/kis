package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetLedgerStore() {
	ledgerStore.Lock()
	defer ledgerStore.Unlock()
	ledgerStore.accountSeq = 0
	ledgerStore.entrySeq = 0
	ledgerStore.eventSeq = 0
	ledgerStore.journalSeq = 0
	ledgerStore.lastHash = ""
	ledgerStore.entries = nil
	ledgerStore.events = nil
	ledgerStore.journal = nil
}

func TestPostEntryAndJournal(t *testing.T) {
	resetLedgerStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	postReq := httptest.NewRequest(http.MethodPost, "/ledger/post", strings.NewReader(`{"document":"sale-001","lines":[{"account_code":"1000","debit":1500},{"account_code":"4000","credit":1500}]}`))
	postReq.Header.Set("Content-Type", "application/json")
	postRR := httptest.NewRecorder()
	mux.ServeHTTP(postRR, postReq)

	if postRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", postRR.Code)
	}

	var created ledgerEntry
	if err := json.NewDecoder(postRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if created.TotalDebit != 1500 || created.TotalCredit != 1500 {
		t.Fatalf("expected balanced totals, got debit=%v credit=%v", created.TotalDebit, created.TotalCredit)
	}
	if created.Hash == "" {
		t.Fatalf("expected non-empty hash")
	}

	listReq := httptest.NewRequest(http.MethodGet, "/ledger/journal", nil)
	listRR := httptest.NewRecorder()
	mux.ServeHTTP(listRR, listReq)

	if listRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", listRR.Code)
	}

	var journal []journalRecord
	if err := json.NewDecoder(listRR.Body).Decode(&journal); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if len(journal) == 0 {
		t.Fatalf("expected journal to contain records")
	}
}

func TestPostFromEvent(t *testing.T) {
	resetLedgerStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	postReq := httptest.NewRequest(http.MethodPost, "/ledger/post-from-event", strings.NewReader(`{"event_type":"SalePaid","event_id":"evt-1","amount":2000}`))
	postReq.Header.Set("Content-Type", "application/json")
	postRR := httptest.NewRecorder()
	mux.ServeHTTP(postRR, postReq)
	if postRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", postRR.Code)
	}

	eventsReq := httptest.NewRequest(http.MethodGet, "/events", nil)
	eventsRR := httptest.NewRecorder()
	mux.ServeHTTP(eventsRR, eventsReq)
	if eventsRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", eventsRR.Code)
	}

	var events []ledgerEvent
	if err := json.NewDecoder(eventsRR.Body).Decode(&events); err != nil {
		t.Fatalf("decode events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
}
