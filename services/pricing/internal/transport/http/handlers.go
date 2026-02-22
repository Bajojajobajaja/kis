package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)
	mux.HandleFunc("/pricing/calc", pricingCalcHandler)
}

func pricingCalcHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	type pricingOption struct {
		Name   string  `json:"name"`
		Amount float64 `json:"amount"`
	}

	var req struct {
		BasePrice      float64         `json:"base_price"`
		Options        float64         `json:"options"`
		OptionsList    []pricingOption `json:"options_list"`
		DiscountPct    float64         `json:"discount_pct"`
		DiscountAmount float64         `json:"discount_amount"`
		PromoCode      string          `json:"promo_code"`
		TradeInBonus   float64         `json:"trade_in_bonus"`
		CommissionPct  float64         `json:"commission_pct"`
		LoyaltyTier    string          `json:"loyalty_tier"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.BasePrice < 0 {
		respondError(w, http.StatusBadRequest, "base_price must be non-negative")
		return
	}
	if req.Options < 0 || req.DiscountPct < 0 || req.DiscountAmount < 0 || req.TradeInBonus < 0 {
		respondError(w, http.StatusBadRequest, "options and discounts must be non-negative")
		return
	}
	if req.DiscountPct > 100 {
		respondError(w, http.StatusBadRequest, "discount_pct must be in range 0..100")
		return
	}
	if req.CommissionPct < 0 || req.CommissionPct > 100 {
		respondError(w, http.StatusBadRequest, "commission_pct must be in range 0..100")
		return
	}

	optionsTotal := req.Options
	for _, option := range req.OptionsList {
		if option.Amount < 0 {
			respondError(w, http.StatusBadRequest, "option amount must be non-negative")
			return
		}
		optionsTotal += option.Amount
	}

	subtotal := req.BasePrice + optionsTotal
	percentDiscount := subtotal * req.DiscountPct / 100.0
	loyaltyDiscount := loyaltyDiscountValue(req.LoyaltyTier, subtotal)
	discountValue := percentDiscount + req.DiscountAmount + loyaltyDiscount
	if discountValue > subtotal {
		discountValue = subtotal
	}
	promoValue := promoDiscount(req.PromoCode, subtotal-discountValue)
	finalPrice := subtotal - discountValue - promoValue - req.TradeInBonus
	if finalPrice < 0 {
		finalPrice = 0
	}
	commissionValue := finalPrice * req.CommissionPct / 100

	respondJSON(w, http.StatusOK, map[string]any{
		"subtotal":       roundMoney(subtotal),
		"discount_value": roundMoney(discountValue),
		"loyalty_value":  roundMoney(loyaltyDiscount),
		"promo_value":    roundMoney(promoValue),
		"trade_in_bonus": roundMoney(req.TradeInBonus),
		"final_price":    roundMoney(finalPrice),
		"commission":     roundMoney(commissionValue),
	})
}

func promoDiscount(code string, amount float64) float64 {
	switch strings.ToUpper(strings.TrimSpace(code)) {
	case "NEWCAR5":
		return amount * 0.05
	case "FLEET7":
		return amount * 0.07
	case "VIP10":
		return amount * 0.10
	case "SERVICE3":
		return amount * 0.03
	default:
		return 0
	}
}

func loyaltyDiscountValue(tier string, amount float64) float64 {
	switch strings.ToLower(strings.TrimSpace(tier)) {
	case "gold":
		return amount * 0.02
	case "platinum":
		return amount * 0.04
	default:
		return 0
	}
}

func roundMoney(value float64) float64 {
	return float64(int(value*100+0.5)) / 100
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "pricing",
		"status":  "ok",
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "pricing",
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
