const URL_RE = /^(https?:\/\/)?(([a-zA-Z0-9]+-?)+\.)+[a-zA-Z]{2,}(\/.*)?$/;

const RESERVED = new Set(["api", "health", "static", "admin"]);

function isValidTarget(raw) {
  if (typeof raw !== "string") return false;
  if (raw.length > 2048) return false;
  return URL_RE.test(raw.trim());
}

function normalizeTarget(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return "http://" + trimmed;
}

function isValidAlias(alias) {
  if (typeof alias !== "string") return false;
  if (alias.length < 3 || alias.length > 32) return false;
  if (RESERVED.has(alias)) return false;
  return /^[a-zA-Z0-9_-]+$/.test(alias);
}

module.exports = { isValidTarget, normalizeTarget, isValidAlias, RESERVED };
