package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
)

const RenewalCancelURL = "https://cat.freespaces.app/api/subscription/cancel"

type RenewalClient struct{ http *http.Client }

func NewRenewalClient(client *http.Client) *RenewalClient { return &RenewalClient{http: client} }

func (c *RenewalClient) Cancel(ctx context.Context, session json.RawMessage) error {
	if !json.Valid(session) || len(session) == 0 || session[0] != '{' {
		return fail("SESSION_INVALID", "session is invalid", false)
	}
	body, _ := json.Marshal(struct {
		Token json.RawMessage `json:"token"`
	}{Token: session})
	request, err := newRequest(ctx, http.MethodPost, RenewalCancelURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(request)
	if err != nil {
		var networkError net.Error
		if errors.As(err, &networkError) && networkError.Timeout() {
			return wrap("RENEWAL_CANCEL_TIMEOUT", "renewal cancellation request timed out", err, true)
		}
		return wrap("RENEWAL_CANCEL_FAILED", "renewal cancellation network failure", err, true)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return fail("RENEWAL_CANCEL_AUTH_FAILED", "renewal cancellation authentication failed", true)
	}
	if response.StatusCode == http.StatusTooManyRequests {
		return fail("RENEWAL_CANCEL_RATE_LIMITED", "renewal cancellation rate limited", true)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fail("RENEWAL_CANCEL_FAILED", "renewal cancellation failed", true)
	}
	raw, err := readLimited(response, maxMembershipResponse, "RENEWAL_CANCEL_RESPONSE_TOO_LARGE")
	if err != nil {
		return err
	}
	var envelope struct {
		Code *int `json:"code"`
		Data *int `json:"data"`
	}
	if json.Unmarshal(raw, &envelope) != nil || envelope.Code == nil || *envelope.Code != 200 || envelope.Data == nil || *envelope.Data != 1 {
		return fail("RENEWAL_CANCEL_RESPONSE_INVALID", "renewal cancellation result is ambiguous", true)
	}
	return nil
}
