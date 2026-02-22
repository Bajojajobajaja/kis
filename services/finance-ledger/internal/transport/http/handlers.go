package httptransport

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

type account struct {
	Code      string    `json:"code"`
	Name      string    `json:"name"`
	Category  string    `json:"category"`
	IsActive  bool      `json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ledgerLine struct {
	AccountCode string  `json:"account_code"`
	Debit       float64 `json:"debit"`
	Credit      float64 `json:"credit"`
	CostCenter  string  `json:"cost_center,omitempty"`
	Subsystem   string  `json:"subsystem,omitempty"`
}

type ledgerEntry struct {
	ID          string       `json:"id"`
	Document    string       `json:"document"`
	SourceEvent string       `json:"source_event,omitempty"`
	Description string       `json:"description,omitempty"`
	Lines       []ledgerLine `json:"lines"`
	TotalDebit  float64      `json:"total_debit"`
	TotalCredit float64      `json:"total_credit"`
	PrevHash    string       `json:"prev_hash"`
	Hash        string       `json:"hash"`
	PostedAt    time.Time    `json:"posted_at"`
}

type journalRecord struct {
	ID        string         `json:"id"`
	Kind      string         `json:"kind"`
	EntityID  string         `json:"entity_id"`
	Payload   map[string]any `json:"payload"`
	CreatedAt time.Time      `json:"created_at"`
}

type ledgerEvent struct {
	ID          string         `json:"id"`
	EventType   string         `json:"event_type"`
	EventID     string         `json:"event_id"`
	Subsystem   string         `json:"subsystem"`
	Amount      float64        `json:"amount"`
	Document    string         `json:"document,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
	PostedEntry string         `json:"posted_entry,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
}

var ledgerStore = struct {
	sync.RWMutex
	accountSeq int
	entrySeq   int
	eventSeq   int
	journalSeq int
	lastHash   string
	accounts   []account
	entries    []ledgerEntry
	events     []ledgerEvent
	journal    []journalRecord
}{
	accounts: []account{
		{Code: "1000", Name: "Cash", Category: "asset", IsActive: true, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()},
		{Code: "1100", Name: "Accounts Receivable", Category: "asset", IsActive: true, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()},
		{Code: "1200", Name: "Inventory", Category: "asset", IsActive: true, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()},
		{Code: "2000", Name: "Accounts Payable", Category: "liability", IsActive: true, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()},
		{Code: "3000", Name: "Equity", Category: "equity", IsActive: true, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()},
		{Code: "4000", Name: "Sales Revenue", Category: "revenue", IsActive: true, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()},
		{Code: "4100", Name: "Service Revenue", Category: "revenue", IsActive: true, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()},
		{Code: "5000", Name: "Cost of Goods Sold", Category: "expense", IsActive: true, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()},
		{Code: "5100", Name: "Service Cost", Category: "expense", IsActive: true, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()},
		{Code: "5200", Name: "Inventory Adjustments", Category: "expense", IsActive: true, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()},
		{Code: "9999", Name: "Suspense", Category: "equity", IsActive: true, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()},
	},
}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)
	mux.HandleFunc("/ledger/accounts", accountsHandler)
	mux.HandleFunc("/ledger/entries", entriesHandler)
	mux.HandleFunc("/ledger/post", postEntryHandler)
	mux.HandleFunc("/ledger/post-from-event", postFromEventHandler)
	mux.HandleFunc("/ledger/journal", journalHandler)
	mux.HandleFunc("/events", ledgerEventsHandler)
}

func accountsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		categoryFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("category")))
		activeFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("active")))
		ledgerStore.RLock()
		defer ledgerStore.RUnlock()

		out := make([]account, 0, len(ledgerStore.accounts))
		for _, entity := range ledgerStore.accounts {
			if categoryFilter != "" && strings.ToLower(entity.Category) != categoryFilter {
				continue
			}
			if activeFilter == "true" && !entity.IsActive {
				continue
			}
			if activeFilter == "false" && entity.IsActive {
				continue
			}
			out = append(out, entity)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Code < out[j].Code })
		respondJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req struct {
			Code     string `json:"code"`
			Name     string `json:"name"`
			Category string `json:"category"`
		}
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		code := strings.TrimSpace(req.Code)
		name := strings.TrimSpace(req.Name)
		category := strings.ToLower(strings.TrimSpace(req.Category))
		if code == "" || name == "" {
			respondError(w, http.StatusBadRequest, "code and name are required")
			return
		}
		if !isAllowedAccountCategory(category) {
			respondError(w, http.StatusBadRequest, "unsupported account category")
			return
		}

		now := time.Now().UTC()
		ledgerStore.Lock()
		defer ledgerStore.Unlock()
		if findAccountIndexLocked(code) >= 0 {
			respondError(w, http.StatusConflict, "account already exists")
			return
		}
		ledgerStore.accountSeq++
		entity := account{
			Code:      code,
			Name:      name,
			Category:  category,
			IsActive:  true,
			CreatedAt: now,
			UpdatedAt: now,
		}
		ledgerStore.accounts = append(ledgerStore.accounts, entity)
		appendJournalLocked("account", entity.Code, map[string]any{"name": entity.Name, "category": entity.Category})
		respondJSON(w, http.StatusCreated, entity)
	default:
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func entriesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	ledgerStore.RLock()
	defer ledgerStore.RUnlock()

	documentFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("document")))
	eventFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("source_event")))
	accountFilter := strings.TrimSpace(r.URL.Query().Get("account_code"))
	out := make([]ledgerEntry, 0, len(ledgerStore.entries))
	for _, entity := range ledgerStore.entries {
		if documentFilter != "" && strings.ToLower(entity.Document) != documentFilter {
			continue
		}
		if eventFilter != "" && strings.ToLower(entity.SourceEvent) != eventFilter {
			continue
		}
		if accountFilter != "" && !entryContainsAccount(entity, accountFilter) {
			continue
		}
		out = append(out, entity)
	}
	respondJSON(w, http.StatusOK, out)
}

func postEntryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		Document    string `json:"document"`
		Description string `json:"description"`
		SourceEvent string `json:"source_event"`
		Lines       []struct {
			AccountCode string  `json:"account_code"`
			Debit       float64 `json:"debit"`
			Credit      float64 `json:"credit"`
			CostCenter  string  `json:"cost_center"`
			Subsystem   string  `json:"subsystem"`
		} `json:"lines"`
		Account   string  `json:"account"`
		Direction string  `json:"direction"`
		Amount    float64 `json:"amount"`
		Note      string  `json:"note"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	lines := make([]ledgerLine, 0, len(req.Lines))
	for _, line := range req.Lines {
		lines = append(lines, ledgerLine{
			AccountCode: strings.TrimSpace(line.AccountCode),
			Debit:       line.Debit,
			Credit:      line.Credit,
			CostCenter:  strings.TrimSpace(line.CostCenter),
			Subsystem:   strings.ToLower(strings.TrimSpace(line.Subsystem)),
		})
	}

	legacyDescription := strings.TrimSpace(req.Note)
	if len(lines) == 0 && strings.TrimSpace(req.Account) != "" && req.Amount > 0 {
		direction := strings.ToLower(strings.TrimSpace(req.Direction))
		if direction == "" {
			direction = "debit"
		}
		if direction != "debit" && direction != "credit" {
			respondError(w, http.StatusBadRequest, "direction must be debit or credit")
			return
		}
		if direction == "debit" {
			lines = append(lines, ledgerLine{AccountCode: strings.TrimSpace(req.Account), Debit: req.Amount})
			lines = append(lines, ledgerLine{AccountCode: "9999", Credit: req.Amount})
		} else {
			lines = append(lines, ledgerLine{AccountCode: strings.TrimSpace(req.Account), Credit: req.Amount})
			lines = append(lines, ledgerLine{AccountCode: "9999", Debit: req.Amount})
		}
	}

	if len(lines) == 0 {
		respondError(w, http.StatusBadRequest, "ledger lines are required")
		return
	}

	ledgerStore.Lock()
	defer ledgerStore.Unlock()
	entity, err := createEntryLocked(ledgerEntryInput{
		Document:    defaultValue(strings.TrimSpace(req.Document), "manual"),
		Description: defaultValue(strings.TrimSpace(req.Description), legacyDescription),
		SourceEvent: strings.TrimSpace(req.SourceEvent),
		Lines:       lines,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	respondJSON(w, http.StatusCreated, entity)
}

func postFromEventHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		EventType string         `json:"event_type"`
		EventID   string         `json:"event_id"`
		Subsystem string         `json:"subsystem"`
		Amount    float64        `json:"amount"`
		Document  string         `json:"document"`
		Metadata  map[string]any `json:"metadata"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.EventType) == "" || req.Amount <= 0 {
		respondError(w, http.StatusBadRequest, "event_type and positive amount are required")
		return
	}

	lines, description, err := linesFromDomainEvent(strings.ToLower(strings.TrimSpace(req.EventType)), req.Amount)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	ledgerStore.Lock()
	defer ledgerStore.Unlock()
	entry, err := createEntryLocked(ledgerEntryInput{
		Document:    defaultValue(strings.TrimSpace(req.Document), "event-post"),
		Description: description,
		SourceEvent: strings.TrimSpace(req.EventType),
		Lines:       lines,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	ledgerStore.eventSeq++
	event := ledgerEvent{
		ID:          fmt.Sprintf("lev-%05d", ledgerStore.eventSeq),
		EventType:   strings.TrimSpace(req.EventType),
		EventID:     strings.TrimSpace(req.EventID),
		Subsystem:   strings.TrimSpace(req.Subsystem),
		Amount:      round2(req.Amount),
		Document:    strings.TrimSpace(req.Document),
		Metadata:    req.Metadata,
		PostedEntry: entry.ID,
		CreatedAt:   time.Now().UTC(),
	}
	ledgerStore.events = append(ledgerStore.events, event)
	appendJournalLocked("event", event.ID, map[string]any{
		"event_type": event.EventType,
		"entry_id":   event.PostedEntry,
		"amount":     event.Amount,
	})
	respondJSON(w, http.StatusCreated, map[string]any{
		"event": event,
		"entry": entry,
	})
}

func journalHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	ledgerStore.RLock()
	defer ledgerStore.RUnlock()
	respondJSON(w, http.StatusOK, ledgerStore.journal)
}

func ledgerEventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	ledgerStore.RLock()
	defer ledgerStore.RUnlock()
	respondJSON(w, http.StatusOK, ledgerStore.events)
}

type ledgerEntryInput struct {
	Document    string
	Description string
	SourceEvent string
	Lines       []ledgerLine
}

func createEntryLocked(input ledgerEntryInput) (ledgerEntry, error) {
	if len(input.Lines) == 0 {
		return ledgerEntry{}, fmt.Errorf("at least one line is required")
	}
	totalDebit := 0.0
	totalCredit := 0.0
	for i := range input.Lines {
		line := &input.Lines[i]
		line.AccountCode = strings.TrimSpace(line.AccountCode)
		if line.AccountCode == "" {
			return ledgerEntry{}, fmt.Errorf("account_code is required for each line")
		}
		if line.Debit < 0 || line.Credit < 0 {
			return ledgerEntry{}, fmt.Errorf("debit and credit must be non-negative")
		}
		if (line.Debit == 0 && line.Credit == 0) || (line.Debit > 0 && line.Credit > 0) {
			return ledgerEntry{}, fmt.Errorf("line must contain only debit or credit amount")
		}
		accountIndex := findAccountIndexLocked(line.AccountCode)
		if accountIndex < 0 {
			return ledgerEntry{}, fmt.Errorf("unknown account %s", line.AccountCode)
		}
		if !ledgerStore.accounts[accountIndex].IsActive {
			return ledgerEntry{}, fmt.Errorf("account %s is inactive", line.AccountCode)
		}
		totalDebit += line.Debit
		totalCredit += line.Credit
	}
	totalDebit = round2(totalDebit)
	totalCredit = round2(totalCredit)
	if math.Abs(totalDebit-totalCredit) > 0.009 {
		return ledgerEntry{}, fmt.Errorf("entry is not balanced")
	}

	ledgerStore.entrySeq++
	now := time.Now().UTC()
	entryID := fmt.Sprintf("le-%05d", ledgerStore.entrySeq)
	hash := makeEntryHash(ledgerStore.lastHash, entryID, input.Document, now, input.Lines)
	entry := ledgerEntry{
		ID:          entryID,
		Document:    defaultValue(input.Document, "manual"),
		SourceEvent: strings.TrimSpace(input.SourceEvent),
		Description: strings.TrimSpace(input.Description),
		Lines:       input.Lines,
		TotalDebit:  totalDebit,
		TotalCredit: totalCredit,
		PrevHash:    ledgerStore.lastHash,
		Hash:        hash,
		PostedAt:    now,
	}
	ledgerStore.lastHash = hash
	ledgerStore.entries = append(ledgerStore.entries, entry)
	appendJournalLocked("entry", entry.ID, map[string]any{
		"document":     entry.Document,
		"source_event": entry.SourceEvent,
		"total_debit":  entry.TotalDebit,
		"total_credit": entry.TotalCredit,
		"hash":         entry.Hash,
		"prev_hash":    entry.PrevHash,
	})
	return entry, nil
}

func appendJournalLocked(kind, entityID string, payload map[string]any) {
	ledgerStore.journalSeq++
	ledgerStore.journal = append(ledgerStore.journal, journalRecord{
		ID:        fmt.Sprintf("jr-%05d", ledgerStore.journalSeq),
		Kind:      kind,
		EntityID:  entityID,
		Payload:   payload,
		CreatedAt: time.Now().UTC(),
	})
}

func makeEntryHash(prevHash, entryID, document string, postedAt time.Time, lines []ledgerLine) string {
	payload, _ := json.Marshal(lines)
	source := fmt.Sprintf("%s|%s|%s|%s|%s", prevHash, entryID, document, postedAt.Format(time.RFC3339Nano), string(payload))
	digest := sha256.Sum256([]byte(source))
	return hex.EncodeToString(digest[:])
}

func linesFromDomainEvent(eventType string, amount float64) ([]ledgerLine, string, error) {
	switch eventType {
	case "paymentreceived", "salepaid":
		return []ledgerLine{
			{AccountCode: "1000", Debit: amount, Subsystem: "sales"},
			{AccountCode: "4000", Credit: amount, Subsystem: "sales"},
		}, "Sales payment posted", nil
	case "servicepaid":
		return []ledgerLine{
			{AccountCode: "1000", Debit: amount, Subsystem: "service"},
			{AccountCode: "4100", Credit: amount, Subsystem: "service"},
		}, "Service payment posted", nil
	case "goodsreceived", "purchaseorderreceived":
		return []ledgerLine{
			{AccountCode: "1200", Debit: amount, Subsystem: "inventory"},
			{AccountCode: "2000", Credit: amount, Subsystem: "inventory"},
		}, "Inventory receipt posted", nil
	case "stockadjustedup":
		return []ledgerLine{
			{AccountCode: "1200", Debit: amount, Subsystem: "inventory"},
			{AccountCode: "5200", Credit: amount, Subsystem: "inventory"},
		}, "Inventory increase adjustment posted", nil
	case "stockadjusteddown":
		return []ledgerLine{
			{AccountCode: "5200", Debit: amount, Subsystem: "inventory"},
			{AccountCode: "1200", Credit: amount, Subsystem: "inventory"},
		}, "Inventory decrease adjustment posted", nil
	case "costrecognized":
		return []ledgerLine{
			{AccountCode: "5000", Debit: amount, Subsystem: "finance"},
			{AccountCode: "1200", Credit: amount, Subsystem: "finance"},
		}, "Cost recognized", nil
	default:
		return nil, "", fmt.Errorf("unsupported event_type")
	}
}

func entryContainsAccount(entry ledgerEntry, accountCode string) bool {
	for _, line := range entry.Lines {
		if line.AccountCode == accountCode {
			return true
		}
	}
	return false
}

func findAccountIndexLocked(code string) int {
	for i := range ledgerStore.accounts {
		if ledgerStore.accounts[i].Code == code {
			return i
		}
	}
	return -1
}

func isAllowedAccountCategory(category string) bool {
	switch category {
	case "asset", "liability", "equity", "revenue", "expense":
		return true
	default:
		return false
	}
}

func round2(value float64) float64 {
	return math.Round(value*100) / 100
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "finance-ledger",
		"status":  "ok",
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "finance-ledger",
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

func defaultValue(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}
