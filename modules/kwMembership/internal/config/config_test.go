package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadDotenvDoesNotOverrideEnvironment(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	if err := os.WriteFile(path, []byte("EXISTING=from-file\nQUOTED=\"hello world\"\nCOMMENTED=value # comment\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("EXISTING", "from-env")
	os.Unsetenv("QUOTED")
	os.Unsetenv("COMMENTED")
	t.Cleanup(func() {
		os.Unsetenv("QUOTED")
		os.Unsetenv("COMMENTED")
	})
	if err := loadDotenv(path); err != nil {
		t.Fatal(err)
	}
	if got := os.Getenv("EXISTING"); got != "from-env" {
		t.Fatalf("existing env overwritten: %q", got)
	}
	if got := os.Getenv("QUOTED"); got != "hello world" {
		t.Fatalf("quoted value = %q", got)
	}
	if got := os.Getenv("COMMENTED"); got != "value" {
		t.Fatalf("commented value = %q", got)
	}
}

func TestLoadUsesKawangDatabaseAndSecret(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module test\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	kawang := t.TempDir()
	if err := os.WriteFile(filepath.Join(kawang, "package.json"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(kawang, "data"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(kawang, ".env"), []byte("DATABASE_PATH=./data/kawang.db\nJWT_SECRET=shared-test-secret\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KWMEMBERSHIP_PROJECT_ROOT", root)
	t.Setenv("KAWANG_PROJECT_ROOT", kawang)
	os.Unsetenv("DATABASE_PATH")
	os.Unsetenv("JWT_SECRET")
	t.Cleanup(func() {
		os.Unsetenv("DATABASE_PATH")
		os.Unsetenv("JWT_SECRET")
	})
	t.Setenv("WORKER_POLL_MS", "5000")
	t.Setenv("DEFAULT_REQUEST_TIMEOUT_MS", "15000")
	t.Setenv("KWMEMBERSHIP_CHROME_PROXY_SERVER", "http://127.0.0.1:7890")
	t.Setenv("KWMEMBERSHIP_EFUNCARD_PROXY_URL", "http://127.0.0.1:17890")
	t.Setenv("KWMEMBERSHIP_VISIBLE_BROWSER", "true")
	t.Setenv("KWMEMBERSHIP_HUMAN_CHALLENGE_TIMEOUT_MS", "300000")
	t.Setenv("KWMEMBERSHIP_EXECUTOR_SECRET", "test-python-executor-secret-00000001")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DatabasePath != filepath.Join(kawang, "data", "kawang.db") {
		t.Fatalf("DatabasePath = %q", cfg.DatabasePath)
	}
	if cfg.EncryptionKey != "shared-test-secret" {
		t.Fatalf("EncryptionKey did not come from kwRedeem")
	}
	if cfg.ChromeProxyServer != "http://127.0.0.1:7890" {
		t.Fatalf("ChromeProxyServer = %q", cfg.ChromeProxyServer)
	}
	if cfg.EfunCardProxyURL != "http://127.0.0.1:17890" {
		t.Fatalf("EfunCardProxyURL = %q", cfg.EfunCardProxyURL)
	}
	if !cfg.VisibleBrowser || cfg.HumanChallengeTimeout.String() != "5m0s" {
		t.Fatalf("visible challenge config = %t/%s", cfg.VisibleBrowser, cfg.HumanChallengeTimeout)
	}
	if cfg.CheckoutExecutor != "python" || cfg.ExecutorListenAddress != "127.0.0.1:4312" {
		t.Fatalf("executor config = %q/%q", cfg.CheckoutExecutor, cfg.ExecutorListenAddress)
	}
}

func TestLoadReadsManagedEnvironmentFile(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module test\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	kawang := t.TempDir()
	if err := os.WriteFile(filepath.Join(kawang, "package.json"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(kawang, "data"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(kawang, ".env"), []byte("DATABASE_PATH=./data/kawang.db\nJWT_SECRET=managed-shared-secret\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	managedEnv := filepath.Join(t.TempDir(), "kwmembership.env")
	contents := "KWMEMBERSHIP_EXECUTOR_SECRET=managed-python-executor-secret-000001\nKWMEMBERSHIP_VISIBLE_BROWSER=true\n"
	if err := os.WriteFile(managedEnv, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("KWMEMBERSHIP_PROJECT_ROOT", root)
	t.Setenv("KWMEMBERSHIP_ENV_FILE", managedEnv)
	t.Setenv("KAWANG_PROJECT_ROOT", kawang)
	for _, key := range []string{"DATABASE_PATH", "JWT_SECRET", "KWMEMBERSHIP_EXECUTOR_SECRET", "KWMEMBERSHIP_VISIBLE_BROWSER"} {
		os.Unsetenv(key)
		t.Cleanup(func() { os.Unsetenv(key) })
	}

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DatabasePath != filepath.Join(kawang, "data", "kawang.db") {
		t.Fatalf("DatabasePath = %q", cfg.DatabasePath)
	}
	if cfg.EncryptionKey != "managed-shared-secret" || !cfg.VisibleBrowser {
		t.Fatalf("managed configuration was not loaded: secret=%q visible=%t", cfg.EncryptionKey, cfg.VisibleBrowser)
	}
}

func TestValidateExecutorListenAddress(t *testing.T) {
	for _, value := range []string{"0.0.0.0:4312", "192.168.1.2:4312", "localhost:4312", "127.0.0.1"} {
		if _, err := validateExecutorListenAddress(value); err == nil {
			t.Fatalf("validateExecutorListenAddress(%q) unexpectedly succeeded", value)
		}
	}
	if got, err := validateExecutorListenAddress("127.0.0.1:4312"); err != nil || got != "127.0.0.1:4312" {
		t.Fatalf("valid executor listen address rejected: value=%q error=%v", got, err)
	}
}

func TestValidateChromeProxyServer(t *testing.T) {
	for _, value := range []string{
		"https://127.0.0.1:7890",
		"http://user:password@127.0.0.1:7890",
		"http://127.0.0.1:7890/path",
		"http://127.0.0.1",
		"http://127.0.0.1:70000",
	} {
		if _, err := validateChromeProxyServer(value); err == nil {
			t.Fatalf("validateChromeProxyServer(%q) unexpectedly succeeded", value)
		}
	}
	if got, err := validateChromeProxyServer("socks5://127.0.0.1:7890"); err != nil || got == "" {
		t.Fatalf("valid proxy rejected: value=%q error=%v", got, err)
	}
}

func TestValidateEfunCardProxyURL(t *testing.T) {
	for _, value := range []string{
		"https://127.0.0.1:7890",
		"socks5://user:password@127.0.0.1:7890",
		"http://127.0.0.1:7890/path",
		"http://127.0.0.1",
	} {
		if _, err := validateEfunCardProxyURL(value); err == nil || !strings.Contains(err.Error(), "KWMEMBERSHIP_EFUNCARD_PROXY_URL") {
			t.Fatalf("validateEfunCardProxyURL(%q) error = %v", value, err)
		}
	}
	if got, err := validateEfunCardProxyURL("http://127.0.0.1:17890"); err != nil || got == "" {
		t.Fatalf("valid EfunCard proxy rejected: value=%q error=%v", got, err)
	}
}

func TestBooleanRejectsUnknownValue(t *testing.T) {
	t.Setenv("KWMEMBERSHIP_VISIBLE_BROWSER", "sometimes")
	if _, err := boolean("KWMEMBERSHIP_VISIBLE_BROWSER", false); err == nil {
		t.Fatal("invalid visible-browser flag was accepted")
	}
}

func TestLoadRejectsUnknownCheckoutExecutor(t *testing.T) {
	if _, err := validateCheckoutExecutor("extension"); err == nil || !strings.Contains(err.Error(), "KWMEMBERSHIP_CHECKOUT_EXECUTOR") {
		t.Fatalf("unknown checkout executor error = %v", err)
	}
}

func TestProductionSessionCookieDropInUsesPrivateVirtualDisplay(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "deploy", "kwmembership-session-cookie.conf"))
	if err != nil {
		t.Fatal(err)
	}
	config := string(raw)
	for _, required := range []string{
		"Requires=kwmembership-xvfb.service",
		"After=kwmembership-xvfb.service",
		"Environment=DISPLAY=:99",
		"Environment=KWMEMBERSHIP_VISIBLE_BROWSER=true",
		"Environment=KWMEMBERSHIP_CHROME_PROXY_SERVER=http://127.0.0.1:7890",
		"BindReadOnlyPaths=/tmp/.X11-unix",
	} {
		if !strings.Contains(config, required) {
			t.Fatalf("production Session Cookie drop-in is missing %q", required)
		}
	}
	if strings.Contains(config, "Environment=KWMEMBERSHIP_VISIBLE_BROWSER=false") {
		t.Fatal("production Session Cookie drop-in still forces rejected headless Chrome")
	}
}

func TestPythonExecutorServiceOwnsPrivateOrderProfiles(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "systemd", "kwmembership-python-executor.service"))
	if err != nil {
		t.Fatal(err)
	}
	config := string(raw)
	for _, required := range []string{
		"Environment=KWMEMBERSHIP_BROWSER_PROFILE_ROOT=/run/kwmembership-browser-profiles",
		"RuntimeDirectory=kwmembership-browser-profiles",
		"RuntimeDirectoryMode=0700",
		"RuntimeDirectoryPreserve=restart",
	} {
		if !strings.Contains(config, required) {
			t.Fatalf("Python executor service is missing %q", required)
		}
	}
}

func TestLoadRejectsDefaultKawangSecret(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module test\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	kawang := t.TempDir()
	if err := os.WriteFile(filepath.Join(kawang, "package.json"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KWMEMBERSHIP_PROJECT_ROOT", root)
	t.Setenv("KAWANG_PROJECT_ROOT", kawang)
	t.Setenv("JWT_SECRET", defaultJWTSecret)
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "default placeholder") {
		t.Fatalf("Load() error = %v, want default placeholder rejection", err)
	}
}
