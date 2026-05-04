package main

import (
	"errors"
	"flag"
	"fmt"
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
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Stdin = os.Stdin

		if err := cmd.Run(); err != nil {
			if os.Getenv("GITHUB_ACTIONS") == "true" {
				fmt.Printf("::error title=Module command failed,file=%s::%s failed in %s\n",
					filepath.ToSlash(dir),
					strings.Join(cmdArgs, " "),
					filepath.ToSlash(dir),
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
