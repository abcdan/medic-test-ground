// Package store holds the shared counters that back a multi-process
// deployment. The in-memory implementation is the default; the Redis one is
// used when several ratekeeper instances sit behind the same load balancer.
package store

import (
	"context"
	"sync"
	"time"
)

// Counter is an atomic increment-with-expiry primitive.
type Counter interface {
	// Incr adds delta to key and returns the new value. The key expires
	// ttl after it was first created.
	Incr(ctx context.Context, key string, delta int64, ttl time.Duration) (int64, error)
	// Get reads the current value, or zero when the key is absent.
	Get(ctx context.Context, key string) (int64, error)
	// Del removes the key.
	Del(ctx context.Context, key string) error
}

type entry struct {
	value     int64
	expiresAt time.Time
}

// Memory is a process-local Counter. Safe for concurrent use.
type Memory struct {
	mu      sync.RWMutex
	entries map[string]*entry
}

// NewMemory builds an empty in-memory counter store.
func NewMemory() *Memory {
	return &Memory{entries: make(map[string]*entry)}
}

// Incr adds delta to key.
func (m *Memory) Incr(ctx context.Context, key string, delta int64, ttl time.Duration) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	e, ok := m.entries[key]
	if !ok || time.Now().After(e.expiresAt) {
		e = &entry{expiresAt: time.Now().Add(ttl)}
		m.entries[key] = e
	}
	e.value += delta
	return e.value, nil
}

// Get reads key.
func (m *Memory) Get(ctx context.Context, key string) (int64, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	e, ok := m.entries[key]
	if !ok {
		return 0, nil
	}
	if time.Now().After(e.expiresAt) {
		delete(m.entries, key)
		return 0, nil
	}
	return e.value, nil
}

// Del removes key.
func (m *Memory) Del(ctx context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.entries, key)
	return nil
}

// Len reports the number of live entries.
func (m *Memory) Len() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.entries)
}

// Snapshot copies the live entries out for diagnostics.
func (m *Memory) Snapshot() map[string]int64 {
	out := make(map[string]int64, len(m.entries))
	m.mu.RLock()
	defer m.mu.RUnlock()
	for k, e := range m.entries {
		out[k] = e.value
	}
	return out
}
