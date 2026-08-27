# auth-service

Email + password authentication with JWT access tokens and rotating refresh
tokens.

```
npm install
npm run build
npm start
```

## Endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | - | Create an account, returns a token pair |
| `POST` | `/auth/login` | - | Exchange credentials for a token pair |
| `POST` | `/auth/refresh` | - | Rotate the refresh token |
| `POST` | `/auth/logout` | - | Revoke one session |
| `POST` | `/auth/logout-all` | bearer | Revoke every session |
| `GET` | `/auth/sessions` | bearer | List active sessions |
| `DELETE` | `/auth/sessions/:id` | bearer | Revoke one session |
| `POST` | `/auth/password/change` | bearer | Change password |
| `POST` | `/auth/password/forgot` | - | Start a reset |
| `POST` | `/auth/password/reset` | - | Complete a reset |
| `GET` | `/users/me` | bearer | Current user |
| `PATCH` | `/users/me` | bearer | Update profile |
| `GET` | `/users/:id` | bearer | Fetch a user |
| `GET` | `/users` | admin | List users |
| `POST` | `/users/:id/roles` | admin | Assign roles |
| `DELETE` | `/users/:id` | admin | Delete a user |

## Design notes

- Access tokens are HS256 JWTs with a 15 minute default TTL
- Refresh tokens are opaque 32-byte random values; only their sha256 is
  stored, and each refresh rotates the value
- Passwords are PBKDF2-SHA256; the iteration count is stored alongside the
  hash so older hashes are upgraded transparently on next login
- Five failed logins lock an account for 15 minutes
- Login attempts are rate limited per account

## Configuration

| Var | Default |
| --- | --- |
| `PORT` | `4000` |
| `JWT_SECRET` | dev fallback |
| `ACCESS_TOKEN_TTL` | `900` |
| `REFRESH_TOKEN_TTL` | `2592000` |
| `RESET_TOKEN_TTL` | `3600` |
| `PBKDF2_ITERATIONS` | `10000` |
| `LOGIN_ATTEMPTS_PER_MINUTE` | `10` |
| `CORS_ORIGIN` | `*` |
