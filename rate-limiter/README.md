# ratekeeper

Rate limiting for Go HTTP services. Three strategies behind one interface,
plus `net/http` middleware.

```go
lim, err := limiter.NewTokenBucket(limiter.Config{
    Rate:   100,
    Period: time.Minute,
    Burst:  20,
})
if err != nil {
    log.Fatal(err)
}
defer lim.Close()

mux.Handle("/api/", middleware.New(lim, middleware.Options{
    Key: middleware.ByHeader("X-Api-Key"),
})(apiHandler))
```

## Strategies

| Strategy | Memory per key | Accuracy | Notes |
| --- | --- | --- | --- |
| `NewTokenBucket` | O(1) | smooth | configurable burst, refills continuously |
| `NewSlidingWindow` | O(rate) | exact | keeps every timestamp in the window |
| `NewFixedWindow` | O(1) | approximate | allows up to 2x rate at a boundary |

All limiters run a background sweeper that evicts keys untouched for
`IdleTTL` (default 10x `Period`). Call `Close` to stop it.

## Response headers

The middleware sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
`X-RateLimit-Reset` on every response and `Retry-After` on a 429.

## Shared counters

`store.Counter` backs multi-process deployments. `store.NewMemory()` is the
default; a Redis implementation lives behind the same interface.
