package app

// Service is a placeholder for future domain wiring.
type Service struct {
	Name string
}

func New(name string) *Service {
	return &Service{Name: name}
}
