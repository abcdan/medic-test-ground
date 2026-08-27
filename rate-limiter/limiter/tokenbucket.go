package limiter

import (
	"sync"
	"time"
)

type bucket struct {
	tokens   float64
	lastSeen time.Time
}

// TokenBucket refills continuously at Rate/Period and permits bursts up to
// Burst. This is the default strategy: it smooths traffic without the hard
// cliff a fixed window has.
type TokenBucket struct {
	cfg     Config
	refill  float64 // tokens per nanosecond
	mu      sync.Mutex
	buckets map[string]*bucket
	stop    chan struct{}
	now     func() time.Time
}

// NewTokenBucket builds a token bucket limiter.
func NewTokenBucket(cfg Config) (*TokenBucket, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	cfg = cfg.withDefaults()

	tb := &TokenBucket{
		cfg:     cfg,
		refill:  float64(cfg.Rate) / float64(cfg.Period.Nanoseconds()),
		buckets: make(map[string]*bucket),
		stop:    make(chan struct{}),
		now:     time.Now,
	}
	go tb.sweeper()
	return tb, nil
}

// Allow consumes one token.
func (tb *TokenBucket) Allow(key string) Decision {
	return tb.AllowN(key, 1)
}

// AllowN consumes n tokens, all or nothing.
func (tb *TokenBucket) AllowN(key string, n int) Decision {
	now := tb.now()

	tb.mu.Lock()
	b, ok := tb.buckets[key]
	if !ok {
		b = &bucket{tokens: float64(tb.cfg.Burst), lastSeen: now}
		tb.buckets[key] = b
	}
	tb.mu.Unlock()

	elapsed := now.Sub(b.lastSeen)
	b.tokens += float64(elapsed) * tb.refill
	if b.tokens > float64(tb.cfg.Burst) {
		b.tokens = float64(tb.cfg.Burst)
	}
	b.lastSeen = now

	if b.tokens < float64(n) {
		deficit := float64(n) - b.tokens
		wait := time.Duration(deficit / tb.refill)
		return denied(tb.cfg.Burst, wait, now.Add(wait))
	}

	b.tokens -= float64(n)
	return Decision{
		Allowed:   true,
		Remaining: int(b.tokens),
		Limit:     tb.cfg.Burst,
		ResetAt:   now.Add(time.Duration(float64(tb.cfg.Burst-int(b.tokens)) / tb.refill)),
	}
}

// Reset drops the bucket for key.
func (tb *TokenBucket) Reset(key string) {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	delete(tb.buckets, key)
}

// Len reports how many keys are currently tracked.
func (tb *TokenBucket) Len() int {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	return len(tb.buckets)
}

// Close stops the background sweeper.
func (tb *TokenBucket) Close() error {
	close(tb.stop)
	return nil
}

func (tb *TokenBucket) sweeper() {
	ticker := time.NewTicker(tb.cfg.SweepEvery)
	for {
		select {
		case <-ticker.C:
			tb.sweep()
		case <-tb.stop:
			return
		}
	}
}

func (tb *TokenBucket) sweep() {
	cutoff := tb.now().Add(-tb.cfg.IdleTTL)
	tb.mu.Lock()
	defer tb.mu.Unlock()
	for key, b := range tb.buckets {
		if b.lastSeen.Before(cutoff) {
			delete(tb.buckets, key)
		}
	}
}
