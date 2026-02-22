package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetCatalogStore() {
	catalogStore.Lock()
	defer catalogStore.Unlock()
	catalogStore.carSeq = 0
	catalogStore.partSeq = 0
	catalogStore.eventSeq = 0
	catalogStore.cars = nil
	catalogStore.parts = nil
	catalogStore.events = nil
}

func TestPartDefaultUnit(t *testing.T) {
	resetCatalogStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/catalog/parts", strings.NewReader(`{"code":"P-1","name":"Oil"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", rr.Code)
	}

	var got partItem
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Unit != "pcs" {
		t.Fatalf("expected default unit pcs, got %q", got.Unit)
	}
}
