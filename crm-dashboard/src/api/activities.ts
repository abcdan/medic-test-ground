import { api } from "./client";
import type { Activity, ActivityKind, Paged } from "../types";

export interface ActivityQuery {
  contactId?: string | null;
  dealId?: string | null;
  companyId?: string | null;
  kind?: ActivityKind | null;
  completed?: boolean;
  page?: number;
  pageSize?: number;
}

export function listActivities(query: ActivityQuery, signal?: AbortSignal): Promise<Paged<Activity>> {
  return api.get<Paged<Activity>>("/activities", { ...query }, signal);
}

export function logActivity(input: Partial<Activity>): Promise<Activity> {
  return api.post<Activity>("/activities", input);
}

export function completeActivity(id: string): Promise<Activity> {
  return api.patch<Activity>(`/activities/${id}`, { completed: true });
}

export function deleteActivity(id: string): Promise<void> {
  return api.delete<void>(`/activities/${id}`);
}

export function upcomingTasks(ownerId: string, signal?: AbortSignal): Promise<Activity[]> {
  return api.get<Activity[]>("/activities/upcoming", { ownerId }, signal);
}
