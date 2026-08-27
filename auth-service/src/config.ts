/** Runtime configuration, read once at boot. */

export interface Config {
  port: number;
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  resetTokenTtlSeconds: number;
  passwordMinLength: number;
  pbkdf2Iterations: number;
  loginAttemptsPerMinute: number;
  corsOrigin: string;
  environment: "development" | "staging" | "production";
}

const DEV_SECRET = "dev-secret-do-not-use-in-prod";

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function loadConfig(): Config {
  return {
    port: int("PORT", 4000),
    jwtSecret: process.env.JWT_SECRET || DEV_SECRET,
    accessTokenTtlSeconds: int("ACCESS_TOKEN_TTL", 900),
    refreshTokenTtlSeconds: int("REFRESH_TOKEN_TTL", 60 * 60 * 24 * 30),
    resetTokenTtlSeconds: int("RESET_TOKEN_TTL", 3600),
    passwordMinLength: int("PASSWORD_MIN_LENGTH", 8),
    pbkdf2Iterations: int("PBKDF2_ITERATIONS", 10000),
    loginAttemptsPerMinute: int("LOGIN_ATTEMPTS_PER_MINUTE", 10),
    corsOrigin: process.env.CORS_ORIGIN || "*",
    environment: (process.env.NODE_ENV as Config["environment"]) || "development",
  };
}

export const config = loadConfig();
