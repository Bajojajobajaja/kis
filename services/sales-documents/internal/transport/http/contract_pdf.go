package httptransport

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-pdf/fpdf"
)

const (
	sellerName    = "ООО \"KIS Motors\""
	sellerAddress = "г. Владивосток, ул. Светланская, 10"
	sellerDetails = "ИНН 2536000000, ОГРН 1022500000000, р/с 40702810000000000001"
)

type salesContractPDFData struct {
	DocumentNumber string
	DocumentDate   string
	Responsible    string
	BuyerName      string
	VehicleTitle   string
	VehicleVIN     string
	VehicleBrand   string
	VehicleModel   string
	VehicleYear    string
	VehicleColor   string
	VehiclePrice   string
	Total          float64
}

func buildSalesContractPDF(data salesContractPDFData) ([]byte, error) {
	if strings.TrimSpace(data.BuyerName) == "" {
		return nil, fmt.Errorf("buyer_name is required for contract pdf")
	}
	if strings.TrimSpace(data.VehicleTitle) == "" && strings.TrimSpace(data.VehicleVIN) == "" {
		return nil, fmt.Errorf("vehicle data is required for contract pdf")
	}

	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(18, 18, 18)
	pdf.SetAutoPageBreak(true, 18)
	pdf.AddPage()

	fontFamily, unicodeFont := configureContractPDFFont(pdf)
	writeLine := func(style string, size float64, value string) {
		pdf.SetFont(fontFamily, style, size)
		pdf.MultiCell(0, 6.5, normalizeContractText(value, unicodeFont), "", "L", false)
	}

	documentDate := strings.TrimSpace(data.DocumentDate)
	if documentDate == "" {
		documentDate = time.Now().UTC().Format("2006-01-02")
	}
	documentNumber := strings.TrimSpace(data.DocumentNumber)
	if documentNumber == "" {
		documentNumber = "CTR"
	}
	totalText := formatContractMoney(data.Total)
	vehicleDescription := strings.Join(
		[]string{
			strings.TrimSpace(data.VehicleTitle),
			strings.TrimSpace(data.VehicleBrand),
			strings.TrimSpace(data.VehicleModel),
			strings.TrimSpace(data.VehicleYear),
		},
		" ",
	)
	vehicleDescription = strings.TrimSpace(strings.Join(strings.Fields(vehicleDescription), " "))

	writeLine("B", 15, "Договор купли-продажи автомобиля")
	pdf.Ln(2)
	writeLine("", 11, fmt.Sprintf("№ %s от %s", documentNumber, documentDate))
	pdf.Ln(3)

	writeLine("B", 12, "Стороны договора")
	writeLine("", 11, fmt.Sprintf("Продавец: %s, %s, %s.", sellerName, sellerAddress, sellerDetails))
	writeLine("", 11, fmt.Sprintf("Покупатель: %s.", strings.TrimSpace(data.BuyerName)))
	if strings.TrimSpace(data.Responsible) != "" {
		writeLine("", 11, fmt.Sprintf("Ответственный менеджер: %s.", strings.TrimSpace(data.Responsible)))
	}
	pdf.Ln(2)

	writeLine("B", 12, "Предмет договора")
	writeLine("", 11, fmt.Sprintf("Продавец передает в собственность Покупателю автомобиль: %s.", vehicleDescription))
	writeLine("", 11, fmt.Sprintf("VIN: %s.", strings.TrimSpace(data.VehicleVIN)))
	if strings.TrimSpace(data.VehicleColor) != "" {
		writeLine("", 11, fmt.Sprintf("Цвет: %s.", strings.TrimSpace(data.VehicleColor)))
	}
	if strings.TrimSpace(data.VehiclePrice) != "" {
		writeLine("", 11, fmt.Sprintf("Цена по карточке автомобиля: %s руб.", strings.TrimSpace(data.VehiclePrice)))
	}
	pdf.Ln(2)

	writeLine("B", 12, "Стоимость и порядок расчетов")
	writeLine("", 11, fmt.Sprintf("Стоимость автомобиля по настоящему договору составляет %s руб.", totalText))
	writeLine("", 11, "Оплата производится на основании выставленного счета и подтверждается платежными документами.")
	pdf.Ln(2)

	writeLine("B", 12, "Передача автомобиля")
	writeLine("", 11, "Автомобиль передается Покупателю после полной оплаты и подписания необходимых передаточных документов.")
	writeLine("", 11, "Риск случайной гибели и право собственности переходят к Покупателю с момента фактической передачи автомобиля.")
	pdf.Ln(4)

	writeLine("B", 12, "Подписи сторон")
	pdf.Ln(12)
	writeLine("", 11, "Продавец: ____________________")
	pdf.Ln(6)
	writeLine("", 11, "Покупатель: ____________________")

	var buffer bytes.Buffer
	if err := pdf.Output(&buffer); err != nil {
		return nil, fmt.Errorf("render contract pdf: %w", err)
	}
	return buffer.Bytes(), nil
}

func configureContractPDFFont(pdf *fpdf.Fpdf) (string, bool) {
	regularPath, boldPath := resolveSystemTTFFonts()
	if regularPath == "" || boldPath == "" {
		return "Helvetica", false
	}

	// go-pdf/fpdf joins font filenames with its font location, so absolute
	// paths must be split before registration or they become broken relative paths.
	if !registerContractPDFFont(pdf, "", regularPath) {
		pdf.ClearError()
		return "Helvetica", false
	}
	if !registerContractPDFFont(pdf, "B", boldPath) {
		pdf.ClearError()
		return "Helvetica", false
	}
	return "ContractFont", true
}

func registerContractPDFFont(pdf *fpdf.Fpdf, style, fontPath string) bool {
	dir, file := filepath.Split(fontPath)
	if strings.TrimSpace(file) == "" {
		return false
	}
	if strings.TrimSpace(dir) == "" {
		dir = "."
	}

	pdf.SetFontLocation(dir)
	pdf.AddUTF8Font("ContractFont", style, file)
	return pdf.Error() == nil
}

func resolveSystemTTFFonts() (string, string) {
	regularCandidates := []string{
		`C:\Windows\Fonts\arial.ttf`,
		`/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`,
		`/usr/share/fonts/dejavu/DejaVuSans.ttf`,
	}
	boldCandidates := []string{
		`C:\Windows\Fonts\arialbd.ttf`,
		`/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf`,
		`/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf`,
	}

	return firstExistingPath(regularCandidates), firstExistingPath(boldCandidates)
}

func firstExistingPath(candidates []string) string {
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return ""
}

func normalizeContractText(value string, unicodeFont bool) string {
	if unicodeFont {
		return value
	}
	var builder strings.Builder
	for _, r := range value {
		if r <= 127 {
			builder.WriteRune(r)
			continue
		}
		builder.WriteRune('?')
	}
	return builder.String()
}

func formatContractMoney(value float64) string {
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.2f", value), "0"), ".")
}
