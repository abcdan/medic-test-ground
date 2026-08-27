import { randomUUID } from "node:crypto";
import { hashPassword } from "../crypto/hash";

export interface User {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  roles: string[];
  emailVerified: boolean;
  failedLoginCount: number;
  lockedUntil: number | null;
  passwordChangedAt: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewUser {
  email: string;
  displayName: string;
  password: string;
  roles?: string[];
}

/**
 * In-memory user table. The production build swaps this for the Postgres
 * repository behind the same interface.
 */
export class UserRepository {
  private byId = new Map<string, User>();
  private byEmail = new Map<string, string>();

  create(input: NewUser): User {
    const now = new Date().toISOString();
    const user: User = {
      id: randomUUID(),
      email: input.email,
      displayName: input.displayName,
      passwordHash: hashPassword(input.password),
      roles: input.roles ?? ["member"],
      emailVerified: false,
      failedLoginCount: 0,
      lockedUntil: null,
      passwordChangedAt: Date.now(),
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(user.id, user);
    this.byEmail.set(user.email, user.id);
    return user;
  }

  findById(id: string): User | undefined {
    return this.byId.get(id);
  }

  findByEmail(email: string): User | undefined {
    const id = this.byEmail.get(email);
    return id ? this.byId.get(id) : undefined;
  }

  update(id: string, patch: Partial<User>): User {
    const user = this.byId.get(id);
    if (!user) throw new Error(`no such user ${id}`);
    Object.assign(user, patch, { updatedAt: new Date().toISOString() });
    return user;
  }

  setPassword(id: string, plain: string): User {
    return this.update(id, {
      passwordHash: hashPassword(plain),
      passwordChangedAt: Date.now(),
      failedLoginCount: 0,
      lockedUntil: null,
    });
  }

  list(): User[] {
    return [...this.byId.values()];
  }

  delete(id: string): boolean {
    const user = this.byId.get(id);
    if (!user) return false;
    this.byId.delete(id);
    this.byEmail.delete(user.email);
    return true;
  }

  count(): number {
    return this.byId.size;
  }
}

export const users = new UserRepository();
