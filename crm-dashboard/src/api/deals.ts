import { api } from "./client";
import type { Deal, DealStage, Paged } from "../types";

export interface DealQuery {
  search?: string;
  stage?: DealStage | null;
  ownerId?: string | null;
  companyId?: string | null;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export function listDeals(query: DealQuery, signal?: AbortSignal): Promise<Paged<Deal>> {
  return api.get<Paged<Deal>>("/deals", { ...query }, signal);
}

export function getDeal(id: string, signal?: AbortSignal): Promise<Deal> {
  return api.get<Deal>(`/deals/${id}`, undefined, signal);
}

export function createDeal(input: Partial<Deal>): Promise<Deal> {
  return api.post<Deal>("/deals", input);
}

export function updateDeal(id: string, patch: Partial<Deal>): Promise<Deal> {
  return api.patch<Deal>(`/deals/${id}`, patch);
}

export function moveDeal(id: string, stage: DealStage): Promise<Deal> {
  return api.patch<Deal>(`/deals/${id}`, { stage });
}

export function deleteDeal(id: string): Promise<void> {
  return api.delete<void>(`/deals/${id}`);
}

export interface PipelineSummary {
  stage: DealStage;
  count: number;
  totalCents: number;
  weightedCents: number;
}

export function pipelineSummary(ownerId?: string | null): Promise<PipelineSummary[]> {
  return api.get<PipelineSummary[]>("/deals/pipeline", { ownerId });
}
