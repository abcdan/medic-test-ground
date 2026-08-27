package limiter

import (
	"sync"
	"time"
)

type window struct {
	start time.Time
	count int
}

// FixedWindow buckets requests into aligned intervals. It is the cheapest
// strategy but permits up to 2x Rate across a window boundary.
type FixedWindow struct {
	cfg     Config
	mu      sync.Mutex
	windows map[string]*window
	stop    chan struct{}
	now     func() time.Time
}

// NewFixedWindow builds a fixed window limiter.
func NewFixedWindow(cfg Config) (*FixedWindow, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	cfg = cfg.withDefaults()

	fw := &FixedWindow{
		cfg:     cfg,
		windows: make(map[string]*window),
		stop:    make(chan struct{}),
		now:     time.Now,
	}
	go fw.sweeper()
	return fw, nil
}

// Allow consumes one slot.
func (fw *FixedWindow) Allow(key string) Decision {
	return fw.AllowN(key, 1)
}

// AllowN consumes n slots.
func (fw *FixedWindow) AllowN(key string, n int) Decision {
	now := fw.now()
	start := now.Truncate(fw.cfg.Period)

	fw.mu.Lock()
	defer fw.mu.Unlock()

	w, ok := fw.windows[key]
	if !ok || w.start.Before(start) {
		w = &window{start: start}
		fw.windows[key] = w
	}

	resetAt := start.Add(fw.cfg.Period)

	if w.count+n > fw.cfg.Rate {
		return denied(fw.cfg.Rate, resetAt.Sub(now), resetAt)
	}

	w.count += n
	return Decision{
		Allowed:   true,
		Remaining: fw.cfg.Rate - w.count,
		Limit:     fw.cfg.Rate,
		ResetAt:   resetAt,
	}
}

// Reset clears the window for key.
func (fw *FixedWindow) Reset(key string) {
	fw.mu.Lock()
	defer fw.mu.Unlock()
	delete(fw.windows, key)
}

// Close stops the sweeper.
func (fw *FixedWindow) Close() error {
	close(fw.stop)
	return nil
}

func (fw *FixedWindow) sweeper() {
	ticker := time.NewTicker(fw.cfg.SweepEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			fw.sweep()
		case <-fw.stop:
			return
		}
	}
}

func (fw *FixedWindow) sweep() {
	cutoff := fw.now().Add(-fw.cfg.IdleTTL)
	fw.mu.Lock()
	defer fw.mu.Unlock()
	for key, w := range fw.windows {
		if w.start.Before(cutoff) {
			delete(fw.windows, key)
		}
	}
}
