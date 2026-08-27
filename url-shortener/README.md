# url-shortener

Tiny Express service that turns long URLs into short codes.

```
npm install
npm start
```

## API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/links` | Create a link. Body: `{ target, alias?, ttlHours? }` |
| `GET` | `/api/links` | List links owned by the caller's API key |
| `GET` | `/api/links/:code` | Link detail incl. click count |
| `DELETE` | `/api/links/:code` | Remove a link |
| `GET` | `/:code` | Redirect to the target and count the click |

Ownership comes from the `x-api-key` header. Links are persisted to
`links.json` next to the source tree.
