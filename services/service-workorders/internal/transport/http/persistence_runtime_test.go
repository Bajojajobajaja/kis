package httptransport

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"
)

func TestReserveIdempotencyConcurrentIdenticalRequest(t *testing.T) {
	backend, err := newPersistenceBackend("service-workorders")
	if err != nil {
		t.Skipf("persistence backend unavailable: %v", err)
	}
	if err := backend.ensureSchema(); err != nil {
		t.Skipf("persistence schema unavailable: %v", err)
	}

	idKey := fmt.Sprintf("test-idempotency-%d", time.Now().UnixNano())
	requestHash := fmt.Sprintf("hash-%d", time.Now().UnixNano())
	cleanupSQL := "DELETE FROM kis_http_idempotency WHERE service=" +
		persistenceSQLQuote(backend.service) +
		" AND idempotency_key=" + persistenceSQLQuote(idKey) + ";"
	_, _ = backend.runPSQL(cleanupSQL, false)
	t.Cleanup(func() {
		_, _ = backend.runPSQL(cleanupSQL, false)
	})

	const workers = 12
	results := make(chan idempotencyDecision, workers)
	errs := make(chan error, workers)

	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			decision, reserveErr := backend.reserveIdempotency(
				idKey,
				requestHash,
				http.MethodPut,
				"/workorders/WO-IDEM-TEST",
				45*time.Second,
			)
			if reserveErr != nil {
				errs <- reserveErr
				return
			}
			results <- decision
		}()
	}
	wg.Wait()
	close(results)
	close(errs)

	for reserveErr := range errs {
		t.Fatalf("expected no reserve errors, got %v", reserveErr)
	}

	proceedCount := 0
	conflictCount := 0
	for decision := range results {
		switch decision.Action {
		case "proceed":
			proceedCount++
		case "conflict":
			conflictCount++
		default:
			t.Fatalf("unexpected idempotency action %q", decision.Action)
		}
	}

	if proceedCount != 1 {
		t.Fatalf("expected exactly one proceed decision, got %d", proceedCount)
	}
	if conflictCount != workers-1 {
		t.Fatalf("expected %d conflict decisions, got %d", workers-1, conflictCount)
	}
}
