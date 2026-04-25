package httptransport

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/md5"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const persistenceBodyLimitBytes = 8 * 1024 * 1024
const persistenceProtocolVersion = 196608
const postgresSSLRequestCode = 80877103

type persistenceMiddleware struct {
	service        string
	strict         bool
	backend        *persistenceBackend
	next           http.Handler
	idemTTL        time.Duration
	outboxTargets  []string
	outboxInterval time.Duration
	outboxBatch    int
}

type idempotencyDecision struct {
	Action       string
	StatusCode   int
	ResponseJSON []byte
}

type outboxRecord struct {
	ID            int64
	EventType     string
	AggregateType string
	AggregateID   string
	Payload       []byte
	Attempts      int
}

type persistenceBackend struct {
	service    string
	host       string
	port       string
	dbName     string
	dbUser     string
	dbPassword string
	sslMode    string
	timeout    time.Duration
	pool       *pgConnPool
}

type persistenceEvent struct {
	IDKey        string
	RequestHash  string
	Method       string
	Path         string
	Query        string
	StatusCode   int
	ActorID      string
	TraceID      string
	RequestJSON  []byte
	ResponseJSON []byte
	OccurredAt   time.Time
	Links        []entityLink
}

type persistedCommand struct {
	ID          int64
	Method      string
	Path        string
	Query       string
	ActorID     string
	TraceID     string
	RequestBody []byte
}

type entityLink struct {
	SourceEntity string
	RelationKey  string
	TargetEntity string
}

type pgConnPool struct {
	cfg            pgConnConfig
	maxOpen        int
	maxIdle        int
	acquireTimeout time.Duration

	mu   sync.Mutex
	open int
	idle []*pgConn
}

type pgConnConfig struct {
	Host     string
	Port     string
	User     string
	Password string
	DBName   string
	SSLMode  string
	Timeout  time.Duration
}

type pgConn struct {
	net.Conn
}

type pgQueryResult struct {
	Columns []string
	Rows    [][]string
}

func WrapWithPersistence(service string, next http.Handler) (http.Handler, error) {
	if next == nil {
		return nil, fmt.Errorf("persistence middleware requires non-nil next handler")
	}

	enabled := persistenceBoolEnvOrDefault("PERSISTENCE_ENABLED", true)
	if !enabled {
		return next, nil
	}

	strict := persistenceBoolEnvOrDefault("PERSISTENCE_STRICT", true)
	backend, err := newPersistenceBackend(service)
	if err != nil {
		if strict {
			return nil, err
		}
		log.Printf("persistence disabled for %s: %v", service, err)
		return next, nil
	}

	if err := backend.ensureSchema(); err != nil {
		if strict {
			return nil, fmt.Errorf("prepare persistence schema: %w", err)
		}
		log.Printf("persistence schema failed for %s: %v", service, err)
		return next, nil
	}

	log.Printf("persistence enabled for %s (db=%s)", service, backend.dbName)
	m := &persistenceMiddleware{
		service:        service,
		strict:         strict,
		backend:        backend,
		next:           next,
		idemTTL:        persistenceDurationEnvOrDefault("IDEMPOTENCY_INFLIGHT_TTL", 45*time.Second),
		outboxTargets:  persistenceParseTargets(os.Getenv("OUTBOX_TARGETS")),
		outboxInterval: persistenceDurationEnvOrDefault("OUTBOX_DISPATCH_INTERVAL", 2*time.Second),
		outboxBatch:    persistenceIntEnvOrDefault("OUTBOX_BATCH_SIZE", 50),
	}
	if m.outboxInterval <= 0 {
		m.outboxInterval = 2 * time.Second
	}
	if m.outboxBatch <= 0 {
		m.outboxBatch = 50
	}
	if persistenceBoolEnvOrDefault("OUTBOX_DISPATCH_ENABLED", true) && len(m.outboxTargets) > 0 {
		m.startOutboxDispatcher()
	}
	restored, err := m.restoreStateSnapshot()
	if err != nil {
		if strict {
			return nil, fmt.Errorf("restore persisted state: %w", err)
		}
		log.Printf("persisted state restore failed for %s: %v", service, err)
	}
	if !restored {
		restored, err = m.restoreEntitySnapshot()
		if err != nil {
			if strict {
				return nil, fmt.Errorf("restore persisted entities: %w", err)
			}
			log.Printf("persisted entity restore failed for %s: %v", service, err)
		}
	}
	if !restored {
		if err := m.replayJournal(); err != nil {
			if strict {
				return nil, fmt.Errorf("journal replay failed: %w", err)
			}
			log.Printf("journal replay failed for %s: %v", service, err)
		}
	}
	if err := m.saveStateSnapshot(); err != nil {
		log.Printf("persisted state snapshot failed for %s: %v", service, err)
	}
	return m, nil
}

func (m *persistenceMiddleware) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if m.handleInternalRoutes(w, r) {
		return
	}
	if strings.EqualFold(strings.TrimSpace(r.Header.Get("X-KIS-Replay")), "1") {
		m.next.ServeHTTP(w, r)
		return
	}

	if !persistenceIsMutatingMethod(r.Method) {
		m.next.ServeHTTP(w, r)
		return
	}

	requestBody, err := persistenceReadBody(r.Body)
	if err != nil {
		persistenceWriteJSONError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(requestBody))

	requestHash := persistenceRequestHash(r.Method, r.URL.Path, r.URL.RawQuery, requestBody)
	idKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idKey == "" {
		idKey = requestHash
	}

	decision, err := m.backend.reserveIdempotency(idKey, requestHash, r.Method, r.URL.Path, m.idemTTL)
	if err != nil {
		persistenceWriteJSONError(w, http.StatusServiceUnavailable, "failed to reserve idempotency key")
		return
	}
	switch decision.Action {
	case "replay":
		persistenceWriteRawJSON(w, decision.StatusCode, decision.ResponseJSON)
		return
	case "conflict":
		persistenceWriteJSONError(w, http.StatusConflict, "idempotency conflict")
		return
	}

	recorder := newBufferedResponseWriter()
	m.next.ServeHTTP(recorder, r)
	if recorder.statusCode() >= http.StatusBadRequest {
		_ = m.backend.finishIdempotencyFailed(idKey, requestHash, recorder.statusCode(), persistenceNormalizeJSON(recorder.BodyBytes()))
		recorder.WriteTo(w)
		return
	}

	requestJSON := persistenceNormalizeJSON(requestBody)
	responseJSON := persistenceNormalizeJSON(recorder.BodyBytes())
	event := persistenceEvent{
		Method:       r.Method,
		Path:         r.URL.Path,
		Query:        r.URL.RawQuery,
		StatusCode:   recorder.statusCode(),
		ActorID:      strings.TrimSpace(r.Header.Get("X-User-ID")),
		TraceID:      strings.TrimSpace(r.Header.Get("X-Trace-ID")),
		RequestJSON:  requestJSON,
		ResponseJSON: responseJSON,
		OccurredAt:   time.Now().UTC(),
		IDKey:        idKey,
		RequestHash:  requestHash,
		Links:        persistenceExtractLinks(m.service, requestJSON, responseJSON),
	}

	if err := m.backend.persist(event); err != nil {
		_ = m.backend.finishIdempotencyFailed(idKey, requestHash, recorder.statusCode(), responseJSON)
		if m.strict {
			if replayErr := m.replayJournal(); replayErr != nil {
				log.Printf("strict replay rollback failed for %s: %v", m.service, replayErr)
			}
			persistenceWriteJSONError(w, http.StatusServiceUnavailable, "failed to persist data")
			return
		}
		log.Printf("persistence write failed for %s: %v", m.service, err)
	} else if err := m.saveStateSnapshot(); err != nil {
		log.Printf("persisted state snapshot failed for %s: %v", m.service, err)
	}

	recorder.WriteTo(w)
}

func (m *persistenceMiddleware) handleInternalRoutes(w http.ResponseWriter, r *http.Request) bool {
	path := strings.Trim(strings.TrimSpace(r.URL.Path), "/")

	if path == "internal/inbox/events" {
		if r.Method != http.MethodPost {
			persistenceWriteJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return true
		}
		var payload map[string]any
		if err := decodeJSONBody(r, &payload); err != nil {
			persistenceWriteJSONError(w, http.StatusBadRequest, err.Error())
			return true
		}
		eventID := strings.TrimSpace(asString(payload["event_id"]))
		if eventID == "" {
			persistenceWriteJSONError(w, http.StatusBadRequest, "event_id is required")
			return true
		}
		body, _ := json.Marshal(payload)
		if err := m.backend.recordInbox(eventID, persistenceNormalizeJSON(body)); err != nil {
			persistenceWriteJSONError(w, http.StatusServiceUnavailable, "failed to persist inbox event")
			return true
		}
		persistenceWriteRawJSON(w, http.StatusOK, []byte(`{"status":"ack"}`))
		return true
	}

	if path == "internal/sagas" {
		if r.Method != http.MethodPost {
			persistenceWriteJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return true
		}
		var req map[string]any
		if err := decodeJSONBody(r, &req); err != nil {
			persistenceWriteJSONError(w, http.StatusBadRequest, err.Error())
			return true
		}
		sagaID := strings.TrimSpace(asString(req["saga_id"]))
		if sagaID == "" {
			sagaID = "saga-" + strconv.FormatInt(time.Now().UnixNano(), 10)
		}
		sagaType := strings.TrimSpace(asString(req["saga_type"]))
		if sagaType == "" {
			persistenceWriteJSONError(w, http.StatusBadRequest, "saga_type is required")
			return true
		}
		state := strings.TrimSpace(asString(req["state"]))
		if state == "" {
			state = "started"
		}
		ctxJSON := persistenceNormalizeJSON(marshalAny(req["context"]))
		if err := m.backend.startSaga(sagaID, sagaType, state, ctxJSON); err != nil {
			persistenceWriteJSONError(w, http.StatusServiceUnavailable, "failed to start saga")
			return true
		}
		persistenceWriteRawJSON(w, http.StatusCreated, marshalAny(map[string]any{
			"saga_id": sagaID,
			"state":   state,
		}))
		return true
	}

	if strings.HasPrefix(path, "internal/sagas/") {
		parts := strings.Split(path, "/")
		if len(parts) >= 3 {
			sagaID := strings.TrimSpace(parts[2])
			if sagaID == "" {
				persistenceWriteJSONError(w, http.StatusBadRequest, "saga_id is required")
				return true
			}
			if len(parts) == 3 && r.Method == http.MethodGet {
				saga, err := m.backend.getSaga(sagaID)
				if err != nil {
					persistenceWriteJSONError(w, http.StatusServiceUnavailable, "failed to load saga")
					return true
				}
				if saga == nil {
					persistenceWriteJSONError(w, http.StatusNotFound, "saga not found")
					return true
				}
				persistenceWriteRawJSON(w, http.StatusOK, marshalAny(saga))
				return true
			}
			if len(parts) == 4 && parts[3] == "steps" {
				if r.Method != http.MethodPost {
					persistenceWriteJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
					return true
				}
				var req map[string]any
				if err := decodeJSONBody(r, &req); err != nil {
					persistenceWriteJSONError(w, http.StatusBadRequest, err.Error())
					return true
				}
				stepName := strings.TrimSpace(asString(req["step_name"]))
				status := strings.TrimSpace(asString(req["status"]))
				if stepName == "" || status == "" {
					persistenceWriteJSONError(w, http.StatusBadRequest, "step_name and status are required")
					return true
				}
				payloadJSON := persistenceNormalizeJSON(marshalAny(req["payload"]))
				stepErr := strings.TrimSpace(asString(req["error"]))
				if err := m.backend.appendSagaStep(sagaID, stepName, status, payloadJSON, stepErr); err != nil {
					persistenceWriteJSONError(w, http.StatusServiceUnavailable, "failed to append saga step")
					return true
				}
				persistenceWriteRawJSON(w, http.StatusCreated, []byte(`{"status":"recorded"}`))
				return true
			}
		}
	}

	return false
}

func (m *persistenceMiddleware) startOutboxDispatcher() {
	targets := append([]string(nil), m.outboxTargets...)
	interval := m.outboxInterval
	batch := m.outboxBatch

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			<-ticker.C
			events, err := m.backend.fetchPendingOutbox(batch)
			if err != nil {
				log.Printf("outbox fetch failed for %s: %v", m.service, err)
				continue
			}
			for _, event := range events {
				deliveryErr := persistenceDeliverOutboxEvent(m.service, event, targets)
				if err := m.backend.markOutboxResult(event.ID, event.Attempts, deliveryErr); err != nil {
					log.Printf("outbox mark failed for %s event=%d: %v", m.service, event.ID, err)
				}
			}
		}
	}()
}

func persistenceDeliverOutboxEvent(service string, event outboxRecord, targets []string) error {
	if len(targets) == 0 {
		return nil
	}
	envelope := map[string]any{
		"event_id":       fmt.Sprintf("%s-%d", service, event.ID),
		"source_service": service,
		"event_type":     event.EventType,
		"aggregate_type": event.AggregateType,
		"aggregate_id":   event.AggregateID,
		"occurred_at":    time.Now().UTC().Format(time.RFC3339Nano),
	}
	if len(event.Payload) > 0 {
		var payload any
		if err := json.Unmarshal(event.Payload, &payload); err == nil {
			envelope["payload"] = payload
		}
	}
	body := marshalAny(envelope)
	client := &http.Client{Timeout: persistenceDurationEnvOrDefault("OUTBOX_HTTP_TIMEOUT", 5*time.Second)}
	for _, target := range targets {
		target = strings.TrimSpace(target)
		if target == "" {
			continue
		}
		url := strings.TrimRight(target, "/") + "/internal/inbox/events"
		req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return err
		}
		_ = resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("deliver %s status %d", url, resp.StatusCode)
		}
	}
	return nil
}

func (m *persistenceMiddleware) replayJournal() error {
	commands, err := m.backend.listCommands()
	if err != nil {
		return err
	}
	if len(commands) == 0 {
		return nil
	}

	resetPersistedState()
	for _, cmd := range commands {
		path := cmd.Path
		if strings.TrimSpace(cmd.Query) != "" {
			path = path + "?" + cmd.Query
		}
		req, err := http.NewRequest(cmd.Method, path, bytes.NewReader(cmd.RequestBody))
		if err != nil {
			return fmt.Errorf("build replay request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-KIS-Replay", "1")
		if cmd.ActorID != "" {
			req.Header.Set("X-User-ID", cmd.ActorID)
		}
		if cmd.TraceID != "" {
			req.Header.Set("X-Trace-ID", cmd.TraceID)
		}

		rec := newBufferedResponseWriter()
		m.next.ServeHTTP(rec, req)
		if rec.statusCode() >= http.StatusBadRequest {
			return fmt.Errorf("replay command %d failed with status %d", cmd.ID, rec.statusCode())
		}
	}
	return nil
}

func (m *persistenceMiddleware) restoreStateSnapshot() (bool, error) {
	raw, err := m.backend.loadState()
	if err != nil {
		return false, err
	}
	if len(raw) == 0 {
		return false, nil
	}
	if err := restorePersistedState(raw); err != nil {
		return false, err
	}
	return true, nil
}

func (m *persistenceMiddleware) restoreEntitySnapshot() (bool, error) {
	rawEntities, err := m.backend.listEntityPayloads("entity")
	if err != nil {
		return false, err
	}
	return restorePersistedEntities(rawEntities)
}

func (m *persistenceMiddleware) saveStateSnapshot() error {
	raw, err := capturePersistedState()
	if err != nil {
		return err
	}
	return m.backend.saveState(raw)
}

func newPersistenceBackend(service string) (*persistenceBackend, error) {
	service = strings.TrimSpace(service)
	if service == "" {
		return nil, fmt.Errorf("service name is required")
	}

	host := persistenceEnvOrDefault("DB_HOST", persistenceEnvOrDefault("POSTGRES_HOST", "localhost"))
	port := persistenceEnvOrDefault("DB_PORT", persistenceEnvOrDefault("POSTGRES_PORT", "5432"))
	user := persistenceEnvOrDefault("DB_USER", persistenceEnvOrDefault("POSTGRES_USER", "kis"))
	password := persistenceEnvOrDefault("DB_PASSWORD", persistenceEnvOrDefault("POSTGRES_PASSWORD", ""))
	dbName := persistenceResolveDBName(service)
	sslMode := persistenceEnvOrDefault("DB_SSLMODE", "disable")
	timeout := persistenceDurationEnvOrDefault("PERSISTENCE_TIMEOUT", 20*time.Second)

	pool := newPGConnPool(pgConnConfig{
		Host:     host,
		Port:     port,
		User:     user,
		Password: password,
		DBName:   dbName,
		SSLMode:  sslMode,
		Timeout:  timeout,
	})

	return &persistenceBackend{
		service:    service,
		host:       host,
		port:       port,
		dbName:     dbName,
		dbUser:     user,
		dbPassword: password,
		sslMode:    sslMode,
		timeout:    timeout,
		pool:       pool,
	}, nil
}

func (b *persistenceBackend) ensureSchema() error {
	schemaSQL := "CREATE TABLE IF NOT EXISTS kis_schema_migrations (\n" +
		"    version BIGINT PRIMARY KEY,\n" +
		"    name TEXT NOT NULL,\n" +
		"    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n" +
		");\n" +
		"CREATE TABLE IF NOT EXISTS kis_service_state (\n" +
		"    service TEXT PRIMARY KEY,\n" +
		"    state_json JSONB NOT NULL,\n" +
		"    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n" +
		");\n" +
		"CREATE TABLE IF NOT EXISTS kis_http_idempotency (\n" +
		"    service TEXT NOT NULL,\n" +
		"    idempotency_key TEXT NOT NULL,\n" +
		"    method TEXT NOT NULL,\n" +
		"    path TEXT NOT NULL,\n" +
		"    request_hash TEXT NOT NULL,\n" +
		"    status TEXT NOT NULL,\n" +
		"    response_code INTEGER,\n" +
		"    response_json JSONB,\n" +
		"    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n" +
		"    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n" +
		"    PRIMARY KEY(service, idempotency_key)\n" +
		");\n" +
		"CREATE INDEX IF NOT EXISTS idx_kis_http_idempotency_status ON kis_http_idempotency(service, status, updated_at DESC);\n" +
		"CREATE TABLE IF NOT EXISTS kis_http_journal (\n" +
		"    id BIGSERIAL PRIMARY KEY,\n" +
		"    service TEXT NOT NULL,\n" +
		"    idempotency_key TEXT NOT NULL DEFAULT '',\n" +
		"    method TEXT NOT NULL,\n" +
		"    path TEXT NOT NULL,\n" +
		"    query TEXT NOT NULL DEFAULT '',\n" +
		"    actor_id TEXT NOT NULL DEFAULT '',\n" +
		"    trace_id TEXT NOT NULL DEFAULT '',\n" +
		"    request_json JSONB,\n" +
		"    response_json JSONB,\n" +
		"    request_hash TEXT NOT NULL DEFAULT '',\n" +
		"    status_code INTEGER NOT NULL,\n" +
		"    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n" +
		");\n" +
		"CREATE INDEX IF NOT EXISTS idx_kis_http_journal_service_time ON kis_http_journal(service, occurred_at DESC);\n" +
		"CREATE TABLE IF NOT EXISTS kis_entities (\n" +
		"    service TEXT NOT NULL,\n" +
		"    entity_type TEXT NOT NULL,\n" +
		"    entity_id TEXT NOT NULL,\n" +
		"    payload JSONB NOT NULL,\n" +
		"    version BIGINT NOT NULL DEFAULT 1,\n" +
		"    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n" +
		"    PRIMARY KEY(service, entity_type, entity_id)\n" +
		");\n" +
		"CREATE INDEX IF NOT EXISTS idx_kis_entities_service_type ON kis_entities(service, entity_type);\n" +
		"CREATE TABLE IF NOT EXISTS kis_outbox (\n" +
		"    id BIGSERIAL PRIMARY KEY,\n" +
		"    service TEXT NOT NULL,\n" +
		"    event_type TEXT NOT NULL,\n" +
		"    aggregate_type TEXT NOT NULL,\n" +
		"    aggregate_id TEXT NOT NULL,\n" +
		"    payload JSONB NOT NULL,\n" +
		"    attempts INTEGER NOT NULL DEFAULT 0,\n" +
		"    last_error TEXT NOT NULL DEFAULT '',\n" +
		"    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n" +
		"    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n" +
		"    dispatched_at TIMESTAMPTZ\n" +
		");\n" +
		"CREATE INDEX IF NOT EXISTS idx_kis_outbox_pending ON kis_outbox(service, dispatched_at, available_at, id);\n" +
		"CREATE TABLE IF NOT EXISTS kis_inbox (\n" +
		"    event_id TEXT PRIMARY KEY,\n" +
		"    service TEXT NOT NULL,\n" +
		"    status TEXT NOT NULL DEFAULT 'received',\n" +
		"    payload JSONB,\n" +
		"    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n" +
		"    processed_at TIMESTAMPTZ\n" +
		");\n" +
		"CREATE INDEX IF NOT EXISTS idx_kis_inbox_service_time ON kis_inbox(service, received_at DESC);\n" +
		"CREATE TABLE IF NOT EXISTS kis_saga_instances (\n" +
		"    id TEXT PRIMARY KEY,\n" +
		"    service TEXT NOT NULL,\n" +
		"    saga_type TEXT NOT NULL,\n" +
		"    state TEXT NOT NULL,\n" +
		"    context JSONB,\n" +
		"    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n" +
		"    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n" +
		");\n" +
		"CREATE INDEX IF NOT EXISTS idx_kis_saga_instances_service ON kis_saga_instances(service, saga_type);\n" +
		"CREATE TABLE IF NOT EXISTS kis_saga_steps (\n" +
		"    id BIGSERIAL PRIMARY KEY,\n" +
		"    saga_id TEXT NOT NULL REFERENCES kis_saga_instances(id) ON DELETE CASCADE,\n" +
		"    step_name TEXT NOT NULL,\n" +
		"    status TEXT NOT NULL,\n" +
		"    payload JSONB,\n" +
		"    error TEXT NOT NULL DEFAULT '',\n" +
		"    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n" +
		");\n" +
		"CREATE INDEX IF NOT EXISTS idx_kis_saga_steps_saga_id ON kis_saga_steps(saga_id, id);\n" +
		"CREATE TABLE IF NOT EXISTS kis_entity_links (\n" +
		"    id BIGSERIAL PRIMARY KEY,\n" +
		"    service TEXT NOT NULL,\n" +
		"    source_entity TEXT NOT NULL,\n" +
		"    relation_key TEXT NOT NULL,\n" +
		"    target_entity TEXT NOT NULL,\n" +
		"    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n" +
		");\n" +
		"CREATE INDEX IF NOT EXISTS idx_kis_entity_links_service_source ON kis_entity_links(service, source_entity);\n" +
		"CREATE INDEX IF NOT EXISTS idx_kis_entity_links_target ON kis_entity_links(target_entity);\n"
	_, err := b.runPSQL(schemaSQL, false)
	if err != nil {
		return err
	}
	migrationsSQL := "INSERT INTO kis_schema_migrations(version, name, applied_at) VALUES " +
		"(1, 'runtime_schema_v1_base', NOW())," +
		"(2, 'runtime_schema_v1_idempotency', NOW())," +
		"(3, 'runtime_schema_v1_journal', NOW())," +
		"(4, 'runtime_schema_v1_entities', NOW())," +
		"(5, 'runtime_schema_v1_outbox_inbox', NOW())," +
		"(6, 'runtime_schema_v1_saga', NOW()) " +
		"ON CONFLICT(version) DO NOTHING;"
	_, err = b.runPSQL(migrationsSQL, false)
	return err
}

func (b *persistenceBackend) loadState() ([]byte, error) {
	query := fmt.Sprintf(
		"SELECT replace(encode(convert_to(state_json::text, 'UTF8'), 'base64'), E'\\n', '') FROM kis_service_state WHERE service=%s LIMIT 1;",
		persistenceSQLQuote(b.service),
	)
	out, err := b.runPSQL(query, true)
	if err != nil {
		return nil, err
	}
	line := persistenceLastValueLine(out)
	if line == "" {
		return nil, nil
	}
	decoded, err := base64.StdEncoding.DecodeString(line)
	if err != nil {
		return nil, fmt.Errorf("decode persisted state: %w", err)
	}
	return decoded, nil
}

func (b *persistenceBackend) saveState(raw []byte) error {
	sql := "INSERT INTO kis_service_state(service, state_json, updated_at) VALUES(" +
		persistenceSQLQuote(b.service) + ", " +
		persistenceJSONExprFromBytes(raw) + ", NOW()) " +
		"ON CONFLICT(service) DO UPDATE SET state_json=EXCLUDED.state_json, updated_at=NOW();"
	_, err := b.runPSQL(sql, false)
	return err
}

func (b *persistenceBackend) listEntityPayloads(entityType string) ([][]byte, error) {
	query := "SELECT replace(encode(convert_to(COALESCE(payload::text, ''), 'UTF8'), 'base64'), E'\\n', '') FROM kis_entities WHERE service=" +
		persistenceSQLQuote(b.service)
	if strings.TrimSpace(entityType) != "" {
		query += " AND entity_type=" + persistenceSQLQuote(entityType)
	}
	query += " ORDER BY updated_at ASC, entity_id ASC;"
	out, err := b.runPSQL(query, true)
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	items := make([][]byte, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		decoded, err := base64.StdEncoding.DecodeString(line)
		if err != nil {
			return nil, fmt.Errorf("decode entity payload: %w", err)
		}
		items = append(items, decoded)
	}
	return items, nil
}

func (b *persistenceBackend) listCommands() ([]persistedCommand, error) {
	query := "SELECT id::text, method, path, query, actor_id, trace_id, replace(encode(convert_to(COALESCE(request_json::text, ''), 'UTF8'), 'base64'), E'\\n', '') FROM kis_http_journal WHERE service=" +
		persistenceSQLQuote(b.service) + " ORDER BY id ASC;"
	out, err := b.runPSQL(query, true)
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	commands := make([]persistedCommand, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "|")
		if len(parts) < 7 {
			continue
		}
		id, err := strconv.ParseInt(strings.TrimSpace(parts[0]), 10, 64)
		if err != nil {
			continue
		}
		body := []byte{}
		if encoded := strings.TrimSpace(parts[6]); encoded != "" {
			if decoded, err := base64.StdEncoding.DecodeString(encoded); err == nil {
				body = decoded
			}
		}
		commands = append(commands, persistedCommand{
			ID:          id,
			Method:      parts[1],
			Path:        parts[2],
			Query:       parts[3],
			ActorID:     parts[4],
			TraceID:     parts[5],
			RequestBody: body,
		})
	}
	return commands, nil
}

func (b *persistenceBackend) persist(event persistenceEvent) error {
	eventEnvelope, err := json.Marshal(map[string]any{
		"service":         b.service,
		"idempotency_key": event.IDKey,
		"request_hash":    event.RequestHash,
		"method":          strings.ToUpper(strings.TrimSpace(event.Method)),
		"path":            event.Path,
		"query":           event.Query,
		"status_code":     event.StatusCode,
		"actor_id":        event.ActorID,
		"trace_id":        event.TraceID,
		"request":         json.RawMessage(event.RequestJSON),
		"response":        json.RawMessage(event.ResponseJSON),
		"occurred_at":     event.OccurredAt.Format(time.RFC3339Nano),
	})
	if err != nil {
		return err
	}

	aggregateType := "command"
	aggregateID := event.IDKey
	if len(event.Links) > 0 {
		aggregateType = "entity_link"
		aggregateID = event.Links[0].SourceEntity
	}
	if aggregateID == "" {
		aggregateID = event.RequestHash
	}

	var sql strings.Builder
	sql.WriteString("BEGIN;")
	sql.WriteString("INSERT INTO kis_http_journal(service, idempotency_key, method, path, query, actor_id, trace_id, request_json, response_json, request_hash, status_code, occurred_at) VALUES(")
	sql.WriteString(persistenceSQLQuote(b.service))
	sql.WriteString(", ")
	sql.WriteString(persistenceSQLQuote(event.IDKey))
	sql.WriteString(", ")
	sql.WriteString(persistenceSQLQuote(event.Method))
	sql.WriteString(", ")
	sql.WriteString(persistenceSQLQuote(event.Path))
	sql.WriteString(", ")
	sql.WriteString(persistenceSQLQuote(event.Query))
	sql.WriteString(", ")
	sql.WriteString(persistenceSQLQuote(event.ActorID))
	sql.WriteString(", ")
	sql.WriteString(persistenceSQLQuote(event.TraceID))
	sql.WriteString(", ")
	sql.WriteString(persistenceJSONExprFromBytes(event.RequestJSON))
	sql.WriteString(", ")
	sql.WriteString(persistenceJSONExprFromBytes(event.ResponseJSON))
	sql.WriteString(", ")
	sql.WriteString(persistenceSQLQuote(event.RequestHash))
	sql.WriteString(", ")
	sql.WriteString(strconv.Itoa(event.StatusCode))
	sql.WriteString(", ")
	sql.WriteString(persistenceSQLQuote(event.OccurredAt.Format(time.RFC3339Nano)))
	sql.WriteString("::timestamptz);")

	sql.WriteString("UPDATE kis_http_idempotency SET status='completed', request_hash=")
	sql.WriteString(persistenceSQLQuote(event.RequestHash))
	sql.WriteString(", response_code=")
	sql.WriteString(strconv.Itoa(event.StatusCode))
	sql.WriteString(", response_json=")
	sql.WriteString(persistenceJSONExprFromBytes(event.ResponseJSON))
	sql.WriteString(", updated_at=NOW() WHERE service=")
	sql.WriteString(persistenceSQLQuote(b.service))
	sql.WriteString(" AND idempotency_key=")
	sql.WriteString(persistenceSQLQuote(event.IDKey))
	sql.WriteString(";")

	if len(event.Links) > 0 {
		sql.WriteString("INSERT INTO kis_entity_links(service, source_entity, relation_key, target_entity, occurred_at) VALUES ")
		for i, link := range event.Links {
			if i > 0 {
				sql.WriteString(", ")
			}
			sql.WriteString("(")
			sql.WriteString(persistenceSQLQuote(b.service))
			sql.WriteString(", ")
			sql.WriteString(persistenceSQLQuote(link.SourceEntity))
			sql.WriteString(", ")
			sql.WriteString(persistenceSQLQuote(link.RelationKey))
			sql.WriteString(", ")
			sql.WriteString(persistenceSQLQuote(link.TargetEntity))
			sql.WriteString(", ")
			sql.WriteString(persistenceSQLQuote(event.OccurredAt.Format(time.RFC3339Nano)))
			sql.WriteString("::timestamptz)")
		}
		sql.WriteString(";")
	}

	entityPayloads := persistenceExtractEntityPayloads(event.ResponseJSON)
	for _, payload := range entityPayloads {
		if strings.TrimSpace(payload.EntityType) == "" || strings.TrimSpace(payload.EntityID) == "" {
			continue
		}
		sql.WriteString("INSERT INTO kis_entities(service, entity_type, entity_id, payload, version, updated_at) VALUES(")
		sql.WriteString(persistenceSQLQuote(b.service))
		sql.WriteString(", ")
		sql.WriteString(persistenceSQLQuote(payload.EntityType))
		sql.WriteString(", ")
		sql.WriteString(persistenceSQLQuote(payload.EntityID))
		sql.WriteString(", ")
		sql.WriteString(persistenceJSONExprFromBytes(payload.Payload))
		sql.WriteString(", 1, NOW()) ON CONFLICT(service, entity_type, entity_id) DO UPDATE SET payload=EXCLUDED.payload, version=kis_entities.version+1, updated_at=NOW();")
	}

	sql.WriteString("INSERT INTO kis_outbox(service, event_type, aggregate_type, aggregate_id, payload, attempts, occurred_at, available_at) VALUES(")
	sql.WriteString(persistenceSQLQuote(b.service))
	sql.WriteString(", 'http.mutation.applied', ")
	sql.WriteString(persistenceSQLQuote(aggregateType))
	sql.WriteString(", ")
	sql.WriteString(persistenceSQLQuote(aggregateID))
	sql.WriteString(", ")
	sql.WriteString(persistenceJSONExprFromBytes(eventEnvelope))
	sql.WriteString(", 0, ")
	sql.WriteString(persistenceSQLQuote(event.OccurredAt.Format(time.RFC3339Nano)))
	sql.WriteString("::timestamptz, NOW());")

	sql.WriteString("COMMIT;")

	_, err = b.runPSQL(sql.String(), false)
	return err
}

func (b *persistenceBackend) reserveIdempotency(idKey, requestHash, method, path string, ttl time.Duration) (idempotencyDecision, error) {
	method = strings.ToUpper(strings.TrimSpace(method))
	if ttl < time.Second {
		ttl = time.Second
	}

	insert := "INSERT INTO kis_http_idempotency(service, idempotency_key, method, path, request_hash, status, created_at, updated_at) VALUES(" +
		persistenceSQLQuote(b.service) + ", " +
		persistenceSQLQuote(idKey) + ", " +
		persistenceSQLQuote(method) + ", " +
		persistenceSQLQuote(path) + ", " +
		persistenceSQLQuote(requestHash) + ", 'processing', NOW(), NOW()) " +
		"ON CONFLICT(service, idempotency_key) DO NOTHING RETURNING status;"
	out, err := b.runPSQL(insert, true)
	if err != nil {
		return idempotencyDecision{}, err
	}
	if persistenceLastValueLine(out) != "" {
		return idempotencyDecision{Action: "proceed"}, nil
	}

	query := "SELECT status, request_hash, COALESCE(response_code, 0)::text, COALESCE(NULLIF(replace(encode(convert_to(COALESCE(response_json::text, ''), 'UTF8'), 'base64'), E'\\n', ''), ''), '-'), COALESCE(EXTRACT(EPOCH FROM updated_at)::bigint, 0)::text " +
		"FROM kis_http_idempotency WHERE service=" + persistenceSQLQuote(b.service) +
		" AND idempotency_key=" + persistenceSQLQuote(idKey) + " LIMIT 1;"
	out, err = b.runPSQL(query, true)
	if err != nil {
		return idempotencyDecision{}, err
	}
	line := persistenceLastValueLine(out)
	if line == "" {
		return idempotencyDecision{}, fmt.Errorf("idempotency row disappeared for key %s", idKey)
	}

	parts := strings.Split(line, "|")
	for len(parts) < 5 {
		parts = append(parts, "")
	}
	if len(parts) < 2 {
		return idempotencyDecision{}, fmt.Errorf("invalid idempotency row")
	}

	status := strings.ToLower(strings.TrimSpace(parts[0]))
	existingHash := strings.TrimSpace(parts[1])
	if existingHash != "" && existingHash != requestHash {
		return idempotencyDecision{Action: "conflict"}, nil
	}

	if status == "completed" {
		statusCode, _ := strconv.Atoi(strings.TrimSpace(parts[2]))
		if statusCode <= 0 {
			statusCode = http.StatusOK
		}
		responseJSON := []byte{}
		if encoded := strings.TrimSpace(parts[3]); encoded != "" && encoded != "-" {
			decoded, err := base64.StdEncoding.DecodeString(encoded)
			if err == nil {
				responseJSON = decoded
			}
		}
		return idempotencyDecision{
			Action:       "replay",
			StatusCode:   statusCode,
			ResponseJSON: responseJSON,
		}, nil
	}

	if status == "processing" {
		updatedUnix, _ := strconv.ParseInt(strings.TrimSpace(parts[4]), 10, 64)
		if updatedUnix > 0 {
			if time.Since(time.Unix(updatedUnix, 0)) < ttl {
				return idempotencyDecision{Action: "conflict"}, nil
			}
		}
	}

	hashGuard := "(request_hash='' OR request_hash=" + persistenceSQLQuote(requestHash) + ")"
	stateGuard := "status=" + persistenceSQLQuote(status)
	if status == "processing" {
		stateGuard = "status='processing' AND updated_at <= NOW() - (" + persistenceSQLQuote(ttl.String()) + ")::interval"
	}

	update := "UPDATE kis_http_idempotency SET method=" + persistenceSQLQuote(method) +
		", path=" + persistenceSQLQuote(path) +
		", request_hash=" + persistenceSQLQuote(requestHash) +
		", status='processing', updated_at=NOW() WHERE service=" + persistenceSQLQuote(b.service) +
		" AND idempotency_key=" + persistenceSQLQuote(idKey) +
		" AND " + hashGuard +
		" AND " + stateGuard +
		" RETURNING status;"
	out, err = b.runPSQL(update, true)
	if err != nil {
		return idempotencyDecision{}, err
	}
	if persistenceLastValueLine(out) == "" {
		return idempotencyDecision{Action: "conflict"}, nil
	}
	return idempotencyDecision{Action: "proceed"}, nil
}

func (b *persistenceBackend) finishIdempotencyFailed(idKey, requestHash string, statusCode int, responseJSON []byte) error {
	update := "UPDATE kis_http_idempotency SET request_hash=" + persistenceSQLQuote(requestHash) +
		", status='failed', response_code=" + strconv.Itoa(statusCode) +
		", response_json=" + persistenceJSONExprFromBytes(responseJSON) +
		", updated_at=NOW() WHERE service=" + persistenceSQLQuote(b.service) +
		" AND idempotency_key=" + persistenceSQLQuote(idKey) + ";"
	_, err := b.runPSQL(update, false)
	return err
}

func (b *persistenceBackend) recordInbox(eventID string, payload []byte) error {
	sql := "INSERT INTO kis_inbox(event_id, service, status, payload, received_at, processed_at) VALUES(" +
		persistenceSQLQuote(eventID) + ", " +
		persistenceSQLQuote(b.service) + ", 'processed', " +
		persistenceJSONExprFromBytes(payload) + ", NOW(), NOW()) ON CONFLICT(event_id) DO NOTHING;"
	_, err := b.runPSQL(sql, false)
	return err
}

func (b *persistenceBackend) startSaga(sagaID, sagaType, state string, contextJSON []byte) error {
	sql := "INSERT INTO kis_saga_instances(id, service, saga_type, state, context, created_at, updated_at) VALUES(" +
		persistenceSQLQuote(sagaID) + ", " +
		persistenceSQLQuote(b.service) + ", " +
		persistenceSQLQuote(sagaType) + ", " +
		persistenceSQLQuote(state) + ", " +
		persistenceJSONExprFromBytes(contextJSON) +
		", NOW(), NOW()) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state, context=EXCLUDED.context, updated_at=NOW();"
	_, err := b.runPSQL(sql, false)
	return err
}

func (b *persistenceBackend) appendSagaStep(sagaID, stepName, status string, payload []byte, stepErr string) error {
	sql := "BEGIN;" +
		"UPDATE kis_saga_instances SET state=" + persistenceSQLQuote(status) + ", updated_at=NOW() WHERE id=" + persistenceSQLQuote(sagaID) +
		" AND service=" + persistenceSQLQuote(b.service) + ";" +
		"INSERT INTO kis_saga_steps(saga_id, step_name, status, payload, error, created_at) VALUES(" +
		persistenceSQLQuote(sagaID) + ", " +
		persistenceSQLQuote(stepName) + ", " +
		persistenceSQLQuote(status) + ", " +
		persistenceJSONExprFromBytes(payload) + ", " +
		persistenceSQLQuote(stepErr) + ", NOW());" +
		"COMMIT;"
	_, err := b.runPSQL(sql, false)
	return err
}

func (b *persistenceBackend) getSaga(sagaID string) (map[string]any, error) {
	instanceSQL := "SELECT id, saga_type, state, replace(encode(convert_to(COALESCE(context::text, ''), 'UTF8'), 'base64'), E'\\n', ''), created_at::text, updated_at::text FROM kis_saga_instances WHERE id=" +
		persistenceSQLQuote(sagaID) + " AND service=" + persistenceSQLQuote(b.service) + " LIMIT 1;"
	instanceOut, err := b.runPSQL(instanceSQL, true)
	if err != nil {
		return nil, err
	}
	instanceLine := persistenceLastValueLine(instanceOut)
	if instanceLine == "" {
		return nil, nil
	}
	parts := strings.Split(instanceLine, "|")
	if len(parts) < 6 {
		return nil, fmt.Errorf("invalid saga row")
	}

	result := map[string]any{
		"id":         parts[0],
		"saga_type":  parts[1],
		"state":      parts[2],
		"created_at": parts[4],
		"updated_at": parts[5],
	}
	if encoded := strings.TrimSpace(parts[3]); encoded != "" {
		if decoded, err := base64.StdEncoding.DecodeString(encoded); err == nil && len(decoded) > 0 {
			var ctx any
			if err := json.Unmarshal(decoded, &ctx); err == nil {
				result["context"] = ctx
			}
		}
	}

	stepsSQL := "SELECT step_name, status, replace(encode(convert_to(COALESCE(payload::text, ''), 'UTF8'), 'base64'), E'\\n', ''), error, created_at::text FROM kis_saga_steps WHERE saga_id=" +
		persistenceSQLQuote(sagaID) + " ORDER BY id ASC;"
	stepsOut, err := b.runPSQL(stepsSQL, true)
	if err != nil {
		return nil, err
	}
	stepLines := strings.Split(strings.TrimSpace(stepsOut), "\n")
	steps := make([]map[string]any, 0, len(stepLines))
	for _, line := range stepLines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		stepParts := strings.Split(line, "|")
		if len(stepParts) < 5 {
			continue
		}
		step := map[string]any{
			"step_name":  stepParts[0],
			"status":     stepParts[1],
			"error":      stepParts[3],
			"created_at": stepParts[4],
		}
		if encoded := strings.TrimSpace(stepParts[2]); encoded != "" {
			if decoded, err := base64.StdEncoding.DecodeString(encoded); err == nil && len(decoded) > 0 {
				var payload any
				if err := json.Unmarshal(decoded, &payload); err == nil {
					step["payload"] = payload
				}
			}
		}
		steps = append(steps, step)
	}
	result["steps"] = steps
	return result, nil
}

func (b *persistenceBackend) fetchPendingOutbox(limit int) ([]outboxRecord, error) {
	if limit <= 0 {
		limit = 50
	}
	sql := "SELECT id::text, event_type, aggregate_type, aggregate_id, replace(encode(convert_to(COALESCE(payload::text, ''), 'UTF8'), 'base64'), E'\\n', ''), attempts::text FROM kis_outbox WHERE service=" +
		persistenceSQLQuote(b.service) + " AND dispatched_at IS NULL AND available_at <= NOW() ORDER BY id ASC LIMIT " + strconv.Itoa(limit) + ";"
	out, err := b.runPSQL(sql, true)
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	events := make([]outboxRecord, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "|")
		if len(parts) < 6 {
			continue
		}
		id, err := strconv.ParseInt(strings.TrimSpace(parts[0]), 10, 64)
		if err != nil {
			continue
		}
		attempts, _ := strconv.Atoi(strings.TrimSpace(parts[5]))
		payload := []byte{}
		if encoded := strings.TrimSpace(parts[4]); encoded != "" {
			if decoded, err := base64.StdEncoding.DecodeString(encoded); err == nil {
				payload = decoded
			}
		}
		events = append(events, outboxRecord{
			ID:            id,
			EventType:     parts[1],
			AggregateType: parts[2],
			AggregateID:   parts[3],
			Payload:       payload,
			Attempts:      attempts,
		})
	}
	return events, nil
}

func (b *persistenceBackend) markOutboxResult(id int64, attempts int, deliveryErr error) error {
	if deliveryErr == nil {
		sql := "UPDATE kis_outbox SET attempts=attempts+1, last_error='', dispatched_at=NOW() WHERE id=" + strconv.FormatInt(id, 10) + ";"
		_, err := b.runPSQL(sql, false)
		return err
	}
	delay := outboxRetryDelay(attempts + 1)
	delayText := fmt.Sprintf("%d seconds", int(delay.Seconds()))
	errText := deliveryErr.Error()
	if len(errText) > 2000 {
		errText = errText[:2000]
	}
	sql := "UPDATE kis_outbox SET attempts=attempts+1, last_error=" + persistenceSQLQuote(errText) +
		", available_at=NOW()+(" + persistenceSQLQuote(delayText) + ")::interval WHERE id=" + strconv.FormatInt(id, 10) + ";"
	_, err := b.runPSQL(sql, false)
	return err
}

func (b *persistenceBackend) runPSQL(sqlText string, query bool) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), b.timeout)
	defer cancel()

	conn, err := b.pool.acquire(ctx)
	if err != nil {
		return "", err
	}
	result, queryErr := conn.query(ctx, sqlText)
	b.pool.release(conn, queryErr != nil)
	if queryErr != nil {
		return "", queryErr
	}
	if !query {
		return "", nil
	}

	var out strings.Builder
	for _, row := range result.Rows {
		for i, value := range row {
			if i > 0 {
				out.WriteString("|")
			}
			out.WriteString(value)
		}
		out.WriteString("\n")
	}
	return strings.TrimSpace(out.String()), nil
}

func newPGConnPool(cfg pgConnConfig) *pgConnPool {
	return &pgConnPool{
		cfg:            cfg,
		maxOpen:        persistenceIntEnvOrDefault("DB_MAX_OPEN_CONNS", 30),
		maxIdle:        persistenceIntEnvOrDefault("DB_MAX_IDLE_CONNS", 10),
		acquireTimeout: persistenceDurationEnvOrDefault("DB_ACQUIRE_TIMEOUT", 4*time.Second),
	}
}

func (p *pgConnPool) acquire(ctx context.Context) (*pgConn, error) {
	deadline := time.Now().Add(p.acquireTimeout)
	if dl, ok := ctx.Deadline(); ok && dl.Before(deadline) {
		deadline = dl
	}

	for {
		p.mu.Lock()
		idleCount := len(p.idle)
		if idleCount > 0 {
			conn := p.idle[idleCount-1]
			p.idle = p.idle[:idleCount-1]
			p.mu.Unlock()
			return conn, nil
		}
		if p.open < p.maxOpen {
			p.open++
			p.mu.Unlock()
			conn, err := newPGConn(ctx, p.cfg)
			if err != nil {
				p.mu.Lock()
				p.open--
				p.mu.Unlock()
				return nil, err
			}
			return conn, nil
		}
		p.mu.Unlock()

		if time.Now().After(deadline) {
			return nil, fmt.Errorf("postgres connection acquire timeout")
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(15 * time.Millisecond):
		}
	}
}

func (p *pgConnPool) release(conn *pgConn, broken bool) {
	if conn == nil {
		return
	}
	if broken {
		_ = conn.Close()
		p.mu.Lock()
		p.open--
		p.mu.Unlock()
		return
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.idle) >= p.maxIdle {
		_ = conn.Close()
		p.open--
		return
	}
	p.idle = append(p.idle, conn)
}

func newPGConn(ctx context.Context, cfg pgConnConfig) (*pgConn, error) {
	dialer := net.Dialer{Timeout: cfg.Timeout}
	rawConn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(cfg.Host, cfg.Port))
	if err != nil {
		return nil, err
	}

	conn := rawConn
	sslMode := strings.ToLower(strings.TrimSpace(cfg.SSLMode))
	if sslMode != "" && sslMode != "disable" {
		if err := postgresEnableTLS(conn); err != nil {
			_ = conn.Close()
			return nil, err
		}
		tlsCfg := &tls.Config{
			ServerName:         cfg.Host,
			InsecureSkipVerify: sslMode != "verify-full",
		}
		tlsConn := tls.Client(conn, tlsCfg)
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			_ = tlsConn.Close()
			return nil, err
		}
		conn = tlsConn
	}

	pgConn := &pgConn{Conn: conn}
	if err := pgConn.authenticate(ctx, cfg); err != nil {
		_ = pgConn.Close()
		return nil, err
	}
	return pgConn, nil
}

func postgresEnableTLS(conn net.Conn) error {
	packet := make([]byte, 8)
	binary.BigEndian.PutUint32(packet[0:4], 8)
	binary.BigEndian.PutUint32(packet[4:8], postgresSSLRequestCode)
	if _, err := conn.Write(packet); err != nil {
		return err
	}
	response := make([]byte, 1)
	if _, err := io.ReadFull(conn, response); err != nil {
		return err
	}
	if response[0] != 'S' {
		return fmt.Errorf("postgres ssl is not supported by server")
	}
	return nil
}

func (c *pgConn) authenticate(ctx context.Context, cfg pgConnConfig) error {
	if err := c.setDeadline(ctx); err != nil {
		return err
	}
	defer c.clearDeadline()

	if err := c.writeStartupPacket(cfg.User, cfg.DBName); err != nil {
		return err
	}

	var scram *scramClient
	for {
		msgType, payload, err := c.readMessage()
		if err != nil {
			return err
		}

		switch msgType {
		case 'R':
			if len(payload) < 4 {
				return fmt.Errorf("invalid postgres auth payload")
			}
			authCode := binary.BigEndian.Uint32(payload[:4])
			switch authCode {
			case 0:
				continue
			case 3:
				if err := c.writePasswordMessage(cfg.Password); err != nil {
					return err
				}
			case 5:
				if len(payload) < 8 {
					return fmt.Errorf("invalid md5 auth payload")
				}
				salt := payload[4:8]
				if err := c.writePasswordMessage(postgresMD5Password(cfg.User, cfg.Password, salt)); err != nil {
					return err
				}
			case 10:
				if !postgresHasSCRAM(payload[4:]) {
					return fmt.Errorf("SCRAM-SHA-256 is required")
				}
				scram = newSCRAMClient(cfg.User, cfg.Password)
				first := scram.clientFirstMessage()
				initial := make([]byte, 0, 64+len(first))
				initial = append(initial, []byte("SCRAM-SHA-256")...)
				initial = append(initial, 0)
				size := make([]byte, 4)
				binary.BigEndian.PutUint32(size, uint32(len(first)))
				initial = append(initial, size...)
				initial = append(initial, []byte(first)...)
				if err := c.writeMessage('p', initial); err != nil {
					return err
				}
			case 11:
				if scram == nil {
					return fmt.Errorf("unexpected SCRAM continue payload")
				}
				final, err := scram.handleServerFirst(string(payload[4:]))
				if err != nil {
					return err
				}
				if err := c.writeMessage('p', []byte(final)); err != nil {
					return err
				}
			case 12:
				if scram == nil {
					return fmt.Errorf("unexpected SCRAM final payload")
				}
				if err := scram.verifyServerFinal(string(payload[4:])); err != nil {
					return err
				}
			default:
				return fmt.Errorf("unsupported postgres auth code: %d", authCode)
			}
		case 'S', 'K', 'N':
			continue
		case 'Z':
			return nil
		case 'E':
			return fmt.Errorf(parsePostgresError(payload))
		default:
			return fmt.Errorf("unexpected postgres auth message: %q", msgType)
		}
	}
}

func (c *pgConn) query(ctx context.Context, sqlText string) (pgQueryResult, error) {
	if err := c.setDeadline(ctx); err != nil {
		return pgQueryResult{}, err
	}
	defer c.clearDeadline()

	if err := c.writeMessage('Q', append([]byte(sqlText), 0)); err != nil {
		return pgQueryResult{}, err
	}

	result := pgQueryResult{}
	var firstErr error
	for {
		msgType, payload, err := c.readMessage()
		if err != nil {
			return pgQueryResult{}, err
		}
		switch msgType {
		case 'T':
			columns, err := postgresParseRowDescription(payload)
			if err != nil {
				return pgQueryResult{}, err
			}
			result.Columns = columns
		case 'D':
			values, err := postgresParseDataRow(payload)
			if err != nil {
				return pgQueryResult{}, err
			}
			result.Rows = append(result.Rows, values)
		case 'C', 'N', 'S', 'K':
			continue
		case 'E':
			if firstErr == nil {
				firstErr = fmt.Errorf(parsePostgresError(payload))
			}
		case 'Z':
			if firstErr != nil {
				return pgQueryResult{}, firstErr
			}
			return result, nil
		default:
			return pgQueryResult{}, fmt.Errorf("unexpected postgres query message: %q", msgType)
		}
	}
}

func (c *pgConn) setDeadline(ctx context.Context) error {
	if c == nil || c.Conn == nil {
		return fmt.Errorf("nil postgres connection")
	}
	if ctx == nil {
		return c.Conn.SetDeadline(time.Now().Add(5 * time.Second))
	}
	if deadline, ok := ctx.Deadline(); ok {
		return c.Conn.SetDeadline(deadline)
	}
	return c.Conn.SetDeadline(time.Now().Add(5 * time.Second))
}

func (c *pgConn) clearDeadline() {
	if c != nil && c.Conn != nil {
		_ = c.Conn.SetDeadline(time.Time{})
	}
}

func (c *pgConn) writeStartupPacket(user, dbName string) error {
	payload := make([]byte, 4)
	binary.BigEndian.PutUint32(payload[:4], persistenceProtocolVersion)

	params := []string{"user", user, "database", dbName, "client_encoding", "UTF8"}
	for _, param := range params {
		payload = append(payload, []byte(param)...)
		payload = append(payload, 0)
	}
	payload = append(payload, 0)

	packet := make([]byte, 4+len(payload))
	binary.BigEndian.PutUint32(packet[:4], uint32(len(packet)))
	copy(packet[4:], payload)

	return postgresWriteAll(c.Conn, packet)
}

func (c *pgConn) writePasswordMessage(password string) error {
	return c.writeMessage('p', append([]byte(password), 0))
}

func (c *pgConn) writeMessage(msgType byte, payload []byte) error {
	header := make([]byte, 5)
	header[0] = msgType
	binary.BigEndian.PutUint32(header[1:], uint32(len(payload)+4))
	if err := postgresWriteAll(c.Conn, header); err != nil {
		return err
	}
	if len(payload) == 0 {
		return nil
	}
	return postgresWriteAll(c.Conn, payload)
}

func postgresWriteAll(conn net.Conn, data []byte) error {
	for len(data) > 0 {
		n, err := conn.Write(data)
		if err != nil {
			return err
		}
		if n <= 0 {
			return io.ErrUnexpectedEOF
		}
		data = data[n:]
	}
	return nil
}

func (c *pgConn) readMessage() (byte, []byte, error) {
	header := make([]byte, 5)
	if _, err := io.ReadFull(c.Conn, header); err != nil {
		return 0, nil, err
	}
	length := binary.BigEndian.Uint32(header[1:])
	if length < 4 {
		return 0, nil, fmt.Errorf("invalid postgres message length: %d", length)
	}

	payload := make([]byte, int(length)-4)
	if len(payload) > 0 {
		if _, err := io.ReadFull(c.Conn, payload); err != nil {
			return 0, nil, err
		}
	}
	return header[0], payload, nil
}

func postgresHasSCRAM(payload []byte) bool {
	mechanisms := strings.Split(string(payload), "\x00")
	for _, mechanism := range mechanisms {
		if mechanism == "SCRAM-SHA-256" {
			return true
		}
	}
	return false
}

func postgresParseRowDescription(payload []byte) ([]string, error) {
	if len(payload) < 2 {
		return nil, fmt.Errorf("invalid row description payload")
	}
	count := int(binary.BigEndian.Uint16(payload[:2]))
	offset := 2
	columns := make([]string, 0, count)
	for i := 0; i < count; i++ {
		name, next, err := postgresReadCString(payload, offset)
		if err != nil {
			return nil, err
		}
		columns = append(columns, name)
		offset = next
		if offset+18 > len(payload) {
			return nil, fmt.Errorf("invalid row description column metadata")
		}
		offset += 18
	}
	return columns, nil
}

func postgresParseDataRow(payload []byte) ([]string, error) {
	if len(payload) < 2 {
		return nil, fmt.Errorf("invalid data row payload")
	}
	count := int(binary.BigEndian.Uint16(payload[:2]))
	offset := 2
	values := make([]string, 0, count)
	for i := 0; i < count; i++ {
		if offset+4 > len(payload) {
			return nil, fmt.Errorf("invalid data row field length")
		}
		fieldLen := int(int32(binary.BigEndian.Uint32(payload[offset : offset+4])))
		offset += 4
		if fieldLen < 0 {
			values = append(values, "")
			continue
		}
		if offset+fieldLen > len(payload) {
			return nil, fmt.Errorf("invalid data row field payload")
		}
		values = append(values, string(payload[offset:offset+fieldLen]))
		offset += fieldLen
	}
	return values, nil
}

func postgresReadCString(data []byte, offset int) (string, int, error) {
	if offset < 0 || offset >= len(data) {
		return "", 0, fmt.Errorf("invalid cstring offset")
	}
	i := offset
	for i < len(data) && data[i] != 0 {
		i++
	}
	if i >= len(data) {
		return "", 0, fmt.Errorf("unterminated cstring")
	}
	return string(data[offset:i]), i + 1, nil
}

func parsePostgresError(payload []byte) string {
	message := "unknown postgres error"
	code := ""
	for i := 0; i < len(payload) && payload[i] != 0; {
		fieldType := payload[i]
		i++
		start := i
		for i < len(payload) && payload[i] != 0 {
			i++
		}
		if i >= len(payload) {
			break
		}

		value := string(payload[start:i])
		i++
		switch fieldType {
		case 'M':
			message = value
		case 'C':
			code = value
		}
	}
	if code == "" {
		return message
	}
	return code + " " + message
}

func postgresMD5Password(user, password string, salt []byte) string {
	inner := md5.Sum([]byte(password + user))
	innerHex := hex.EncodeToString(inner[:])
	outer := md5.Sum(append([]byte(innerHex), salt...))
	return "md5" + hex.EncodeToString(outer[:])
}

type scramClient struct {
	user              string
	password          string
	clientNonce       string
	clientFirstBare   string
	authMessage       string
	serverSignature64 string
}

func newSCRAMClient(user, password string) *scramClient {
	nonceBytes := make([]byte, 18)
	if _, err := rand.Read(nonceBytes); err != nil {
		nonceBytes = []byte(strconv.FormatInt(time.Now().UnixNano(), 10))
	}
	return &scramClient{
		user:        user,
		password:    password,
		clientNonce: base64.RawStdEncoding.EncodeToString(nonceBytes),
	}
}

func (s *scramClient) clientFirstMessage() string {
	escapedUser := strings.ReplaceAll(strings.ReplaceAll(s.user, "=", "=3D"), ",", "=2C")
	s.clientFirstBare = "n=" + escapedUser + ",r=" + s.clientNonce
	return "n,," + s.clientFirstBare
}

func (s *scramClient) handleServerFirst(serverFirst string) (string, error) {
	attrs := parseSCRAMAttributes(serverFirst)
	nonce := attrs["r"]
	saltB64 := attrs["s"]
	iterRaw := attrs["i"]
	if nonce == "" || saltB64 == "" || iterRaw == "" {
		return "", fmt.Errorf("invalid SCRAM server-first payload")
	}
	if !strings.HasPrefix(nonce, s.clientNonce) {
		return "", fmt.Errorf("SCRAM nonce mismatch")
	}
	iterations, err := strconv.Atoi(iterRaw)
	if err != nil || iterations <= 0 {
		return "", fmt.Errorf("invalid SCRAM iteration count")
	}
	salt, err := base64.StdEncoding.DecodeString(saltB64)
	if err != nil {
		return "", fmt.Errorf("decode SCRAM salt: %w", err)
	}

	clientFinalWithoutProof := "c=biws,r=" + nonce
	s.authMessage = s.clientFirstBare + "," + serverFirst + "," + clientFinalWithoutProof

	saltedPassword := pbkdf2SHA256([]byte(s.password), salt, iterations, 32)
	clientKey := hmacSHA256(saltedPassword, []byte("Client Key"))
	storedKey := sha256.Sum256(clientKey)
	clientSignature := hmacSHA256(storedKey[:], []byte(s.authMessage))
	clientProof := xorBytes(clientKey, clientSignature)

	serverKey := hmacSHA256(saltedPassword, []byte("Server Key"))
	serverSignature := hmacSHA256(serverKey, []byte(s.authMessage))
	s.serverSignature64 = base64.StdEncoding.EncodeToString(serverSignature)

	return clientFinalWithoutProof + ",p=" + base64.StdEncoding.EncodeToString(clientProof), nil
}

func (s *scramClient) verifyServerFinal(serverFinal string) error {
	attrs := parseSCRAMAttributes(serverFinal)
	if serverErr := attrs["e"]; serverErr != "" {
		return fmt.Errorf("SCRAM server error: %s", serverErr)
	}
	signature := attrs["v"]
	if signature == "" {
		return fmt.Errorf("missing SCRAM server signature")
	}
	if signature != s.serverSignature64 {
		return fmt.Errorf("SCRAM server signature mismatch")
	}
	return nil
}

func parseSCRAMAttributes(raw string) map[string]string {
	out := map[string]string{}
	parts := strings.Split(raw, ",")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if len(part) < 3 || part[1] != '=' {
			continue
		}
		out[string(part[0])] = part[2:]
	}
	return out
}

func hmacSHA256(key []byte, message []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(message)
	return mac.Sum(nil)
}

func xorBytes(a, b []byte) []byte {
	if len(a) != len(b) {
		return nil
	}
	out := make([]byte, len(a))
	for i := range a {
		out[i] = a[i] ^ b[i]
	}
	return out
}

func pbkdf2SHA256(password, salt []byte, iter, keyLen int) []byte {
	if iter <= 0 {
		iter = 1
	}
	hashLen := 32
	blocks := (keyLen + hashLen - 1) / hashLen
	out := make([]byte, 0, blocks*hashLen)

	for block := 1; block <= blocks; block++ {
		mac := hmac.New(sha256.New, password)
		mac.Write(salt)
		blockBytes := make([]byte, 4)
		binary.BigEndian.PutUint32(blockBytes, uint32(block))
		mac.Write(blockBytes)
		u := mac.Sum(nil)

		t := make([]byte, len(u))
		copy(t, u)
		for i := 1; i < iter; i++ {
			mac = hmac.New(sha256.New, password)
			mac.Write(u)
			u = mac.Sum(nil)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		out = append(out, t...)
	}
	return out[:keyLen]
}

type bufferedResponseWriter struct {
	header http.Header
	body   bytes.Buffer
	status int
}

func newBufferedResponseWriter() *bufferedResponseWriter {
	return &bufferedResponseWriter{
		header: make(http.Header),
	}
}

func (w *bufferedResponseWriter) Header() http.Header {
	return w.header
}

func (w *bufferedResponseWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.body.Write(data)
}

func (w *bufferedResponseWriter) WriteHeader(statusCode int) {
	if w.status == 0 {
		w.status = statusCode
	}
}

func (w *bufferedResponseWriter) statusCode() int {
	if w.status == 0 {
		return http.StatusOK
	}
	return w.status
}

func (w *bufferedResponseWriter) BodyBytes() []byte {
	return w.body.Bytes()
}

func (w *bufferedResponseWriter) WriteTo(dst http.ResponseWriter) {
	for key, values := range w.header {
		for _, value := range values {
			dst.Header().Add(key, value)
		}
	}
	dst.WriteHeader(w.statusCode())
	_, _ = dst.Write(w.body.Bytes())
}

func persistenceReadBody(body io.ReadCloser) ([]byte, error) {
	defer body.Close()
	limited := io.LimitReader(body, persistenceBodyLimitBytes+1)
	raw, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if len(raw) > persistenceBodyLimitBytes {
		return nil, fmt.Errorf("body is too large")
	}
	return raw, nil
}

func persistenceNormalizeJSON(raw []byte) []byte {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil
	}

	var value any
	if err := json.Unmarshal(trimmed, &value); err != nil {
		return nil
	}

	normalized, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return normalized
}

func decodeJSONBody(r *http.Request, dst any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(r.Body, persistenceBodyLimitBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return fmt.Errorf("invalid json: %w", err)
	}
	return nil
}

func asString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}

func marshalAny(value any) []byte {
	if value == nil {
		return nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return raw
}

func persistenceParseTargets(raw string) []string {
	items := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ';'
	})
	out := make([]string, 0, len(items))
	for _, item := range items {
		target := strings.TrimSpace(item)
		if target == "" {
			continue
		}
		out = append(out, target)
	}
	return out
}

func outboxRetryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 10 {
		attempt = 10
	}
	delay := time.Second * time.Duration(1<<(attempt-1))
	if delay > 5*time.Minute {
		return 5 * time.Minute
	}
	return delay
}

func persistenceRequestHash(method, path, query string, body []byte) string {
	hash := sha256.New()
	hash.Write([]byte(strings.ToUpper(strings.TrimSpace(method))))
	hash.Write([]byte{'\n'})
	hash.Write([]byte(strings.TrimSpace(path)))
	hash.Write([]byte{'\n'})
	hash.Write([]byte(strings.TrimSpace(query)))
	hash.Write([]byte{'\n'})
	hash.Write(body)
	return hex.EncodeToString(hash.Sum(nil))
}

func persistenceWriteJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func persistenceWriteRawJSON(w http.ResponseWriter, status int, payload []byte) {
	if len(bytes.TrimSpace(payload)) == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte("{}"))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(payload)
}

func persistenceIsMutatingMethod(method string) bool {
	switch strings.ToUpper(strings.TrimSpace(method)) {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func persistenceExtractLinks(service string, requestJSON, responseJSON []byte) []entityLink {
	reqValue := persistenceDecodeJSON(requestJSON)
	respValue := persistenceDecodeJSON(responseJSON)

	sourceID := persistenceFindPrimaryID(respValue)
	if sourceID == "" {
		sourceID = persistenceFindPrimaryID(reqValue)
	}
	if sourceID == "" {
		return nil
	}

	candidates := make(map[string]string)
	persistenceCollectRelationCandidates(reqValue, candidates)
	persistenceCollectRelationCandidates(respValue, candidates)

	links := make([]entityLink, 0, len(candidates))
	seen := make(map[string]bool)
	sourceEntity := service + ":" + sourceID

	for key, value := range candidates {
		if key == "id" || strings.TrimSpace(value) == "" {
			continue
		}
		targetDomain := persistenceGuessDomainForKey(key)
		targetEntity := ""
		if targetDomain == "" {
			targetEntity = key + ":" + value
		} else {
			targetEntity = targetDomain + ":" + value
		}
		if targetEntity == sourceEntity {
			continue
		}

		dedup := key + "|" + targetEntity
		if seen[dedup] {
			continue
		}
		seen[dedup] = true
		links = append(links, entityLink{
			SourceEntity: sourceEntity,
			RelationKey:  key,
			TargetEntity: targetEntity,
		})
	}

	sort.Slice(links, func(i, j int) bool {
		if links[i].RelationKey == links[j].RelationKey {
			return links[i].TargetEntity < links[j].TargetEntity
		}
		return links[i].RelationKey < links[j].RelationKey
	})
	return links
}

type entityPayload struct {
	EntityType string
	EntityID   string
	Payload    []byte
}

func persistenceExtractEntityPayloads(raw []byte) []entityPayload {
	if len(raw) == 0 {
		return nil
	}

	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}

	itemsByKey := map[string]entityPayload{}
	persistenceCollectEntityPayloads(value, "", itemsByKey)
	items := make([]entityPayload, 0, len(itemsByKey))
	for _, item := range itemsByKey {
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].EntityType == items[j].EntityType {
			return items[i].EntityID < items[j].EntityID
		}
		return items[i].EntityType < items[j].EntityType
	})
	return items
}

func persistenceCollectEntityPayloads(value any, parent string, out map[string]entityPayload) {
	switch typed := value.(type) {
	case map[string]any:
		if rawID, ok := typed["id"].(string); ok {
			entityID := strings.TrimSpace(rawID)
			if entityID != "" {
				entityType := persistenceNormalizeEntityType(parent)
				if entityType == "" {
					entityType = "entity"
				}
				if payload, err := json.Marshal(typed); err == nil {
					key := entityType + "|" + entityID
					out[key] = entityPayload{
						EntityType: entityType,
						EntityID:   entityID,
						Payload:    payload,
					}
				}
			}
		}
		for key, nested := range typed {
			persistenceCollectEntityPayloads(nested, key, out)
		}
	case []any:
		nextParent := persistenceSingularize(parent)
		for _, nested := range typed {
			persistenceCollectEntityPayloads(nested, nextParent, out)
		}
	}
}

func persistenceSingularize(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if strings.HasSuffix(value, "ies") && len(value) > 3 {
		return value[:len(value)-3] + "y"
	}
	if strings.HasSuffix(value, "s") && len(value) > 1 {
		return value[:len(value)-1]
	}
	return value
}

func persistenceNormalizeEntityType(value string) string {
	value = persistenceSingularize(value)
	value = strings.ReplaceAll(value, "-", "_")
	value = strings.ReplaceAll(value, " ", "_")
	return strings.TrimSpace(value)
}

func persistenceDecodeJSON(raw []byte) any {
	if len(raw) == 0 {
		return nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}
	return value
}

func persistenceFindPrimaryID(value any) string {
	switch typed := value.(type) {
	case map[string]any:
		if id, ok := typed["id"].(string); ok {
			id = strings.TrimSpace(id)
			if id != "" {
				return id
			}
		}
		for _, nested := range typed {
			if id := persistenceFindPrimaryID(nested); id != "" {
				return id
			}
		}
	case []any:
		for _, nested := range typed {
			if id := persistenceFindPrimaryID(nested); id != "" {
				return id
			}
		}
	}
	return ""
}

func persistenceCollectRelationCandidates(value any, out map[string]string) {
	switch typed := value.(type) {
	case map[string]any:
		for key, nested := range typed {
			normalizedKey := strings.ToLower(strings.TrimSpace(key))
			if persistenceIsRelationKey(normalizedKey) {
				if str, ok := nested.(string); ok {
					str = strings.TrimSpace(str)
					if str != "" {
						out[normalizedKey] = str
					}
				}
			}
			persistenceCollectRelationCandidates(nested, out)
		}
	case []any:
		for _, nested := range typed {
			persistenceCollectRelationCandidates(nested, out)
		}
	}
}

func persistenceIsRelationKey(key string) bool {
	if key == "id" {
		return true
	}
	if strings.HasSuffix(key, "_id") {
		return true
	}
	switch key {
	case "vin", "vehicle_vin", "reserved_vin":
		return true
	default:
		return false
	}
}

func persistenceGuessDomainForKey(key string) string {
	switch key {
	case "client_id", "contact_id":
		return "crm-contacts"
	case "lead_id":
		return "crm-leads"
	case "deal_id":
		return "sales-deals"
	case "document_id", "sales_document_id":
		return "sales-documents"
	case "owner_id", "user_id", "actor_id", "technician_id", "advisor_id":
		return "identity-access"
	case "appointment_id":
		return "service-appointments"
	case "workorder_id", "work_order_id":
		return "service-workorders"
	case "invoice_id":
		return "finance-invoicing"
	case "ledger_id":
		return "finance-ledger"
	case "vendor_id", "supplier_id":
		return "inventory-procurement"
	case "part_id", "item_id", "stock_item_id", "vin", "vehicle_vin", "reserved_vin":
		return "inventory-stock"
	default:
		return ""
	}
}

func persistenceResolveDBName(service string) string {
	if value := strings.TrimSpace(os.Getenv("DB_NAME")); value != "" {
		return value
	}
	if rawURL := strings.TrimSpace(os.Getenv("DATABASE_URL")); rawURL != "" {
		parsed, err := url.Parse(rawURL)
		if err == nil {
			name := strings.TrimSpace(strings.TrimPrefix(parsed.Path, "/"))
			if name != "" {
				return name
			}
		}
	}
	return strings.ReplaceAll(strings.ToLower(strings.TrimSpace(service)), "-", "_")
}

func persistenceEnvOrDefault(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func persistenceBoolEnvOrDefault(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func persistenceIntEnvOrDefault(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func persistenceDurationEnvOrDefault(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func persistenceSQLQuote(value string) string {
	escaped := strings.ReplaceAll(value, "'", "''")
	return "'" + escaped + "'"
}

func persistenceJSONExprFromBytes(raw []byte) string {
	if len(raw) == 0 {
		return "NULL"
	}
	encoded := base64.StdEncoding.EncodeToString(raw)
	return "convert_from(decode('" + encoded + "', 'base64'), 'UTF8')::jsonb"
}

func persistenceLastValueLine(output string) string {
	lines := strings.Split(output, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		if strings.HasPrefix(strings.ToUpper(line), "WARNING:") {
			continue
		}
		if strings.HasPrefix(strings.ToUpper(line), "WARN[") {
			continue
		}
		return line
	}
	return ""
}
