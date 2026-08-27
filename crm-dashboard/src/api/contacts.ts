import { api } from "./client";
import type { Contact, Paged } from "../types";

export interface ContactQuery {
  search?: string;
  ownerId?: string | null;
  companyId?: string | null;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export function listContacts(query: ContactQuery, signal?: AbortSignal): Promise<Paged<Contact>> {
  return api.get<Paged<Contact>>("/contacts", { ...query }, signal);
}

export function getContact(id: string, signal?: AbortSignal): Promise<Contact> {
  return api.get<Contact>(`/contacts/${id}`, undefined, signal);
}

export function createContact(input: Partial<Contact>): Promise<Contact> {
  return api.post<Contact>("/contacts", input);
}

export function updateContact(id: string, patch: Partial<Contact>): Promise<Contact> {
  return api.patch<Contact>(`/contacts/${id}`, patch);
}

export function deleteContact(id: string): Promise<void> {
  return api.delete<void>(`/contacts/${id}`);
}

export function bulkTag(ids: string[], tag: string): Promise<void> {
  return api.post<void>("/contacts/bulk-tag", { ids, tag });
}

export function mergeContacts(primaryId: string, duplicateId: string): Promise<Contact> {
  return api.post<Contact>(`/contacts/${primaryId}/merge`, { duplicateId });
}
