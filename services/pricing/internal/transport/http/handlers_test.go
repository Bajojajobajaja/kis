package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPricingCalcHandler(t *testing.T) {
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/pricing/calc", strings.NewReader(`{"base_price":1000,"options":200,"discount_pct":10,"promo_code":"NEWCAR5"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var got map[string]float64
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if got["subtotal"] != 1200 {
		t.Fatalf("expected subtotal 1200, got %v", got["subtotal"])
	}
	if got["discount_value"] != 120 {
		t.Fatalf("expected discount_value 120, got %v", got["discount_value"])
	}
	if got["promo_value"] != 54 {
		t.Fatalf("expected promo_value 54, got %v", got["promo_value"])
	}
	if got["final_price"] != 1026 {
		t.Fatalf("expected final_price 1026, got %v", got["final_price"])
	}
}

func TestPromoDiscount(t *testing.T) {
	if got := promoDiscount("SERVICE3", 1000); got != 30 {
		t.Fatalf("expected promo discount 30, got %v", got)
	}
	if got := promoDiscount("VIP10", 1000); got != 100 {
		t.Fatalf("expected promo discount 100 for VIP10, got %v", got)
	}
	if got := promoDiscount("unknown", 1000); got != 0 {
		t.Fatalf("expected promo discount 0 for unknown code, got %v", got)
	}
}

func TestPricingCalcWithOptionsListAndCommission(t *testing.T) {
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/pricing/calc", strings.NewReader(`{
		"base_price": 20000,
		"options_list": [{"name":"winter","amount":500},{"name":"insurance","amount":1000}],
		"discount_pct": 5,
		"discount_amount": 250,
		"promo_code":"FLEET7",
		"trade_in_bonus": 1500,
		"commission_pct": 2
	}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var got map[string]float64
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got["subtotal"] != 21500 {
		t.Fatalf("expected subtotal 21500, got %v", got["subtotal"])
	}
	if got["commission"] <= 0 {
		t.Fatalf("expected positive commission, got %v", got["commission"])
	}
}

func TestPricingCalcValidation(t *testing.T) {
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/pricing/calc", strings.NewReader(`{"base_price":1000,"discount_pct":150}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rr.Code)
	}
}
