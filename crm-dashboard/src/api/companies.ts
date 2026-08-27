import { api } from "./client";
import type { Company, Paged, User } from "../types";

export function listCompanies(
  query: { search?: string; page?: number; pageSize?: number },
  signal?: AbortSignal,
): Promise<Paged<Company>> {
  return api.get<Paged<Company>>("/companies", { ...query }, signal);
}

export function getCompany(id: string, signal?: AbortSignal): Promise<Company> {
  return api.get<Company>(`/companies/${id}`, undefined, signal);
}

export function createCompany(input: Partial<Company>): Promise<Company> {
  return api.post<Company>("/companies", input);
}

export function updateCompany(id: string, patch: Partial<Company>): Promise<Company> {
  return api.patch<Company>(`/companies/${id}`, patch);
}

export function listUsers(signal?: AbortSignal): Promise<User[]> {
  return api.get<User[]>("/users", undefined, signal);
}

export function currentUser(signal?: AbortSignal): Promise<User> {
  return api.get<User>("/me", undefined, signal);
}
