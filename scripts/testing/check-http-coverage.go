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
