// Package limiter implements the rate limiting algorithms used by ratekeeper.
//
// Three strategies are available:
//
//	token bucket   - smooth rate with configurable burst
//	sliding window - accurate count over a rolling interval
//	fixed window   - cheapest, allows 2x burst at window boundaries
//
// All limiters are safe for concurrent use.
package limiter

import (
	"fmt"
	"time"
)

// Decision is the result of a limit check.
type Decision struct {
	// Allowed reports whether the request may proceed.
	Allowed bool
	// Remaining is how many requests are left in the current window.
	Remaining int
	// Limit is the configured ceiling, echoed back for headers.
	Limit int
	// RetryAfter is how long the caller should wait before retrying.
	// Zero when Allowed is true.
	RetryAfter time.Duration
	// ResetAt is when the window rolls over.
	ResetAt time.Time
}

// Limiter decides whether a keyed caller may proceed.
type Limiter interface {
	// Allow consumes a single token for key.
	Allow(key string) Decision
	// AllowN consumes n tokens for key.
	AllowN(key string, n int) Decision
	// Reset forgets all state for key.
	Reset(key string)
	// Close releases background resources.
	Close() error
}

// Config describes a limit.
type Config struct {
	// Rate is how many requests are permitted per Period.
	Rate int
	// Period is the window length.
	Period time.Duration
	// Burst is the maximum instantaneous burst. Token bucket only.
	// Defaults to Rate when zero.
	Burst int
	// SweepEvery controls how often idle keys are evicted. Defaults to
	// one minute.
	SweepEvery time.Duration
	// IdleTTL is how long an untouched key survives a sweep. Defaults to
	// ten times Period.
	IdleTTL time.Duration
}

func (c Config) validate() error {
	if c.Rate <= 0 {
		return fmt.Errorf("limiter: rate must be positive, got %d", c.Rate)
	}
	if c.Period <= 0 {
		return fmt.Errorf("limiter: period must be positive, got %s", c.Period)
	}
	if c.Burst < 0 {
		return fmt.Errorf("limiter: burst must not be negative, got %d", c.Burst)
	}
	return nil
}

func (c Config) withDefaults() Config {
	if c.Burst == 0 {
		c.Burst = c.Rate
	}
	if c.SweepEvery == 0 {
		c.SweepEvery = time.Minute
	}
	if c.IdleTTL == 0 {
		c.IdleTTL = 10 * c.Period
	}
	return c
}

// perRequestCost is how much of the bucket a single request drains.
func (c Config) perRequestCost() time.Duration {
	return c.Period / time.Duration(c.Rate)
}

func denied(limit int, retryAfter time.Duration, resetAt time.Time) Decision {
	return Decision{
		Allowed:    false,
		Remaining:  0,
		Limit:      limit,
		RetryAfter: retryAfter,
		ResetAt:    resetAt,
	}
}
