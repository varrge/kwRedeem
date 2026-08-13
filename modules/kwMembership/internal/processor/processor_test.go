package processor

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"kwmembership/internal/config"
	"kwmembership/internal/store"
)

func TestNewHTTPClientDoesNotFollowRedirects(t *testing.T) {
	var targetCalls atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		targetCalls.Add(1)
		response.WriteHeader(http.StatusOK)
	}))
	defer target.Close()

	redirect := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		http.Redirect(response, request, target.URL, http.StatusTemporaryRedirect)
	}))
	defer redirect.Close()

	runner := New(config.Config{HTTPTimeout: time.Second}, nil, store.Lease{}, nil)
	request, err := http.NewRequest(http.MethodGet, redirect.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("X-API-Key", "must-not-leak")
	response, err := runner.httpClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusTemporaryRedirect {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusTemporaryRedirect)
	}
	if calls := targetCalls.Load(); calls != 0 {
		t.Fatalf("redirect target received %d requests", calls)
	}
}

func TestNewScopesProxyToEfunCardHTTPClient(t *testing.T) {
	var proxyCalls atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		proxyCalls.Add(1)
		if request.URL.Host != "efuncard.invalid" {
			t.Fatalf("proxied host = %q", request.URL.Host)
		}
		response.WriteHeader(http.StatusNoContent)
	}))
	defer proxy.Close()

	runner := New(config.Config{HTTPTimeout: time.Second, EfunCardProxyURL: proxy.URL}, nil, store.Lease{}, nil)
	request, err := http.NewRequest(http.MethodGet, "http://efuncard.invalid/account/profile", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := runner.efunHTTPClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent || proxyCalls.Load() != 1 {
		t.Fatalf("EfunCard proxy response = %d, calls = %d", response.StatusCode, proxyCalls.Load())
	}
	if runner.httpClient.Transport != nil {
		t.Fatal("shared provider HTTP client unexpectedly inherited the EfunCard proxy")
	}
}
