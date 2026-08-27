import { createApp } from "./app";
import { config } from "./config";
import { sessions } from "./db/sessions";

const app = createApp();

setInterval(() => {
  const purged = sessions.purgeExpired();
  if (purged > 0) console.log(`purged ${purged} expired sessions`);
}, 60_000);

app.listen(config.port, () => {
  console.log(`auth-service listening on :${config.port} (${config.environment})`);
});
