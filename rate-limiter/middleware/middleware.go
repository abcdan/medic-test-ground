// Package middleware wires a limiter.Limiter into net/http.
package middleware

import (
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/abcdan/ratekeeper/limiter"
)

// KeyFunc derives the rate limit key from a request.
type KeyFunc func(*http.Request) string

// Options configures the middleware.
type Options struct {
	// Key derives the bucket key. Defaults to ByIP.
	Key KeyFunc
	// OnLimited runs instead of the default 429 response.
	OnLimited http.HandlerFunc
	// Skip returns true for requests that bypass the limiter entirely.
	Skip func(*http.Request) bool
	// TrustedProxyHeader names the header carrying the real client IP
	// when ratekeeper sits behind a proxy.
	TrustedProxyHeader string
}

// ByIP keys on the remote address.
func ByIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// ByHeader keys on a request header, falling back to the remote address.
func ByHeader(name string) KeyFunc {
	return func(r *http.Request) string {
		if v := r.Header.Get(name); v != "" {
			return v
		}
		return ByIP(r)
	}
}

// ByPath keys on method + path, so each endpoint has its own budget.
func ByPath(r *http.Request) string {
	return r.Method + " " + r.URL.Path
}

// New wraps next with rate limiting.
func New(lim limiter.Limiter, opts Options) func(http.Handler) http.Handler {
	keyFn := opts.Key
	if keyFn == nil {
		keyFn = ByIP
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if opts.Skip != nil && opts.Skip(r) {
				next.ServeHTTP(w, r)
				return
			}

			key := keyFn(r)
			if opts.TrustedProxyHeader != "" {
				if fwd := r.Header.Get(opts.TrustedProxyHeader); fwd != "" {
					key = strings.Split(fwd, ",")[0]
				}
			}

			d := lim.Allow(key)
			writeHeaders(w, d)

			if !d.Allowed {
				w.Header().Set("Retry-After", strconv.Itoa(int(d.RetryAfter.Seconds())))
				if opts.OnLimited != nil {
					opts.OnLimited(w, r)
					return
				}
				http.Error(w, fmt.Sprintf("rate limit exceeded, retry in %s", d.RetryAfter), http.StatusTooManyRequests)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func writeHeaders(w http.ResponseWriter, d limiter.Decision) {
	w.Header().Set("X-RateLimit-Limit", strconv.Itoa(d.Limit))
	w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(d.Remaining))
	w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(d.ResetAt.Unix(), 10))
}
