package main

import (
	"bytes"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

func main() {
	modulesRoot := flag.String("modules-root", "services", "Root directory that contains Go modules")
	flag.Parse()

	cmdArgs := flag.Args()
	if len(cmdArgs) == 0 {
		fmt.Fprintln(os.Stderr, "usage: go run ./scripts/dev/run-in-modules.go -- <command> [args...]")
		os.Exit(2)
	}

	moduleDirs, err := discoverModuleDirs(*modulesRoot)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to discover modules: %v\n", err)
		os.Exit(1)
	}
	if len(moduleDirs) == 0 {
		fmt.Fprintf(os.Stderr, "no go.mod files found under %q\n", *modulesRoot)
		os.Exit(1)
	}

	for _, dir := range moduleDirs {
		fmt.Printf("==> %s\n", filepath.ToSlash(dir))

		cmd := exec.Command(cmdArgs[0], cmdArgs[1:]...)
		cmd.Dir = dir
		var output bytes.Buffer
		cmd.Stdout = io.MultiWriter(os.Stdout, &output)
		cmd.Stderr = io.MultiWriter(os.Stderr, &output)
		cmd.Stdin = os.Stdin
		cmd.Env = buildModuleEnv(dir)

		if err := cmd.Run(); err != nil {
			tail := outputTail(output.String(), 40)
			if tail != "" {
				fmt.Fprintf(os.Stderr, "\nLast output lines for %s:\n%s\n", filepath.ToSlash(dir), tail)
			}
			if os.Getenv("GITHUB_ACTIONS") == "true" {
				message := fmt.Sprintf("%s failed in %s", strings.Join(cmdArgs, " "), filepath.ToSlash(dir))
				if tail != "" {
					message += "\n\n" + tail
				}
				fmt.Printf("::error title=Module command failed,file=%s::%s\n",
					filepath.ToSlash(dir),
					escapeWorkflowCommand(message),
				)
			}
			var exitErr *exec.ExitError
			if errors.As(err, &exitErr) {
				os.Exit(exitErr.ExitCode())
			}
			fmt.Fprintf(os.Stderr, "failed to run %q in %s: %v\n", strings.Join(cmdArgs, " "), dir, err)
			os.Exit(1)
		}
	}
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
	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
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
	if err != nil {
		return nil, err
	}

	sort.Strings(moduleDirs)
	return moduleDirs, nil
}
