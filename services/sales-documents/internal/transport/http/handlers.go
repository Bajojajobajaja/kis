package httptransport

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

type template struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

type document struct {
	ID               string    `json:"id"`
	TemplateID       string    `json:"template_id"`
	Type             string    `json:"type"`
	DealID           string    `json:"deal_id"`
	ClientID         string    `json:"client_id,omitempty"`
	SourceDocumentID string    `json:"source_document_id,omitempty"`
	Number           string    `json:"number"`
	Total            float64   `json:"total"`
	Status           string    `json:"status"`
	FileName         string    `json:"file_name,omitempty"`
	ContentType      string    `json:"content_type,omitempty"`
	DownloadURL      string    `json:"download_url,omitempty"`
	GeneratedAt      time.Time `json:"generated_at,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	FileDataBase64   string    `json:"-"`
}

type salesDocEvent struct {
	ID        string         `json:"id"`
	EventType string         `json:"event_type"`
	Document  string         `json:"document_id"`
	DealID    string         `json:"deal_id"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

type generateDocumentRequest struct {
	TemplateID       string  `json:"template_id"`
	DealID           string  `json:"deal_id"`
	ClientID         string  `json:"client_id"`
	SourceDocumentID string  `json:"source_document_id"`
	DocumentNumber   string  `json:"document_number"`
	DocumentDate     string  `json:"document_date"`
	Responsible      string  `json:"responsible"`
	BuyerName        string  `json:"buyer_name"`
	VehicleTitle     string  `json:"vehicle_title"`
	VehicleVIN       string  `json:"vehicle_vin"`
	VehicleBrand     string  `json:"vehicle_brand"`
	VehicleModel     string  `json:"vehicle_model"`
	VehicleYear      string  `json:"vehicle_year"`
	VehicleColor     string  `json:"vehicle_color"`
	VehiclePrice     string  `json:"vehicle_price"`
	Total            float64 `json:"total"`
}

var salesDocsStore = struct {
	sync.RWMutex
	seq       int
	eventSeq  int
	templates []template
	documents []document
	events    []salesDocEvent
}{
	templates: []template{
		{ID: "tpl-contract", Name: "Sales Contract", Type: "contract"},
		{ID: "tpl-invoice", Name: "Sales Invoice", Type: "invoice"},
		{ID: "tpl-transfer", Name: "Transfer Act", Type: "transfer_act"},
		{ID: "tpl-receipt", Name: "Payment Receipt", Type: "receipt"},
	},
}

func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/readyz", readyHandler)

	mux.HandleFunc("/documents/templates", templatesHandler)
	mux.HandleFunc("/documents/generate", generateDocumentHandler)
	mux.HandleFunc("/documents/", documentByIDHandler)
	mux.HandleFunc("/documents", documentsHandler)
	mux.HandleFunc("/events", documentEventsHandler)
}

func templatesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	salesDocsStore.RLock()
	defer salesDocsStore.RUnlock()
	respondJSON(w, http.StatusOK, salesDocsStore.templates)
}

func documentsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	salesDocsStore.RLock()
	defer salesDocsStore.RUnlock()

	dealIDFilter := strings.TrimSpace(r.URL.Query().Get("deal_id"))
	if dealIDFilter == "" {
		respondJSON(w, http.StatusOK, salesDocsStore.documents)
		return
	}

	filtered := make([]document, 0)
	for _, entity := range salesDocsStore.documents {
		if entity.DealID == dealIDFilter {
			filtered = append(filtered, entity)
		}
	}
	respondJSON(w, http.StatusOK, filtered)
}

func generateDocumentHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req generateDocumentRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.TemplateID == "" || req.DealID == "" {
		respondError(w, http.StatusBadRequest, "template_id and deal_id are required")
		return
	}
	if req.Total < 0 {
		respondError(w, http.StatusBadRequest, "total must be non-negative")
		return
	}

	salesDocsStore.Lock()
	defer salesDocsStore.Unlock()

	tpl, ok := findTemplate(req.TemplateID)
	if !ok {
		respondError(w, http.StatusBadRequest, "unknown template_id")
		return
	}

	now := time.Now().UTC()
	documentIndex := findDocumentIndexBySourceDocumentID(req.SourceDocumentID, req.TemplateID)
	var entity document
	if documentIndex >= 0 {
		entity = salesDocsStore.documents[documentIndex]
	} else {
		salesDocsStore.seq++
		entity = document{
			ID:        fmt.Sprintf("doc-%04d", salesDocsStore.seq),
			CreatedAt: now,
		}
	}

	entity.TemplateID = req.TemplateID
	entity.Type = tpl.Type
	entity.DealID = req.DealID
	entity.ClientID = strings.TrimSpace(req.ClientID)
	entity.SourceDocumentID = strings.TrimSpace(req.SourceDocumentID)
	entity.Number = resolveDocumentNumber(entity, tpl.Type, req)
	entity.Total = req.Total
	entity.Status = "issued"

	if tpl.Type == "contract" {
		if strings.TrimSpace(req.BuyerName) == "" {
			respondError(w, http.StatusBadRequest, "buyer_name is required for contract pdf")
			return
		}
		if strings.TrimSpace(req.VehicleTitle) == "" && strings.TrimSpace(req.VehicleVIN) == "" {
			respondError(w, http.StatusBadRequest, "vehicle data is required for contract pdf")
			return
		}

		pdfData, err := buildSalesContractPDF(salesContractPDFData{
			DocumentNumber: entity.Number,
			DocumentDate:   strings.TrimSpace(req.DocumentDate),
			Responsible:    strings.TrimSpace(req.Responsible),
			BuyerName:      strings.TrimSpace(req.BuyerName),
			VehicleTitle:   strings.TrimSpace(req.VehicleTitle),
			VehicleVIN:     strings.TrimSpace(req.VehicleVIN),
			VehicleBrand:   strings.TrimSpace(req.VehicleBrand),
			VehicleModel:   strings.TrimSpace(req.VehicleModel),
			VehicleYear:    strings.TrimSpace(req.VehicleYear),
			VehicleColor:   strings.TrimSpace(req.VehicleColor),
			VehiclePrice:   strings.TrimSpace(req.VehiclePrice),
			Total:          req.Total,
		})
		if err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}

		entity.FileName = buildDocumentFileName(entity.Number)
		entity.ContentType = "application/pdf"
		entity.DownloadURL = buildDocumentDownloadURL(entity.ID)
		entity.GeneratedAt = now
		entity.FileDataBase64 = base64.StdEncoding.EncodeToString(pdfData)
	}

	if documentIndex >= 0 {
		salesDocsStore.documents[documentIndex] = entity
	} else {
		salesDocsStore.documents = append(salesDocsStore.documents, entity)
	}
	appendDocumentEvent(eventFromDocType(entity.Type), entity)

	respondJSON(w, http.StatusCreated, entity)
}

func documentByIDHandler(w http.ResponseWriter, r *http.Request) {
	path := strings.Trim(r.URL.Path, "/")
	parts := strings.Split(path, "/")
	if len(parts) != 3 || parts[0] != "documents" || parts[2] != "download" {
		respondError(w, http.StatusNotFound, "route not found")
		return
	}

	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	documentID := strings.TrimSpace(parts[1])
	if documentID == "" {
		respondError(w, http.StatusBadRequest, "document id is required")
		return
	}

	salesDocsStore.RLock()
	index := findDocumentIndexLocked(documentID)
	if index < 0 {
		salesDocsStore.RUnlock()
		respondError(w, http.StatusNotFound, "document not found")
		return
	}
	entity := salesDocsStore.documents[index]
	salesDocsStore.RUnlock()

	if strings.TrimSpace(entity.FileDataBase64) == "" {
		respondError(w, http.StatusNotFound, "document file is not available")
		return
	}

	payload, err := base64.StdEncoding.DecodeString(strings.TrimSpace(entity.FileDataBase64))
	if err != nil {
		respondError(w, http.StatusInternalServerError, "document payload is corrupted")
		return
	}

	contentType := strings.TrimSpace(entity.ContentType)
	if contentType == "" {
		contentType = "application/pdf"
	}
	fileName := strings.TrimSpace(entity.FileName)
	if fileName == "" {
		fileName = buildDocumentFileName(entity.Number)
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", fileName))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(payload)
}

func documentEventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	salesDocsStore.RLock()
	defer salesDocsStore.RUnlock()

	eventTypeFilter := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("event_type")))
	if eventTypeFilter == "" {
		respondJSON(w, http.StatusOK, salesDocsStore.events)
		return
	}

	filtered := make([]salesDocEvent, 0)
	for _, event := range salesDocsStore.events {
		if strings.ToLower(event.EventType) == eventTypeFilter {
			filtered = append(filtered, event)
		}
	}
	respondJSON(w, http.StatusOK, filtered)
}

func findTemplate(id string) (template, bool) {
	for _, tpl := range salesDocsStore.templates {
		if tpl.ID == id {
			return tpl, true
		}
	}
	return template{}, false
}

func findDocumentIndexBySourceDocumentID(sourceDocumentID, templateID string) int {
	if strings.TrimSpace(sourceDocumentID) == "" {
		return -1
	}
	for index, entity := range salesDocsStore.documents {
		if entity.SourceDocumentID == sourceDocumentID && entity.TemplateID == templateID {
			return index
		}
	}
	return -1
}

func findDocumentIndexLocked(documentID string) int {
	for index, entity := range salesDocsStore.documents {
		if entity.ID == documentID {
			return index
		}
	}
	return -1
}

func resolveDocumentNumber(entity document, docType string, req generateDocumentRequest) string {
	documentNumber := strings.TrimSpace(req.DocumentNumber)
	if documentNumber != "" {
		return documentNumber
	}
	if strings.TrimSpace(entity.Number) != "" {
		return entity.Number
	}
	return nextDocumentNumber(docType, salesDocsStore.seq)
}

func buildDocumentDownloadURL(documentID string) string {
	return fmt.Sprintf("/documents/%s/download", documentID)
}

func buildDocumentFileName(number string) string {
	sanitized := strings.TrimSpace(number)
	if sanitized == "" {
		sanitized = "sales-contract"
	}
	replacer := strings.NewReplacer(" ", "-", "/", "-", "\\", "-", ":", "-", "\"", "")
	return fmt.Sprintf("%s.pdf", replacer.Replace(sanitized))
}

func appendDocumentEvent(eventType string, entity document) {
	salesDocsStore.eventSeq++
	salesDocsStore.events = append(salesDocsStore.events, salesDocEvent{
		ID:        fmt.Sprintf("sde-%05d", salesDocsStore.eventSeq),
		EventType: eventType,
		Document:  entity.ID,
		DealID:    entity.DealID,
		Payload: map[string]any{
			"number":             entity.Number,
			"type":               entity.Type,
			"total":              entity.Total,
			"source_document_id": entity.SourceDocumentID,
			"file_name":          entity.FileName,
		},
		CreatedAt: time.Now().UTC(),
	})
}

func nextDocumentNumber(docType string, seq int) string {
	prefix := "SD"
	switch docType {
	case "contract":
		prefix = "CTR"
	case "invoice":
		prefix = "INV"
	case "transfer_act":
		prefix = "ACT"
	case "receipt":
		prefix = "RCP"
	}
	return fmt.Sprintf("%s-%06d", prefix, seq)
}

func eventFromDocType(docType string) string {
	switch docType {
	case "contract":
		return "ContractIssued"
	case "invoice":
		return "InvoiceIssued"
	case "transfer_act":
		return "TransferActIssued"
	case "receipt":
		return "ReceiptIssued"
	default:
		return "DocumentIssued"
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "sales-documents",
		"status":  "ok",
	})
}

func readyHandler(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{
		"service": "sales-documents",
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
