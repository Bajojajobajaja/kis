package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resetNotificationStore() {
	notificationStore.Lock()
	notificationStore.seq = 0
	notificationStore.jobs = nil
	notificationStore.Unlock()

	notificationMetrics.Lock()
	notificationMetrics.requests = map[notificationHTTPMetric]int{}
	notificationMetrics.durationMsSum = 0
	notificationMetrics.durationCount = 0
	notificationMetrics.Unlock()
}

func TestSendValidation(t *testing.T) {
	resetNotificationStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	req := httptest.NewRequest(http.MethodPost, "/notifications/send", strings.NewReader(`{"channel":"push","recipient":"user@example.com"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rr.Code)
	}
}

func TestEventToDispatchFlow(t *testing.T) {
	resetNotificationStore()
	mux := http.NewServeMux()
	RegisterHandlers(mux)

	eventReq := httptest.NewRequest(http.MethodPost, "/notifications/events", strings.NewReader(`{"event_type":"deal_won","recipient":"client@example.com"}`))
	eventReq.Header.Set("Content-Type", "application/json")
	eventRR := httptest.NewRecorder()
	mux.ServeHTTP(eventRR, eventReq)

	if eventRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", eventRR.Code)
	}

	var created notificationJob
	if err := json.NewDecoder(eventRR.Body).Decode(&created); err != nil {
		t.Fatalf("decode created job: %v", err)
	}
	if created.Channel != "email" {
		t.Fatalf("expected default channel email, got %q", created.Channel)
	}

	dispatchReq := httptest.NewRequest(http.MethodPost, "/notifications/dispatch", strings.NewReader(`{"limit":10}`))
	dispatchReq.Header.Set("Content-Type", "application/json")
	dispatchRR := httptest.NewRecorder()
	mux.ServeHTTP(dispatchRR, dispatchReq)

	if dispatchRR.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", dispatchRR.Code)
	}

	var got struct {
		Processed int               `json:"processed"`
		Jobs      []notificationJob `json:"jobs"`
	}
	if err := json.NewDecoder(dispatchRR.Body).Decode(&got); err != nil {
		t.Fatalf("decode dispatch response: %v", err)
	}
	if got.Processed != 1 {
		t.Fatalf("expected processed=1, got %d", got.Processed)
	}
	if len(got.Jobs) != 1 || got.Jobs[0].Status != "sent" {
		t.Fatalf("expected one sent job, got %+v", got.Jobs)
	}
}
