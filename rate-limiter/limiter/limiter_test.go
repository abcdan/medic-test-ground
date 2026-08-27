package limiter

import (
	"testing"
	"time"
)

func fixedClock(start time.Time) (func() time.Time, func(time.Duration)) {
	now := start
	return func() time.Time { return now }, func(d time.Duration) { now = now.Add(d) }
}

func TestConfigValidation(t *testing.T) {
	cases := []Config{
		{Rate: 0, Period: time.Second},
		{Rate: 5, Period: 0},
		{Rate: 5, Period: time.Second, Burst: -1},
	}
	for _, c := range cases {
		if err := c.validate(); err == nil {
			t.Fatalf("expected %+v to be rejected", c)
		}
	}
	if err := (Config{Rate: 5, Period: time.Second}).validate(); err != nil {
		t.Fatalf("valid config rejected: %v", err)
	}
}

func TestTokenBucketBurst(t *testing.T) {
	tb, err := NewTokenBucket(Config{Rate: 10, Period: time.Second, Burst: 3})
	if err != nil {
		t.Fatal(err)
	}
	defer tb.Close()

	now, advance := fixedClock(time.Now())
	tb.now = now

	for i := 0; i < 3; i++ {
		if d := tb.Allow("a"); !d.Allowed {
			t.Fatalf("request %d should have been allowed", i)
		}
	}
	if d := tb.Allow("a"); d.Allowed {
		t.Fatal("burst should be exhausted")
	}

	advance(200 * time.Millisecond)
	if d := tb.Allow("a"); !d.Allowed {
		t.Fatal("bucket should have refilled")
	}
}

func TestTokenBucketKeysAreIndependent(t *testing.T) {
	tb, _ := NewTokenBucket(Config{Rate: 2, Period: time.Second})
	defer tb.Close()

	tb.Allow("a")
	tb.Allow("a")
	if d := tb.Allow("a"); d.Allowed {
		t.Fatal("a should be limited")
	}
	if d := tb.Allow("b"); !d.Allowed {
		t.Fatal("b has its own bucket")
	}
}

func TestFixedWindowRollover(t *testing.T) {
	fw, _ := NewFixedWindow(Config{Rate: 2, Period: time.Second})
	defer fw.Close()

	now, advance := fixedClock(time.Now().Truncate(time.Second))
	fw.now = now

	if !fw.Allow("k").Allowed || !fw.Allow("k").Allowed {
		t.Fatal("first two should pass")
	}
	if fw.Allow("k").Allowed {
		t.Fatal("third should be blocked")
	}

	advance(time.Second)
	if !fw.Allow("k").Allowed {
		t.Fatal("new window should reset the count")
	}
}

func TestSlidingWindowRemaining(t *testing.T) {
	sw, _ := NewSlidingWindow(Config{Rate: 3, Period: time.Second})
	defer sw.Close()

	d := sw.Allow("k")
	if d.Remaining != 2 {
		t.Fatalf("expected 2 remaining, got %d", d.Remaining)
	}
	sw.Allow("k")
	sw.Allow("k")
	if sw.Allow("k").Allowed {
		t.Fatal("fourth request should be blocked")
	}
	if got := sw.Peek("k"); got != 3 {
		t.Fatalf("expected 3 hits, got %d", got)
	}
}

func TestReset(t *testing.T) {
	tb, _ := NewTokenBucket(Config{Rate: 1, Period: time.Hour})
	defer tb.Close()

	tb.Allow("k")
	if tb.Allow("k").Allowed {
		t.Fatal("should be exhausted")
	}
	tb.Reset("k")
	if !tb.Allow("k").Allowed {
		t.Fatal("reset should restore the bucket")
	}
}
