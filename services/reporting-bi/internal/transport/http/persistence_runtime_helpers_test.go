package httptransport

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPersistenceRuntime_EnvAndParsingHelpers(t *testing.T) {
	t.Setenv("BOOL_OK", "true")
	t.Setenv("BOOL_BAD", "not-bool")
	t.Setenv("INT_OK", "42")
	t.Setenv("INT_BAD", "-1")
	t.Setenv("DUR_OK", "3s")
	t.Setenv("DUR_BAD", "bad")

	if got := persistenceParseTargets("  http://a, http://b ; http://c ,,;"); len(got) != 3 {
		t.Fatalf("expected 3 targets, got %d (%v)", len(got), got)
	}
	if got := outboxRetryDelay(0); got != time.Second {
		t.Fatalf("expected 1s retry delay, got %v", got)
	}
	if got := outboxRetryDelay(20); got != 5*time.Minute {
		t.Fatalf("expected capped retry delay, got %v", got)
	}
	if !persistenceIsMutatingMethod(http.MethodPatch) {
		t.Fatal("expected PATCH to be mutating")
	}
	if persistenceIsMutatingMethod(http.MethodGet) {
		t.Fatal("expected GET to be non-mutating")
	}

	if got := persistenceBoolEnvOrDefault("BOOL_OK", false); !got {
		t.Fatal("expected true bool env")
	}
	if got := persistenceBoolEnvOrDefault("BOOL_BAD", true); !got {
		t.Fatal("expected fallback bool")
	}
	if got := persistenceIntEnvOrDefault("INT_OK", 5); got != 42 {
		t.Fatalf("expected 42, got %d", got)
	}
	if got := persistenceIntEnvOrDefault("INT_BAD", 5); got != 5 {
		t.Fatalf("expected fallback int 5, got %d", got)
	}
	if got := persistenceDurationEnvOrDefault("DUR_OK", 7*time.Second); got != 3*time.Second {
		t.Fatalf("expected 3s duration, got %v", got)
	}
	if got := persistenceDurationEnvOrDefault("DUR_BAD", 7*time.Second); got != 7*time.Second {
		t.Fatalf("expected fallback duration, got %v", got)
	}

	t.Setenv("DB_NAME", "kis_custom")
	if got := persistenceResolveDBName("pricing-service"); got != "kis_custom" {
		t.Fatalf("expected DB_NAME override, got %q", got)
	}
	t.Setenv("DB_NAME", "")
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/kis_from_url?sslmode=disable")
	if got := persistenceResolveDBName("pricing-service"); got != "kis_from_url" {
		t.Fatalf("expected db name from URL, got %q", got)
	}
	t.Setenv("DATABASE_URL", "%%%")
	if got := persistenceResolveDBName("pricing-service"); got != "pricing_service" {
		t.Fatalf("expected fallback db name, got %q", got)
	}

	if got := persistenceSQLQuote("a'b"); got != "'a''b'" {
		t.Fatalf("unexpected SQL quote: %q", got)
	}
	if got := persistenceJSONExprFromBytes(nil); got != "NULL" {
		t.Fatalf("expected NULL expression, got %q", got)
	}
	if got := persistenceJSONExprFromBytes([]byte(`{"a":1}`)); !strings.Contains(got, "::jsonb") {
		t.Fatalf("expected jsonb cast expression, got %q", got)
	}

	line := persistenceLastValueLine("\nWARNING: noise\nwarn[11]: skip\nactual-value\n")
	if line != "actual-value" {
		t.Fatalf("unexpected last value line: %q", line)
	}
}

func TestPersistenceRuntime_JSONAndHashHelpers(t *testing.T) {
	normalized := persistenceNormalizeJSON([]byte(` { "b": 2, "a": 1 } `))
	if string(normalized) != `{"a":1,"b":2}` {
		t.Fatalf("unexpected normalized JSON: %s", string(normalized))
	}
	if got := persistenceNormalizeJSON([]byte(`{`)); got != nil {
		t.Fatalf("expected nil for invalid JSON, got %q", string(got))
	}

	h1 := persistenceRequestHash(http.MethodPost, "/items", "a=1", []byte(`{"x":1}`))
	h2 := persistenceRequestHash(http.MethodPost, "/items", "a=1", []byte(`{"x":1}`))
	h3 := persistenceRequestHash(http.MethodPost, "/items", "a=2", []byte(`{"x":1}`))
	if h1 != h2 {
		t.Fatalf("expected deterministic hash, got %s and %s", h1, h2)
	}
	if h1 == h3 {
		t.Fatal("expected distinct hash for different query")
	}

	req := httptest.NewRequest(http.MethodPost, "/decode", strings.NewReader(`{"name":"ok"}`))
	var payload struct {
		Name string `json:"name"`
	}
	if err := decodeJSONBody(req, &payload); err != nil {
		t.Fatalf("decodeJSONBody failed: %v", err)
	}
	if payload.Name != "ok" {
		t.Fatalf("unexpected decoded name %q", payload.Name)
	}

	badReq := httptest.NewRequest(http.MethodPost, "/decode", strings.NewReader(`{"name":"ok","extra":1}`))
	if err := decodeJSONBody(badReq, &payload); err == nil {
		t.Fatal("expected unknown-field error")
	}

	if got := asString("value"); got != "value" {
		t.Fatalf("expected string cast, got %q", got)
	}
	if got := asString(123); got != "" {
		t.Fatalf("expected empty string for non-string, got %q", got)
	}
	if got := marshalAny(nil); got != nil {
		t.Fatalf("expected nil marshal for nil value, got %q", string(got))
	}
	if got := string(marshalAny(map[string]any{"x": 1})); got != `{"x":1}` {
		t.Fatalf("unexpected marshalAny output: %q", got)
	}

	body, err := persistenceReadBody(io.NopCloser(strings.NewReader(`{"ok":true}`)))
	if err != nil {
		t.Fatalf("persistenceReadBody failed: %v", err)
	}
	if string(body) != `{"ok":true}` {
		t.Fatalf("unexpected body read: %q", string(body))
	}
	big := bytes.Repeat([]byte("x"), persistenceBodyLimitBytes+1)
	if _, err := persistenceReadBody(io.NopCloser(bytes.NewReader(big))); err == nil {
		t.Fatal("expected body size error")
	}

	errRR := httptest.NewRecorder()
	persistenceWriteJSONError(errRR, http.StatusBadRequest, "bad")
	if errRR.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", errRR.Code)
	}

	rawRR := httptest.NewRecorder()
	persistenceWriteRawJSON(rawRR, http.StatusCreated, nil)
	if rawRR.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", rawRR.Code)
	}
	if strings.TrimSpace(rawRR.Body.String()) != "{}" {
		t.Fatalf("expected empty object payload, got %q", rawRR.Body.String())
	}
}

func TestPersistenceRuntime_BufferedResponseWriter(t *testing.T) {
	writer := newBufferedResponseWriter()
	writer.Header().Set("X-Test", "1")
	_, _ = writer.Write([]byte(`{"status":"ok"}`))
	if writer.statusCode() != http.StatusOK {
		t.Fatalf("expected default status 200, got %d", writer.statusCode())
	}
	if got := string(writer.BodyBytes()); got != `{"status":"ok"}` {
		t.Fatalf("unexpected buffered body: %q", got)
	}

	dst := httptest.NewRecorder()
	writer.WriteTo(dst)
	if dst.Code != http.StatusOK {
		t.Fatalf("expected forwarded status 200, got %d", dst.Code)
	}
	if dst.Header().Get("X-Test") != "1" {
		t.Fatalf("expected forwarded header, got %+v", dst.Header())
	}

	writer2 := newBufferedResponseWriter()
	writer2.WriteHeader(http.StatusNoContent)
	if writer2.statusCode() != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", writer2.statusCode())
	}
}

func TestPersistenceRuntime_LinkAndEntityExtraction(t *testing.T) {
	reqJSON := []byte(`{
		"id":"entity-1",
		"deal_id":"DL-1",
		"vehicle_vin":"VIN-123",
		"lines":[{"id":"line-1","part_id":"P-1"}]
	}`)
	respJSON := []byte(`{
		"id":"entity-1",
		"source":{"workorder_id":"WO-1"},
		"items":[{"id":"nested-1","supplier_id":"SUP-9"}]
	}`)

	links := persistenceExtractLinks("service-workorders", reqJSON, respJSON)
	if len(links) == 0 {
		t.Fatal("expected at least one entity link")
	}

	payloads := persistenceExtractEntityPayloads([]byte(`{
		"workorders":[{"id":"wo-1","status":"open"}],
		"invoice":{"id":"inv-1","total":100}
	}`))
	if len(payloads) != 2 {
		t.Fatalf("expected 2 extracted payloads, got %d", len(payloads))
	}
	if payloads[0].EntityType == "" || payloads[0].EntityID == "" || len(payloads[0].Payload) == 0 {
		t.Fatalf("unexpected extracted payload: %+v", payloads[0])
	}

	if got := persistenceSingularize("bodies"); got != "body" {
		t.Fatalf("unexpected singularize result: %q", got)
	}
	if got := persistenceNormalizeEntityType("Sales-Items "); got != "sales_item" {
		t.Fatalf("unexpected normalized type: %q", got)
	}
	if got := persistenceFindPrimaryID(map[string]any{"meta": map[string]any{"id": "primary-1"}}); got != "primary-1" {
		t.Fatalf("unexpected primary ID %q", got)
	}
	if !persistenceIsRelationKey("lead_id") || persistenceIsRelationKey("name") {
		t.Fatal("unexpected relation key classification")
	}
	if got := persistenceGuessDomainForKey("vin"); got != "inventory-stock" {
		t.Fatalf("unexpected guessed domain: %q", got)
	}
}

func TestPersistenceRuntime_PostgresAndSCRAMHelpers(t *testing.T) {
	if !postgresHasSCRAM([]byte("SCRAM-SHA-256\x00MD5\x00")) {
		t.Fatal("expected SCRAM mechanism detection")
	}
	if postgresHasSCRAM([]byte("MD5\x00")) {
		t.Fatal("unexpected SCRAM detection")
	}

	value, next, err := postgresReadCString([]byte("hello\x00world\x00"), 0)
	if err != nil || value != "hello" || next != 6 {
		t.Fatalf("unexpected cstring parse: value=%q next=%d err=%v", value, next, err)
	}
	if _, _, err := postgresReadCString([]byte("broken"), 0); err == nil {
		t.Fatal("expected unterminated cstring error")
	}

	rowDescPayload := buildRowDescriptionPayload([]string{"id", "name"})
	columns, err := postgresParseRowDescription(rowDescPayload)
	if err != nil {
		t.Fatalf("parse row description failed: %v", err)
	}
	if len(columns) != 2 || columns[0] != "id" || columns[1] != "name" {
		t.Fatalf("unexpected parsed columns: %v", columns)
	}

	dataRowPayload := buildDataRowPayload([]string{"1", "Alice"})
	values, err := postgresParseDataRow(dataRowPayload)
	if err != nil {
		t.Fatalf("parse data row failed: %v", err)
	}
	if len(values) != 2 || values[0] != "1" || values[1] != "Alice" {
		t.Fatalf("unexpected parsed row values: %v", values)
	}

	errPayload := []byte{'C', '2', '3', '5', '0', '5', 0, 'M', 'u', 'n', 'i', 'q', 'u', 'e', 0, 0}
	if got := parsePostgresError(errPayload); !strings.Contains(got, "23505") || !strings.Contains(got, "unique") {
		t.Fatalf("unexpected postgres error parse result: %q", got)
	}

	md5Password := postgresMD5Password("kis", "secret", []byte{1, 2, 3, 4})
	if !strings.HasPrefix(md5Password, "md5") || len(md5Password) != 35 {
		t.Fatalf("unexpected postgres md5 password value: %q", md5Password)
	}

	attrs := parseSCRAMAttributes("r=abc,s=def,i=4096")
	if attrs["r"] != "abc" || attrs["s"] != "def" || attrs["i"] != "4096" {
		t.Fatalf("unexpected SCRAM attributes map: %+v", attrs)
	}

	expectedHMAC := hmac.New(sha256.New, []byte("k"))
	_, _ = expectedHMAC.Write([]byte("m"))
	if got := hmacSHA256([]byte("k"), []byte("m")); hex.EncodeToString(got) != hex.EncodeToString(expectedHMAC.Sum(nil)) {
		t.Fatalf("unexpected hmac result: %x", got)
	}

	xor := xorBytes([]byte{1, 2, 3}, []byte{3, 2, 1})
	if len(xor) != 3 || xor[0] != 2 || xor[1] != 0 || xor[2] != 2 {
		t.Fatalf("unexpected xor result: %v", xor)
	}
	if got := xorBytes([]byte{1}, []byte{1, 2}); got != nil {
		t.Fatalf("expected nil xor for mismatched lengths, got %v", got)
	}

	key := pbkdf2SHA256([]byte("password"), []byte("salt"), 2, 32)
	if len(key) != 32 {
		t.Fatalf("expected 32-byte PBKDF2 key, got %d", len(key))
	}

	client := newSCRAMClient("user", "pass")
	first := client.clientFirstMessage()
	if !strings.HasPrefix(first, "n,,n=user,r=") {
		t.Fatalf("unexpected SCRAM first message: %q", first)
	}
	if _, err := client.handleServerFirst("r=abc"); err == nil {
		t.Fatal("expected invalid server-first error")
	}
	if err := client.verifyServerFinal("e=auth-failed"); err == nil {
		t.Fatal("expected SCRAM server error")
	}
}

func TestPersistenceRuntime_DeliverOutboxAndWrapDisabled(t *testing.T) {
	event := outboxRecord{
		ID:            77,
		EventType:     "EventType",
		AggregateType: "order",
		AggregateID:   "ORD-1",
		Payload:       []byte(`{"k":"v"}`),
	}
	if err := persistenceDeliverOutboxEvent("pricing", event, nil); err != nil {
		t.Fatalf("expected nil delivery error for empty targets, got %v", err)
	}

	var gotPath string
	okServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusAccepted)
	}))
	defer okServer.Close()
	if err := persistenceDeliverOutboxEvent("pricing", event, []string{okServer.URL}); err != nil {
		t.Fatalf("expected delivery success, got %v", err)
	}
	if gotPath != "/internal/inbox/events" {
		t.Fatalf("unexpected outbox target path: %q", gotPath)
	}

	failServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer failServer.Close()
	if err := persistenceDeliverOutboxEvent("pricing", event, []string{failServer.URL}); err == nil {
		t.Fatal("expected delivery error for non-2xx response")
	}

	t.Setenv("PERSISTENCE_ENABLED", "false")
	nextCalled := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		respondJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	wrapped, err := WrapWithPersistence("pricing", next)
	if err != nil {
		t.Fatalf("WrapWithPersistence returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(`{"a":1}`))
	rr := httptest.NewRecorder()
	wrapped.ServeHTTP(rr, req)
	if !nextCalled {
		t.Fatal("expected wrapped handler to call next")
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 from wrapped handler, got %d", rr.Code)
	}
}

func TestPersistenceRuntime_PoolAcquireContextError(t *testing.T) {
	pool := newPGConnPool(pgConnConfig{
		Host:     "127.0.0.1",
		Port:     "65535",
		User:     "kis",
		Password: "kis",
		DBName:   "kis",
		SSLMode:  "disable",
		Timeout:  100 * time.Millisecond,
	})

	ctx, cancel := context.WithTimeout(context.Background(), time.Nanosecond)
	cancel()
	if _, err := pool.acquire(ctx); err == nil {
		t.Fatal("expected acquire error with canceled context")
	}
}

func buildRowDescriptionPayload(columns []string) []byte {
	payload := make([]byte, 0)
	payload = append(payload, byte(len(columns)>>8), byte(len(columns)))
	for _, column := range columns {
		payload = append(payload, []byte(column)...)
		payload = append(payload, 0)
		payload = append(payload, make([]byte, 18)...)
	}
	return payload
}

func buildDataRowPayload(values []string) []byte {
	payload := make([]byte, 0)
	payload = append(payload, byte(len(values)>>8), byte(len(values)))
	for _, value := range values {
		v := []byte(value)
		length := []byte{byte(len(v) >> 24), byte(len(v) >> 16), byte(len(v) >> 8), byte(len(v))}
		payload = append(payload, length...)
		payload = append(payload, v...)
	}
	return payload
}
