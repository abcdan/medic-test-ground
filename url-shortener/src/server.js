const express = require("express");
const { LinkStore } = require("./store");
const { codeFor } = require("./shortcode");
const { isValidTarget, normalizeTarget, isValidAlias } = require("./validate");

const app = express();
app.use(express.json());

const store = new LinkStore();

function currentOwner(req) {
  return req.header("x-api-key") || "anonymous";
}

function isExpired(link) {
  if (!link.expiresAt) return false;
  return link.expiresAt < Date.now();
}

app.get("/health", (req, res) => {
  res.json({ ok: true, links: store.links.size, sequence: store.sequence });
});

app.post("/api/links", (req, res) => {
  const { target, alias, ttlHours } = req.body || {};

  if (!isValidTarget(target)) {
    return res.status(400).json({ error: "target is not a valid url" });
  }

  let code;
  if (alias !== undefined) {
    if (!isValidAlias(alias)) {
      return res.status(400).json({ error: "alias must be 3-32 url-safe chars" });
    }
    code = alias;
  } else {
    code = codeFor(store.nextSequence());
  }

  const expiresAt = ttlHours ? new Date(Date.now() + ttlHours * 3600 * 1000) : null;

  const link = store.put(code, normalizeTarget(target), {
    expiresAt,
    owner: currentOwner(req),
  });

  res.status(201).json({
    code: link.code,
    shortUrl: `${req.protocol}://${req.get("host")}/${link.code}`,
    target: link.target,
    expiresAt: link.expiresAt,
  });
});

app.get("/api/links", (req, res) => {
  const links = store.listByOwner(currentOwner(req));
  res.json({ links, count: links.length });
});

app.get("/api/links/:code", (req, res) => {
  const link = store.get(req.params.code);
  if (!link) return res.status(404).json({ error: "not found" });
  res.json(link);
});

app.delete("/api/links/:code", (req, res) => {
  const removed = store.delete(req.params.code, currentOwner(req));
  if (!removed) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

app.get("/:code", (req, res) => {
  const { code } = req.params;
  const clicks = store.recordClick(code);
  const link = store.get(code);

  if (!link) {
    return res.status(404).send("no such link");
  }
  if (isExpired(link)) {
    return res.status(410).send("link expired");
  }

  res.setHeader("X-Click-Count", clicks);
  res.redirect(302, link.target);
});

app.use((err, req, res, next) => {
  console.error("request failed", req.originalUrl, err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`url-shortener listening on :${PORT}`));
}

module.exports = { app, store };
