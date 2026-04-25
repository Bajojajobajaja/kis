package httptransport

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/go-pdf/fpdf"
)

const defaultFinanceInvoicingBaseURL = "http://localhost:19086"

type reportSummary struct {
	IncomingIssuedTotal     float64 `json:"incoming_issued_total"`
	IncomingPaidTotal       float64 `json:"incoming_paid_total"`
	OutgoingIssuedTotal     float64 `json:"outgoing_issued_total"`
	OutgoingPaidTotal       float64 `json:"outgoing_paid_total"`
	OpenInvoiceTotal        float64 `json:"open_invoice_total"`
	ReconciledPaymentsTotal float64 `json:"reconciled_payments_total"`
	InvoiceCount            int     `json:"invoice_count"`
	PaymentCount            int     `json:"payment_count"`
}

type reportExportResponse struct {
	ID          string         `json:"id"`
	Report      string         `json:"report"`
	Format      string         `json:"format"`
	Status      string         `json:"status"`
	ScheduleID  string         `json:"schedule_id,omitempty"`
	Owner       string         `json:"owner,omitempty"`
	Period      string         `json:"period,omitempty"`
	PeriodFrom  string         `json:"period_from,omitempty"`
	PeriodTo    string         `json:"period_to,omitempty"`
	FileName    string         `json:"file_name,omitempty"`
	ContentType string         `json:"content_type,omitempty"`
	DownloadURL string         `json:"download_url,omitempty"`
	Summary     *reportSummary `json:"summary,omitempty"`
	GeneratedAt time.Time      `json:"generated_at,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
}

type reportExportRequest struct {
	Report     string `json:"report"`
	Format     string `json:"format"`
	ScheduleID string `json:"schedule_id"`
	Owner      string `json:"owner"`
	Period     string `json:"period"`
	PeriodFrom string `json:"period_from"`
	PeriodTo   string `json:"period_to"`
}

type financeInvoicingInvoice struct {
	ID         string    `json:"id"`
	Number     string    `json:"number"`
	Subject    string    `json:"subject"`
	PartyID    string    `json:"party_id"`
	PartyName  string    `json:"party_name"`
	Kind       string    `json:"kind"`
	Amount     float64   `json:"amount"`
	PaidAmount float64   `json:"paid_amount"`
	Currency   string    `json:"currency"`
	DueDate    string    `json:"due_date"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type financeInvoicingPayment struct {
	ID        string    `json:"id"`
	InvoiceID string    `json:"invoice_id"`
	Amount    float64   `json:"amount"`
	Method    string    `json:"method"`
	Note      string    `json:"note"`
	PaidAt    time.Time `json:"paid_at"`
	CreatedAt time.Time `json:"created_at"`
}

type financeReportPeriod struct {
	Raw   string
	Start time.Time
	End   time.Time
}

type arapReportData struct {
	Owner    string
	Period   financeReportPeriod
	Invoices []financeInvoicingInvoice
	Payments []financeInvoicingPayment
	Summary  *reportSummary
}

func buildLegacyReportExport(id string, req reportExportRequest, createdAt time.Time) reportExport {
	return reportExport{
		ID:         id,
		Report:     req.Report,
		Format:     req.Format,
		Status:     "ready",
		ScheduleID: req.ScheduleID,
		Owner:      req.Owner,
		Period:     req.Period,
		PeriodFrom: req.PeriodFrom,
		PeriodTo:   req.PeriodTo,
		CreatedAt:  createdAt,
	}
}

func buildPDFReportExport(
	id string,
	req reportExportRequest,
	period financeReportPeriod,
	summary *reportSummary,
	createdAt time.Time,
	fileName string,
	fileData []byte,
) reportExport {
	return reportExport{
		ID:             id,
		Report:         req.Report,
		Format:         req.Format,
		Status:         "ready",
		ScheduleID:     req.ScheduleID,
		Owner:          req.Owner,
		Period:         period.Raw,
		PeriodFrom:     period.Start.Format("2006-01-02"),
		PeriodTo:       period.End.Format("2006-01-02"),
		FileName:       fileName,
		ContentType:    "application/pdf",
		DownloadURL:    buildReportDownloadURL(id),
		FileDataBase64: base64.StdEncoding.EncodeToString(fileData),
		Summary:        summary,
		GeneratedAt:    createdAt,
		CreatedAt:      createdAt,
	}
}

func buildReportExportResponse(entity reportExport) reportExportResponse {
	return reportExportResponse{
		ID:          entity.ID,
		Report:      entity.Report,
		Format:      entity.Format,
		Status:      entity.Status,
		ScheduleID:  entity.ScheduleID,
		Owner:       entity.Owner,
		Period:      entity.Period,
		PeriodFrom:  entity.PeriodFrom,
		PeriodTo:    entity.PeriodTo,
		FileName:    entity.FileName,
		ContentType: entity.ContentType,
		DownloadURL: entity.DownloadURL,
		Summary:     entity.Summary,
		GeneratedAt: entity.GeneratedAt,
		CreatedAt:   entity.CreatedAt,
	}
}

func buildReportExportResponses(entities []reportExport) []reportExportResponse {
	out := make([]reportExportResponse, 0, len(entities))
	for _, entity := range entities {
		out = append(out, buildReportExportResponse(entity))
	}
	return out
}

func buildReportDownloadURL(exportID string) string {
	return fmt.Sprintf("/reports/exports/%s/download", exportID)
}

func decodeReportExportPayload(raw string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(strings.TrimSpace(raw))
}

func parseFinanceReportPeriod(raw string) (financeReportPeriod, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return financeReportPeriod{}, fmt.Errorf("period is required")
	}

	parsed, err := time.Parse("01.2006", trimmed)
	if err != nil {
		return financeReportPeriod{}, fmt.Errorf("period must be in MM.YYYY format")
	}

	start := time.Date(parsed.Year(), parsed.Month(), 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 1, 0).Add(-time.Nanosecond)
	return financeReportPeriod{
		Raw:   trimmed,
		Start: start,
		End:   end,
	}, nil
}

func loadARAPReportData(period financeReportPeriod, owner string) (arapReportData, error) {
	invoices, err := fetchFinanceInvoicingInvoices()
	if err != nil {
		return arapReportData{}, err
	}

	payments, err := fetchFinanceInvoicingPayments()
	if err != nil {
		return arapReportData{}, err
	}

	invoiceByID := make(map[string]financeInvoicingInvoice, len(invoices))
	paymentsByInvoiceID := make(map[string][]financeInvoicingPayment)
	periodInvoices := make([]financeInvoicingInvoice, 0)
	periodPayments := make([]financeInvoicingPayment, 0)
	summary := &reportSummary{}

	for _, invoice := range invoices {
		invoiceByID[invoice.ID] = invoice
		if isTimeWithinPeriod(invoice.CreatedAt, period) {
			periodInvoices = append(periodInvoices, invoice)
			summary.InvoiceCount++
			switch normalizeInvoiceKind(invoice.Kind) {
			case "ar":
				summary.IncomingIssuedTotal += invoice.Amount
			case "ap":
				summary.OutgoingIssuedTotal += invoice.Amount
			}
		}
	}

	for _, payment := range payments {
		paymentsByInvoiceID[payment.InvoiceID] = append(paymentsByInvoiceID[payment.InvoiceID], payment)
		if isTimeWithinPeriod(effectivePaymentTime(payment), period) {
			periodPayments = append(periodPayments, payment)
			summary.PaymentCount++
			summary.ReconciledPaymentsTotal += payment.Amount
			invoice, ok := invoiceByID[payment.InvoiceID]
			if !ok {
				continue
			}
			switch normalizeInvoiceKind(invoice.Kind) {
			case "ar":
				summary.IncomingPaidTotal += payment.Amount
			case "ap":
				summary.OutgoingPaidTotal += payment.Amount
			}
		}
	}

	for _, invoice := range invoices {
		if strings.EqualFold(strings.TrimSpace(invoice.Status), "cancelled") {
			continue
		}
		if invoice.CreatedAt.After(period.End) {
			continue
		}

		paidToDate := 0.0
		for _, payment := range paymentsByInvoiceID[invoice.ID] {
			if effectivePaymentTime(payment).After(period.End) {
				continue
			}
			paidToDate += payment.Amount
		}
		summary.OpenInvoiceTotal += maxFloat64(0, invoice.Amount-paidToDate)
	}

	sort.Slice(periodInvoices, func(i, j int) bool {
		return periodInvoices[i].CreatedAt.Before(periodInvoices[j].CreatedAt)
	})
	sort.Slice(periodPayments, func(i, j int) bool {
		return effectivePaymentTime(periodPayments[i]).Before(effectivePaymentTime(periodPayments[j]))
	})

	summary.IncomingIssuedTotal = round2(summary.IncomingIssuedTotal)
	summary.IncomingPaidTotal = round2(summary.IncomingPaidTotal)
	summary.OutgoingIssuedTotal = round2(summary.OutgoingIssuedTotal)
	summary.OutgoingPaidTotal = round2(summary.OutgoingPaidTotal)
	summary.OpenInvoiceTotal = round2(summary.OpenInvoiceTotal)
	summary.ReconciledPaymentsTotal = round2(summary.ReconciledPaymentsTotal)

	return arapReportData{
		Owner:    strings.TrimSpace(owner),
		Period:   period,
		Invoices: periodInvoices,
		Payments: periodPayments,
		Summary:  summary,
	}, nil
}

func renderARAPReportPDF(
	exportID string,
	data arapReportData,
	generatedAt time.Time,
) ([]byte, string, error) {
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(12, 12, 12)
	pdf.SetAutoPageBreak(true, 12)
	pdf.AddPage()

	renderReportHeader(pdf, exportID, data, generatedAt)
	renderSummarySection(pdf, data.Summary)
	renderInvoicesSection(pdf, data.Invoices)
	renderPaymentsSection(pdf, data.Payments)

	var buffer bytes.Buffer
	if err := pdf.Output(&buffer); err != nil {
		return nil, "", fmt.Errorf("render pdf output: %w", err)
	}

	fileName := fmt.Sprintf("finance-report-%s-%s-%s.pdf", data.Period.Raw[:2], data.Period.Raw[3:], exportID)
	fileName = strings.ReplaceAll(fileName, ".", "-")
	return buffer.Bytes(), fileName, nil
}

func renderReportHeader(
	pdf *fpdf.Fpdf,
	exportID string,
	data arapReportData,
	generatedAt time.Time,
) {
	pdf.SetFont("Helvetica", "B", 16)
	pdf.CellFormat(0, 8, asciiReportText("Finance AR/AP Report"), "", 1, "L", false, 0, "")
	pdf.SetFont("Helvetica", "", 10)
	headerRows := []string{
		fmt.Sprintf("Report type: %s", asciiReportText("AR/AP")),
		fmt.Sprintf("Period: %s", data.Period.Raw),
		fmt.Sprintf("Owner: %s", defaultValue(asciiReportText(data.Owner), "n/a")),
		fmt.Sprintf("Export ID: %s", exportID),
		fmt.Sprintf("Generated at: %s", generatedAt.Format(time.RFC3339)),
	}
	for _, row := range headerRows {
		pdf.CellFormat(0, 5, row, "", 1, "L", false, 0, "")
	}
	pdf.Ln(2)
}

func renderSummarySection(pdf *fpdf.Fpdf, summary *reportSummary) {
	if summary == nil {
		return
	}

	renderSectionTitle(pdf, "Summary")
	rows := []struct {
		Label string
		Value string
	}{
		{Label: "Incoming issued total", Value: formatPDFMoney(summary.IncomingIssuedTotal)},
		{Label: "Incoming paid total", Value: formatPDFMoney(summary.IncomingPaidTotal)},
		{Label: "Outgoing issued total", Value: formatPDFMoney(summary.OutgoingIssuedTotal)},
		{Label: "Outgoing paid total", Value: formatPDFMoney(summary.OutgoingPaidTotal)},
		{Label: "Open invoice total", Value: formatPDFMoney(summary.OpenInvoiceTotal)},
		{Label: "Reconciled payments total", Value: formatPDFMoney(summary.ReconciledPaymentsTotal)},
		{Label: "Invoice count", Value: fmt.Sprintf("%d", summary.InvoiceCount)},
		{Label: "Payment count", Value: fmt.Sprintf("%d", summary.PaymentCount)},
	}

	pdf.SetFont("Helvetica", "", 9)
	for _, row := range rows {
		pdf.CellFormat(90, 6, row.Label, "1", 0, "L", false, 0, "")
		pdf.CellFormat(0, 6, row.Value, "1", 1, "R", false, 0, "")
	}
	pdf.Ln(3)
}

func renderInvoicesSection(pdf *fpdf.Fpdf, invoices []financeInvoicingInvoice) {
	renderSectionTitle(pdf, "Invoices")
	if len(invoices) == 0 {
		pdf.SetFont("Helvetica", "", 9)
		pdf.CellFormat(0, 6, "No invoices found for the selected period.", "1", 1, "L", false, 0, "")
		pdf.Ln(3)
		return
	}

	headers := []string{"Number", "Kind", "Status", "Party", "Amount", "Balance", "Created"}
	widths := []float64{24, 16, 20, 46, 22, 22, 26}
	renderTableHeader(pdf, headers, widths)

	for _, invoice := range invoices {
		row := []string{
			asciiReportText(defaultValue(invoice.Number, invoice.ID)),
			strings.ToUpper(normalizeInvoiceKind(invoice.Kind)),
			asciiReportText(defaultValue(invoice.Status, "unknown")),
			asciiReportText(defaultValue(invoice.PartyName, invoice.PartyID)),
			formatPDFMoney(invoice.Amount),
			formatPDFMoney(maxFloat64(0, invoice.Amount-invoice.PaidAmount)),
			invoice.CreatedAt.Format("2006-01-02"),
		}
		renderTableRow(pdf, row, widths)
	}
	pdf.Ln(3)
}

func renderPaymentsSection(pdf *fpdf.Fpdf, payments []financeInvoicingPayment) {
	renderSectionTitle(pdf, "Payments")
	if len(payments) == 0 {
		pdf.SetFont("Helvetica", "", 9)
		pdf.CellFormat(0, 6, "No payments found for the selected period.", "1", 1, "L", false, 0, "")
		pdf.Ln(3)
		return
	}

	headers := []string{"Payment", "Invoice", "Method", "Note", "Amount", "Paid"}
	widths := []float64{24, 28, 28, 54, 24, 26}
	renderTableHeader(pdf, headers, widths)

	for _, payment := range payments {
		row := []string{
			asciiReportText(payment.ID),
			asciiReportText(payment.InvoiceID),
			asciiReportText(defaultValue(payment.Method, "n/a")),
			asciiReportText(defaultValue(payment.Note, "-")),
			formatPDFMoney(payment.Amount),
			effectivePaymentTime(payment).Format("2006-01-02"),
		}
		renderTableRow(pdf, row, widths)
	}
	pdf.Ln(3)
}

func renderSectionTitle(pdf *fpdf.Fpdf, title string) {
	pdf.SetFont("Helvetica", "B", 12)
	pdf.CellFormat(0, 7, asciiReportText(title), "", 1, "L", false, 0, "")
	pdf.SetFont("Helvetica", "", 9)
}

func renderTableHeader(pdf *fpdf.Fpdf, headers []string, widths []float64) {
	pdf.SetFont("Helvetica", "B", 8)
	for index, header := range headers {
		pdf.CellFormat(widths[index], 6, asciiReportText(header), "1", 0, "L", false, 0, "")
	}
	pdf.Ln(-1)
	pdf.SetFont("Helvetica", "", 8)
}

func renderTableRow(pdf *fpdf.Fpdf, values []string, widths []float64) {
	for index, value := range values {
		align := "L"
		if index == len(values)-1 || strings.Contains(values[index], ".") && index >= len(values)-2 {
			align = "R"
		}
		pdf.CellFormat(widths[index], 6, truncatePDFCell(value, widths[index]), "1", 0, align, false, 0, "")
	}
	pdf.Ln(-1)
}

func truncatePDFCell(value string, width float64) string {
	limit := int(width * 0.8)
	if limit < 4 {
		limit = 4
	}
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= limit {
		return string(runes)
	}
	return string(runes[:limit-3]) + "..."
}

func formatPDFMoney(value float64) string {
	return fmt.Sprintf("%.2f", round2(value))
}

func fetchFinanceInvoicingInvoices() ([]financeInvoicingInvoice, error) {
	return fetchReportingJSON[[]financeInvoicingInvoice](financeInvoicingBaseURL() + "/invoices")
}

func fetchFinanceInvoicingPayments() ([]financeInvoicingPayment, error) {
	return fetchReportingJSON[[]financeInvoicingPayment](financeInvoicingBaseURL() + "/payments")
}

func financeInvoicingBaseURL() string {
	return strings.TrimRight(strings.TrimSpace(defaultValue(os.Getenv("FINANCE_INVOICING_BASE_URL"), defaultFinanceInvoicingBaseURL)), "/")
}

func fetchReportingJSON[T any](requestURL string) (T, error) {
	var zero T

	request, err := http.NewRequest(http.MethodGet, requestURL, nil)
	if err != nil {
		return zero, fmt.Errorf("build upstream request: %w", err)
	}
	request.Header.Set("Accept", "application/json")

	response, err := (&http.Client{Timeout: 15 * time.Second}).Do(request)
	if err != nil {
		return zero, fmt.Errorf("request upstream data: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		message := strings.TrimSpace(string(body))
		if message == "" {
			message = response.Status
		}
		return zero, fmt.Errorf("upstream %s returned %d: %s", requestURL, response.StatusCode, message)
	}

	var payload T
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return zero, fmt.Errorf("decode upstream response: %w", err)
	}
	return payload, nil
}

func normalizeInvoiceKind(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func effectivePaymentTime(payment financeInvoicingPayment) time.Time {
	if !payment.PaidAt.IsZero() {
		return payment.PaidAt
	}
	return payment.CreatedAt
}

func isTimeWithinPeriod(value time.Time, period financeReportPeriod) bool {
	if value.IsZero() {
		return false
	}
	return !value.Before(period.Start) && !value.After(period.End)
}

func maxFloat64(left, right float64) float64 {
	if left > right {
		return left
	}
	return right
}

func asciiReportText(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	var builder strings.Builder
	for _, char := range value {
		if char >= 32 && char <= 126 {
			builder.WriteRune(char)
			continue
		}
		if mapped, ok := transliteratedRunes[char]; ok {
			builder.WriteString(mapped)
			continue
		}
		switch char {
		case '–', '—':
			builder.WriteString("-")
		case '“', '”', '«', '»':
			builder.WriteString("\"")
		case '’':
			builder.WriteString("'")
		case '\n', '\r', '\t':
			builder.WriteString(" ")
		default:
			builder.WriteString("?")
		}
	}
	return strings.Join(strings.Fields(builder.String()), " ")
}

var transliteratedRunes = map[rune]string{
	'А': "A", 'а': "a",
	'Б': "B", 'б': "b",
	'В': "V", 'в': "v",
	'Г': "G", 'г': "g",
	'Д': "D", 'д': "d",
	'Е': "E", 'е': "e",
	'Ё': "E", 'ё': "e",
	'Ж': "Zh", 'ж': "zh",
	'З': "Z", 'з': "z",
	'И': "I", 'и': "i",
	'Й': "Y", 'й': "y",
	'К': "K", 'к': "k",
	'Л': "L", 'л': "l",
	'М': "M", 'м': "m",
	'Н': "N", 'н': "n",
	'О': "O", 'о': "o",
	'П': "P", 'п': "p",
	'Р': "R", 'р': "r",
	'С': "S", 'с': "s",
	'Т': "T", 'т': "t",
	'У': "U", 'у': "u",
	'Ф': "F", 'ф': "f",
	'Х': "Kh", 'х': "kh",
	'Ц': "Ts", 'ц': "ts",
	'Ч': "Ch", 'ч': "ch",
	'Ш': "Sh", 'ш': "sh",
	'Щ': "Shch", 'щ': "shch",
	'Ъ': "", 'ъ': "",
	'Ы': "Y", 'ы': "y",
	'Ь': "", 'ь': "",
	'Э': "E", 'э': "e",
	'Ю': "Yu", 'ю': "yu",
	'Я': "Ya", 'я': "ya",
}
