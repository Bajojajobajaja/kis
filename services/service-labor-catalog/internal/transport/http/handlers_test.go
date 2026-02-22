package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetLaborCatalogStore() {
	laborCatalogStore.Lock()
	defer laborCatalogStore.Unlock()
	laborCatalogStore.eventSeq = 0
	laborCatalogStore.items = []laborItem{
		{
			Code:             "LBR-OIL",
			Name:             "Oil Change",
			Category:         "maintenance",
			NormHours:        1.2,
			HourlyRate:       85,
			WarrantyEligible: false,
			RequiredParts:    []string{"PART-OIL-FILTER", "PART-ENGINE-OIL"},
		},
		{
			Code:             "LBR-BRAKE",
			Name:             "Brake Diagnostics",
			Category:         "diagnostics",
			NormHours:        1.5,
			HourlyRate:       95,
			WarrantyEligible: true,
		},
	}
	laborCatalogStore.events = nil
}

func TestHealthAndReady(t *testing.T) {
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	cases := []struct {
		path    string
		service string
		status  string
	}{
		{path: "/healthz", service: "service-labor-catalog", status: "ok"},
		{path: "/readyz", service: "service-labor-catalog", status: "ready"},
	}

	for _, tc := range cases {
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("%s: expected status 200, got %d", tc.path, rr.Code)
		}

		var got map[string]string
		if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
			t.Fatalf("%s: decode response: %v", tc.path, err)
		}

		if got["service"] != tc.service {
			t.Fatalf("%s: expected service %q, got %q", tc.path, tc.service, got["service"])
		}
		if got["status"] != tc.status {
			t.Fatalf("%s: expected status %q, got %q", tc.path, tc.status, got["status"])
		}
	}
}

func TestCreateLaborItemAndEstimate(t *testing.T) {
	resetLaborCatalogStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	createReq := httptest.NewRequest(http.MethodPost, "/labor/catalog", strings.NewReader(`{
		"code":"lbr-filter",
		"name":"Filter replacement",
		"category":"maintenance",
		"norm_hours":1.1,
		"hourly_rate":90,
		"required_parts":["part-filter"]
	}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRR := httptest.NewRecorder()
	mux.ServeHTTP(createRR, createReq)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", createRR.Code)
	}

	var created laborItem
	if err := json.NewDecoder(createRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode created item: %v", err)
	}
	if created.Code != "LBR-FILTER" {
		t.Fatalf("expected normalized code LBR-FILTER, got %q", created.Code)
	}

	estimateReq := httptest.NewRequest(http.MethodPost, "/labor/estimate", strings.NewReader(`{
		"lines":[
			{"code":"LBR-FILTER","quantity":2},
			{"code":"LBR-BRAKE","quantity":1}
		]
	}`))
	estimateReq.Header.Set("Content-Type", "application/json")
	estimateRR := httptest.NewRecorder()
	mux.ServeHTTP(estimateRR, estimateReq)
	if estimateRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", estimateRR.Code)
	}

	var estimate map[string]any
	if err := json.NewDecoder(estimateRR.Body).Decode(&estimate); err != nil {
		t.Fatalf("decode estimate response: %v", err)
	}
	if estimate["labor_total"] == nil {
		t.Fatalf("expected labor_total in estimate response, got %+v", estimate)
	}
}
