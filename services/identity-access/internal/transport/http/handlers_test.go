package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetIdentityStore() {
	identityStore.Lock()
	defer identityStore.Unlock()
	identityStore.roleSeq = 0
	identityStore.policySeq = 0
	identityStore.roles = []role{
		{ID: "platform_admin", Name: "Platform Admin", Description: "Full access to all modules"},
		{ID: "sales_manager", Name: "Sales Manager", Description: "Manage sales objects"},
		{ID: "sales_agent", Name: "Sales Agent", Description: "Work with own sales objects"},
		{ID: "service_manager", Name: "Service Manager", Description: "Manage service objects"},
		{ID: "service_advisor", Name: "Service Advisor", Description: "Work with own workorders"},
	}
	identityStore.policies = []policy{
		{ID: "pol-001", Resource: "sales-deals", Action: "write", Effect: "allow", Roles: []string{"sales_manager", "platform_admin"}, ObjectScope: "any"},
		{ID: "pol-002", Resource: "sales-deals", Action: "write", Effect: "allow", Roles: []string{"sales_agent"}, ObjectScope: "owner"},
		{ID: "pol-003", Resource: "service-workorders", Action: "write", Effect: "allow", Roles: []string{"service_manager", "platform_admin"}, ObjectScope: "any"},
		{ID: "pol-004", Resource: "service-workorders", Action: "write", Effect: "allow", Roles: []string{"service_advisor"}, ObjectScope: "owner"},
	}
	identityStore.bindings = []subjectBinding{
		{SubjectID: "agent-1", Roles: []string{"sales_agent"}},
	}

	identityMetrics.Lock()
	identityMetrics.requests = map[httpMetric]int{}
	identityMetrics.durationMsSum = 0
	identityMetrics.durationCount = 0
	identityMetrics.Unlock()
}

func TestRBACCheckOwnerScope(t *testing.T) {
	resetIdentityStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/rbac/check", strings.NewReader(`{"subject_id":"agent-1","subject_roles":["sales_agent"],"resource":"sales-deals","action":"write","object_owner_id":"agent-1"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var got rbacCheckResponse
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.Allowed {
		t.Fatalf("expected request to be allowed, got reason %q", got.Reason)
	}
}

func TestRBACCheckOwnerMismatchDenied(t *testing.T) {
	resetIdentityStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/rbac/check", strings.NewReader(`{"subject_id":"agent-1","subject_roles":["sales_agent"],"resource":"sales-deals","action":"write","object_owner_id":"agent-2"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var got rbacCheckResponse
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Allowed {
		t.Fatalf("expected request to be denied, got reason %q", got.Reason)
	}
}

func TestRBACCheckUsesSubjectBinding(t *testing.T) {
	resetIdentityStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/rbac/check", strings.NewReader(`{"subject_id":"agent-1","resource":"sales-deals","action":"write","object_owner_id":"agent-1"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var got rbacCheckResponse
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.Allowed {
		t.Fatalf("expected request to be allowed by subject binding, got reason %q", got.Reason)
	}
}
