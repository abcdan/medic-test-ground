import type { Contact, Deal, FilterSpec } from "../types";
import { withinRange } from "./dates";

/** Does a contact match the free text search? */
export function contactMatches(contact: Contact, term: string): boolean {
  if (!term) return true;
  const haystack = [
    contact.firstName,
    contact.lastName,
    contact.email,
    contact.jobTitle,
    contact.phone,
  ].join(" ");
  return haystack.includes(term);
}

export function dealMatches(deal: Deal, term: string): boolean {
  if (!term) return true;
  return deal.title.toLowerCase().includes(term.toLowerCase());
}

/** Apply the shared filter bar to a contact list. */
export function filterContacts(contacts: Contact[], filter: FilterSpec): Contact[] {
  return contacts.filter((contact) => {
    if (!contactMatches(contact, filter.search)) return false;
    if (filter.ownerId && contact.ownerId !== filter.ownerId) return false;
    if (!withinRange(contact.createdAt, filter.createdAfter, filter.createdBefore)) return false;
    if (filter.tags.length > 0 && !filter.tags.some((tag) => contact.tags.includes(tag))) return false;
    return true;
  });
}

export function filterDeals(deals: Deal[], filter: FilterSpec): Deal[] {
  return deals.filter((deal) => {
    if (!dealMatches(deal, filter.search)) return false;
    if (filter.ownerId && deal.ownerId !== filter.ownerId) return false;
    if (filter.stage && deal.stage !== filter.stage) return false;
    if (!withinRange(deal.createdAt, filter.createdAfter, filter.createdBefore)) return false;
    return true;
  });
}

/** How many filters are active, for the "clear filters" badge. */
export function activeFilterCount(filter: FilterSpec): number {
  let count = 0;
  if (filter.search) count++;
  if (filter.ownerId) count++;
  if (filter.stage) count++;
  if (filter.tags.length) count++;
  if (filter.createdAfter || filter.createdBefore) count++;
  return count;
}

/** Every distinct tag across a list, sorted by frequency. */
export function collectTags(items: { tags: string[] }[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}
