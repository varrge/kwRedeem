package provider_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"testing"
	"time"

	"kwmembership/internal/config"
	"kwmembership/internal/provider"
	"kwmembership/internal/secure"

	_ "modernc.org/sqlite"
)

func TestEfunLiveReadOnlyContract(t *testing.T) {
	if os.Getenv("KWMEMBERSHIP_LIVE_EFUN_CONTRACT") != "1" {
		t.Skip("set KWMEMBERSHIP_LIVE_EFUN_CONTRACT=1 to run the read-only provider contract check")
	}
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", "file:"+cfg.DatabasePath+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var baseURL, encrypted string
	if err := db.QueryRow(`SELECT base_url,credential_encrypted
    FROM membership_card_platforms WHERE key='efuncard'`).Scan(&baseURL, &encrypted); err != nil {
		t.Fatal(err)
	}
	decrypter, err := secure.NewDecrypter(cfg.EncryptionKey)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := decrypter.Decrypt(encrypted)
	if err != nil {
		t.Fatal(err)
	}
	var credential struct {
		APIKey string `json:"apiKey"`
	}
	if json.Unmarshal([]byte(plain), &credential) != nil || credential.APIKey == "" {
		t.Fatal("stored EfunCard credential is invalid")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if cfg.EfunCardProxyURL != "" {
		proxyURL, err := url.Parse(cfg.EfunCardProxyURL)
		if err != nil {
			t.Fatal(err)
		}
		transport.Proxy = http.ProxyURL(proxyURL)
	}
	httpClient := &http.Client{Transport: transport, Timeout: cfg.HTTPTimeout}
	client, err := provider.NewEfunCardClient(httpClient, baseURL, credential.APIKey)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	balance, err := client.GetBalance(ctx)
	if err != nil {
		t.Fatal(err)
	}
	products, err := client.ListProducts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if balance.Currency != "USD" || balance.Balance < 0 || len(products) == 0 {
		t.Fatalf("invalid normalized live contract: currency=%s balance=%0.2f products=%d", balance.Currency, balance.Balance, len(products))
	}
	t.Logf("normalized EfunCard contract: balance_usd=%0.2f products=%d", balance.Balance, len(products))
}
