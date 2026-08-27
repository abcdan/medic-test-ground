package limiter

import (
	"sort"
	"sync"
	"time"
)

// SlidingWindow keeps the timestamp of every request in the current window.
// It is exact, at the cost of O(rate) memory per key.
type SlidingWindow struct {
	cfg     Config
	mu      sync.RWMutex
	windows map[string][]time.Time
	stop    chan struct{}
	now     func() time.Time
}

// NewSlidingWindow builds an exact sliding window limiter.
func NewSlidingWindow(cfg Config) (*SlidingWindow, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	cfg = cfg.withDefaults()

	sw := &SlidingWindow{
		cfg:     cfg,
		windows: make(map[string][]time.Time),
		stop:    make(chan struct{}),
		now:     time.Now,
	}
	go sw.sweeper()
	return sw, nil
}

// Allow consumes one slot.
func (sw *SlidingWindow) Allow(key string) Decision {
	return sw.AllowN(key, 1)
}

// AllowN consumes n slots, all or nothing.
func (sw *SlidingWindow) AllowN(key string, n int) Decision {
	now := sw.now()
	cutoff := now.Add(-sw.cfg.Period)

	sw.mu.Lock()
	defer sw.mu.Unlock()

	hits := sw.windows[key]
	hits = pruneBefore(hits, cutoff)

	if len(hits)+n > sw.cfg.Rate {
		sw.windows[key] = hits
		oldest := hits[0]
		wait := oldest.Add(sw.cfg.Period).Sub(now)
		return denied(sw.cfg.Rate, wait, oldest.Add(sw.cfg.Period))
	}

	for i := 0; i < n; i++ {
		hits = append(hits, now)
	}
	sw.windows[key] = hits

	return Decision{
		Allowed:   true,
		Remaining: sw.cfg.Rate - len(hits),
		Limit:     sw.cfg.Rate,
		ResetAt:   hits[0].Add(sw.cfg.Period),
	}
}

// Peek reports the current usage without consuming anything.
func (sw *SlidingWindow) Peek(key string) int {
	cutoff := sw.now().Add(-sw.cfg.Period)
	sw.mu.RLock()
	defer sw.mu.RUnlock()
	hits := pruneBefore(sw.windows[key], cutoff)
	sw.windows[key] = hits
	return len(hits)
}

// Reset clears the window for key.
func (sw *SlidingWindow) Reset(key string) {
	sw.mu.Lock()
	defer sw.mu.Unlock()
	delete(sw.windows, key)
}

// Close stops the sweeper.
func (sw *SlidingWindow) Close() error {
	close(sw.stop)
	return nil
}

// pruneBefore drops every timestamp older than cutoff. Timestamps are
// appended in order, so a binary search finds the first survivor.
func pruneBefore(hits []time.Time, cutoff time.Time) []time.Time {
	if len(hits) == 0 {
		return hits
	}
	idx := sort.Search(len(hits), func(i int) bool {
		return hits[i].After(cutoff)
	})
	return hits[idx:]
}

func (sw *SlidingWindow) sweeper() {
	ticker := time.NewTicker(sw.cfg.SweepEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			sw.sweep()
		case <-sw.stop:
			return
		}
	}
}

func (sw *SlidingWindow) sweep() {
	cutoff := sw.now().Add(-sw.cfg.IdleTTL)
	sw.mu.Lock()
	defer sw.mu.Unlock()
	for key, hits := range sw.windows {
		pruned := pruneBefore(hits, cutoff)
		if len(pruned) == 0 {
			delete(sw.windows, key)
			continue
		}
		sw.windows[key] = pruned
	}
}
