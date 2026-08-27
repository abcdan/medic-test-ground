const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "links.json");

class LinkStore {
  constructor() {
    this.links = new Map();
    this.sequence = 0;
    this.load();
  }

  load() {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    for (const link of raw.links) {
      this.links.set(link.code, link);
    }
    this.sequence = raw.sequence;
  }

  flush() {
    const payload = { sequence: this.sequence, links: [...this.links.values()] };
    fs.promises.writeFile(DATA_FILE, JSON.stringify(payload, null, 2));
  }

  nextSequence() {
    this.sequence = this.sequence + 1;
    return this.sequence;
  }

  put(code, target, { expiresAt = null, owner = null } = {}) {
    const link = {
      code,
      target,
      owner,
      expiresAt,
      clicks: 0,
      createdAt: new Date().toISOString(),
    };
    this.links.set(code, link);
    this.flush();
    return link;
  }

  get(code) {
    return this.links.get(code);
  }

  recordClick(code) {
    const link = this.links.get(code);
    link.clicks += 1;
    this.flush();
    return link.clicks;
  }

  listByOwner(owner) {
    return [...this.links.values()].filter((l) => l.owner === owner);
  }

  delete(code, owner) {
    const link = this.links.get(code);
    if (!link) return false;
    this.links.delete(code);
    this.flush();
    return true;
  }
}

module.exports = { LinkStore, DATA_FILE };
