package main

import (
	"bytes"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var coveragePattern = regexp.MustCompile(`coverage:\s+([0-9]+(?:\.[0-9]+)?)%\s+of statements`)

type coverageResult struct {
	module   string
	coverage float64
	output   string
}

func main() {
	modulesRoot := flag.String("modules-root", "services", "Root directory that contains Go modules")
	threshold := flag.Float64("threshold", 55.0, "Minimum required coverage percentage")
	pkg := flag.String("package", "./internal/transport/http", "Package path to test within each module")
	tags := flag.String("tags", "", "Go build tags for tests")
	flag.Parse()

	modules, err := discoverModuleDirs(*modulesRoot)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to discover modules: %v\n", err)
		os.Exit(1)
	}
	if len(modules) == 0 {
		fmt.Fprintf(os.Stderr, "no go.mod files found under %q\n", *modulesRoot)
		os.Exit(1)
	}

	results := make([]coverageResult, 0, len(modules))
	for _, module := range modules {
		fmt.Printf("==> %s\n", filepath.ToSlash(module))
		result, runErr := runCoverage(module, *pkg, *tags)
		if runErr != nil {
			fmt.Fprintln(os.Stderr, result.output)
			if os.Getenv("GITHUB_ACTIONS") == "true" {
				message := fmt.Sprintf("coverage run failed in %s", filepath.ToSlash(module))
				if tail := outputTail(result.output, 40); tail != "" {
					message += "\n\n" + tail
				}
				fmt.Printf("::error title=Coverage run failed,file=%s::%s\n",
					filepath.ToSlash(module),
					escapeWorkflowCommand(message),
				)
			}
			fmt.Fprintf(os.Stderr, "coverage run failed for %s: %v\n", filepath.ToSlash(module), runErr)
			os.Exit(1)
		}
		results = append(results, result)
		fmt.Printf("coverage: %.1f%%\n", result.coverage)
	}

	fmt.Println()
	fmt.Printf("Coverage threshold: %.1f%%\n", *threshold)
	fmt.Println("Per-module results:")

	below := make([]coverageResult, 0)
	for _, result := range results {
		status := "OK"
		if result.coverage < *threshold {
			status = "FAIL"
			below = append(below, result)
		}
		fmt.Printf("  %-28s %6.1f%%  %s\n", filepath.Base(result.module), result.coverage, status)
	}

	if len(below) > 0 {
		fmt.Fprintln(os.Stderr)
		fmt.Fprintln(os.Stderr, "Coverage threshold not met for:")
		for _, result := range below {
			fmt.Fprintf(os.Stderr, "  - %s: %.1f%% < %.1f%%\n", filepath.Base(result.module), result.coverage, *threshold)
		}
		os.Exit(1)
	}
}

func runCoverage(moduleDir, pkg, tags string) (coverageResult, error) {
	args := []string{"test", pkg, "-cover"}
	if strings.TrimSpace(tags) != "" {
		args = []string{"test", "-tags", strings.TrimSpace(tags), pkg, "-cover"}
	}

	cmd := exec.Command("go", args...)
	cmd.Dir = moduleDir
	cmd.Env = buildModuleEnv(moduleDir)
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output

	err := cmd.Run()
	result := coverageResult{
		module: moduleDir,
		output: output.String(),
	}
	if err != nil {
		return result, err
	}

	coverage, parseErr := parseCoverage(result.output)
	if parseErr != nil {
		return result, parseErr
	}
	result.coverage = coverage
	return result, nil
}

func parseCoverage(output string) (float64, error) {
	matches := coveragePattern.FindAllStringSubmatch(output, -1)
	if len(matches) == 0 {
		return 0, fmt.Errorf("coverage value not found in output")
	}
	value := matches[len(matches)-1][1]
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0, fmt.Errorf("parse coverage value %q: %w", value, err)
	}
	return parsed, nil
}

func buildModuleEnv(moduleDir string) []string {
	env := envMapFromList(os.Environ())
	env["GOWORK"] = "off"
	if hasVendorModules(moduleDir) {
		env["GOFLAGS"] = appendGoFlag(env["GOFLAGS"], "-mod=vendor")
	}
	return envListFromMap(env)
}

func envMapFromList(values []string) map[string]string {
	result := make(map[string]string, len(values))
	for _, item := range values {
		key, value, ok := strings.Cut(item, "=")
		if !ok {
			continue
		}
		result[key] = value
	}
	return result
}

func envListFromMap(values map[string]string) []string {
	result := make([]string, 0, len(values))
	for key, value := range values {
		result = append(result, key+"="+value)
	}
	sort.Strings(result)
	return result
}

func hasVendorModules(moduleDir string) bool {
	info, err := os.Stat(filepath.Join(moduleDir, "vendor", "modules.txt"))
	return err == nil && !info.IsDir()
}

func appendGoFlag(existing, flag string) string {
	for _, item := range strings.Fields(existing) {
		if item == flag {
			return strings.TrimSpace(existing)
		}
	}
	if strings.TrimSpace(existing) == "" {
		return flag
	}
	return strings.TrimSpace(existing + " " + flag)
}

func outputTail(output string, maxLines int) string {
	if maxLines <= 0 {
		return ""
	}
	lines := strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n")
	for len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	if len(lines) == 0 {
		return ""
	}
	if len(lines) > maxLines {
		lines = lines[len(lines)-maxLines:]
	}
	return strings.Join(lines, "\n")
}

func escapeWorkflowCommand(value string) string {
	replacer := strings.NewReplacer(
		"%", "%25",
		"\r", "%0D",
		"\n", "%0A",
	)
	return replacer.Replace(value)
}

func discoverModuleDirs(root string) ([]string, error) {
	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%q is not a directory", root)
	}

	var moduleDirs []string
	walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if strings.HasPrefix(d.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Name() == "go.mod" {
			moduleDirs = append(moduleDirs, filepath.Dir(path))
		}
		return nil
	})
	if walkErr != nil {
		return nil, walkErr
	}
	if len(moduleDirs) == 0 {
		return nil, errors.New("no modules discovered")
	}
	sort.Strings(moduleDirs)
	return moduleDirs, nil
}
