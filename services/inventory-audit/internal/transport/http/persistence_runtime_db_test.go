//go:build db

package httptransport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestPersistenceBackend_DBLifecycle(t *testing.T) {
	backend := newTestPersistenceBackend(t)
	idKey := fmt.Sprintf("idem-%d", time.Now().UnixNano())
	requestHash := persistenceRequestHash(http.MethodPost, "/mutations", "", []byte(`{"id":"E-1"}`))

	decision, err := backend.reserveIdempotency(idKey, requestHash, http.MethodPost, "/mutations", 10*time.Second)
	if err != nil {
		t.Fatalf("reserve idempotency failed: %v", err)
	}
	if decision.Action != "proceed" {
		t.Fatalf("expected proceed decision, got %+v", decision)
	}

	event := persistenceEvent{
		IDKey:        idKey,
		RequestHash:  requestHash,
		Method:       http.MethodPost,
		Path:         "/mutations",
		Query:        "",
		StatusCode:   http.StatusCreated,
		ActorID:      "qa-user",
		TraceID:      "trace-1",
		RequestJSON:  []byte(`{"id":"E-1","deal_id":"DL-1"}`),
		ResponseJSON: []byte(`{"id":"E-1","client_id":"CL-1","lines":[{"id":"LN-1","part_id":"P-1"}]}`),
		OccurredAt:   time.Now().UTC(),
		Links: []entityLink{
			{SourceEntity: "pricing:E-1", RelationKey: "deal_id", TargetEntity: "sales-deals:DL-1"},
		},
	}
	if err := backend.persist(event); err != nil {
		t.Fatalf("persist failed: %v", err)
	}

	commands, err := backend.listCommands()
	if err != nil {
		t.Fatalf("list commands failed: %v", err)
	}
	if len(commands) == 0 {
		t.Fatal("expected at least one persisted command")
	}

	state, err := backend.loadState()
	if err != nil {
		t.Fatalf("load state failed: %v", err)
	}
	_ = state

	outbox, err := backend.fetchPendingOutbox(10)
	if err != nil {
		t.Fatalf("fetch outbox failed: %v", err)
	}
	if len(outbox) == 0 {
		sql := "INSERT INTO kis_outbox(service, event_type, aggregate_type, aggregate_id, payload, attempts, occurred_at, available_at) VALUES(" +
			persistenceSQLQuote(backend.service) + ", 'test.event', 'test', 'A-1', " +
			persistenceJSONExprFromBytes([]byte(`{"seed":true}`)) + ", 0, NOW(), NOW());"
		if _, err := backend.runPSQL(sql, false); err != nil {
			t.Fatalf("seed outbox insert failed: %v", err)
		}
		outbox, err = backend.fetchPendingOutbox(10)
		if err != nil {
			t.Fatalf("fetch outbox after seed failed: %v", err)
		}
		if len(outbox) == 0 {
			t.Fatal("expected outbox records after seed insert")
		}
	}

	if err := backend.markOutboxResult(outbox[0].ID, outbox[0].Attempts, nil); err != nil {
		t.Fatalf("mark outbox success failed: %v", err)
	}
	if err := backend.markOutboxResult(outbox[0].ID, outbox[0].Attempts, fmt.Errorf("delivery failed")); err != nil {
		t.Fatalf("mark outbox failure failed: %v", err)
	}

	if err := backend.recordInbox(fmt.Sprintf("evt-%d", time.Now().UnixNano()), []byte(`{"type":"test"}`)); err != nil {
		t.Fatalf("record inbox failed: %v", err)
	}

	sagaID := fmt.Sprintf("saga-%d", time.Now().UnixNano())
	if err := backend.startSaga(sagaID, "pricing-flow", "started", []byte(`{"id":"S-1"}`)); err != nil {
		t.Fatalf("start saga failed: %v", err)
	}
	if err := backend.appendSagaStep(sagaID, "validate", "completed", []byte(`{"ok":true}`), ""); err != nil {
		t.Fatalf("append saga step failed: %v", err)
	}
	saga, err := backend.getSaga(sagaID)
	if err != nil {
		t.Fatalf("get saga failed: %v", err)
	}
	if saga == nil || saga["id"] == nil {
		t.Fatalf("expected saga payload, got %+v", saga)
	}

	idKeyFailed := fmt.Sprintf("idem-failed-%d", time.Now().UnixNano())
	decision, err = backend.reserveIdempotency(idKeyFailed, "hash-failed", http.MethodPost, "/mutations", 10*time.Second)
	if err != nil || decision.Action != "proceed" {
		t.Fatalf("reserve failed key failed: decision=%+v err=%v", decision, err)
	}
	if err := backend.finishIdempotencyFailed(idKeyFailed, "hash-failed", http.StatusBadRequest, []byte(`{"error":"bad"}`)); err != nil {
		t.Fatalf("finish idempotency failed status failed: %v", err)
	}
}

func TestPersistenceMiddleware_DBFlow(t *testing.T) {
	backend := newTestPersistenceBackend(t)
	requestCount := 0
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if r.Method == http.MethodGet {
			respondJSON(w, http.StatusOK, map[string]any{"status": "ok"})
			return
		}
		respondJSON(w, http.StatusCreated, map[string]any{
			"id":      "E-DB-1",
			"deal_id": "DL-DB-1",
		})
	})
	m := &persistenceMiddleware{
		service: backend.service,
		strict:  true,
		backend: backend,
		next:    next,
		idemTTL: 20 * time.Second,
	}

	postReq := httptest.NewRequest(http.MethodPost, "/mutations", strings.NewReader(`{"deal_id":"DL-DB-1"}`))
	postReq.Header.Set("Content-Type", "application/json")
	postReq.Header.Set("Idempotency-Key", "db-flow-key-1")
	postRR := httptest.NewRecorder()
	m.ServeHTTP(postRR, postReq)
	if postRR.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d (%s)", postRR.Code, postRR.Body.String())
	}

	getReq := httptest.NewRequest(http.MethodGet, "/mutations", nil)
	getRR := httptest.NewRecorder()
	m.ServeHTTP(getRR, getReq)
	if getRR.Code != http.StatusOK {
		t.Fatalf("expected get status 200, got %d", getRR.Code)
	}
	if requestCount < 2 {
		t.Fatalf("expected next handler to be called at least twice, got %d", requestCount)
	}

	internalInboxReq := httptest.NewRequest(http.MethodPost, "/internal/inbox/events", strings.NewReader(`{"event_id":"evt-int-1"}`))
	internalInboxReq.Header.Set("Content-Type", "application/json")
	internalInboxRR := httptest.NewRecorder()
	m.ServeHTTP(internalInboxRR, internalInboxReq)
	if internalInboxRR.Code != http.StatusOK {
		t.Fatalf("expected inbox ack 200, got %d", internalInboxRR.Code)
	}

	startSagaReq := httptest.NewRequest(http.MethodPost, "/internal/sagas", strings.NewReader(`{"saga_id":"saga-int-1","saga_type":"pricing-sync","state":"started","context":{"id":"S-INT"}}`))
	startSagaReq.Header.Set("Content-Type", "application/json")
	startSagaRR := httptest.NewRecorder()
	m.ServeHTTP(startSagaRR, startSagaReq)
	if startSagaRR.Code != http.StatusCreated {
		t.Fatalf("expected saga create 201, got %d (%s)", startSagaRR.Code, startSagaRR.Body.String())
	}

	appendStepReq := httptest.NewRequest(http.MethodPost, "/internal/sagas/saga-int-1/steps", strings.NewReader(`{"step_name":"validate","status":"completed","payload":{"ok":true}}`))
	appendStepReq.Header.Set("Content-Type", "application/json")
	appendStepRR := httptest.NewRecorder()
	m.ServeHTTP(appendStepRR, appendStepReq)
	if appendStepRR.Code != http.StatusCreated {
		t.Fatalf("expected saga step 201, got %d (%s)", appendStepRR.Code, appendStepRR.Body.String())
	}

	getSagaReq := httptest.NewRequest(http.MethodGet, "/internal/sagas/saga-int-1", nil)
	getSagaRR := httptest.NewRecorder()
	m.ServeHTTP(getSagaRR, getSagaReq)
	if getSagaRR.Code != http.StatusOK {
		t.Fatalf("expected saga get 200, got %d (%s)", getSagaRR.Code, getSagaRR.Body.String())
	}
	var sagaPayload map[string]any
	if err := json.NewDecoder(getSagaRR.Body).Decode(&sagaPayload); err != nil {
		t.Fatalf("decode saga payload failed: %v", err)
	}
	if sagaPayload["id"] == nil {
		t.Fatalf("expected saga id in response, got %+v", sagaPayload)
	}

	if err := m.replayJournal(); err != nil {
		t.Fatalf("replay journal failed: %v", err)
	}
}

func newTestPersistenceBackend(t *testing.T) *persistenceBackend {
	t.Helper()

	if strings.TrimSpace(os.Getenv("DB_HOST")) == "" {
		t.Setenv("DB_HOST", "127.0.0.1")
	}
	if strings.TrimSpace(os.Getenv("DB_PORT")) == "" {
		t.Setenv("DB_PORT", "5432")
	}
	if strings.TrimSpace(os.Getenv("DB_USER")) == "" {
		t.Setenv("DB_USER", "kis")
	}
	if strings.TrimSpace(os.Getenv("DB_PASSWORD")) == "" {
		t.Setenv("DB_PASSWORD", "kis")
	}
	if strings.TrimSpace(os.Getenv("DB_NAME")) == "" {
		t.Setenv("DB_NAME", "kis_test")
	}
	if strings.TrimSpace(os.Getenv("DB_SSLMODE")) == "" {
		t.Setenv("DB_SSLMODE", "disable")
	}

	serviceName := fmt.Sprintf("ut-%d", time.Now().UnixNano())
	backend, err := newPersistenceBackend(serviceName)
	if err != nil {
		t.Fatalf("new persistence backend failed: %v", err)
	}
	if err := backend.ensureSchema(); err != nil {
		t.Fatalf("ensure schema failed: %v", err)
	}

	cleanupPersistenceServiceData(t, backend)
	t.Cleanup(func() {
		cleanupPersistenceServiceData(t, backend)
	})
	return backend
}

func cleanupPersistenceServiceData(t *testing.T, backend *persistenceBackend) {
	t.Helper()
	svc := persistenceSQLQuote(backend.service)
	sql := "BEGIN;" +
		"DELETE FROM kis_saga_steps WHERE saga_id IN (SELECT id FROM kis_saga_instances WHERE service=" + svc + ");" +
		"DELETE FROM kis_saga_instances WHERE service=" + svc + ";" +
		"DELETE FROM kis_inbox WHERE service=" + svc + ";" +
		"DELETE FROM kis_outbox WHERE service=" + svc + ";" +
		"DELETE FROM kis_entity_links WHERE service=" + svc + ";" +
		"DELETE FROM kis_entities WHERE service=" + svc + ";" +
		"DELETE FROM kis_http_journal WHERE service=" + svc + ";" +
		"DELETE FROM kis_http_idempotency WHERE service=" + svc + ";" +
		"DELETE FROM kis_service_state WHERE service=" + svc + ";" +
		"COMMIT;"
	if _, err := backend.runPSQL(sql, false); err != nil {
		t.Fatalf("cleanup persistence tables failed: %v", err)
	}
}
