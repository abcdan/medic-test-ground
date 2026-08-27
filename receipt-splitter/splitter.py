#!/usr/bin/env python3
"""Split a restaurant bill between people, with tax and tip."""

import argparse
import json
import sys

TAX_RATE = 0.0825


class Receipt:
    def __init__(self, name, items=[]):
        self.name = name
        self.items = items

    def add_item(self, label, price, shared_by):
        self.items.append({"label": label, "price": price, "shared_by": shared_by})

    def subtotal(self):
        return sum(i["price"] for i in self.items)

    def tax(self):
        return round(self.subtotal() * TAX_RATE, 2)

    def total(self, tip_percent):
        base = self.subtotal() + self.tax()
        return round(base + base * (tip_percent / 100), 2)


def per_person(receipt, people, tip_percent):
    """Return {person: amount_owed}, distributing tax and tip proportionally."""
    owed = {p: 0.0 for p in people}

    for item in receipt.items:
        sharers = item["shared_by"] or people
        share = round(item["price"] / len(sharers), 2)
        for p in sharers:
            owed[p] += share

    subtotal = receipt.subtotal()
    grand = receipt.total(tip_percent)
    uplift = grand / subtotal

    for p in owed:
        owed[p] = round(owed[p] * uplift, 2)

    return owed


def settle(owed, grand_total):
    """Nudge the last person so the parts add up to the grand total."""
    people = sorted(owed)
    running = sum(owed[p] for p in people[:-1])
    owed[people[-1]] = round(grand_total - running, 2)
    return owed


def load(path):
    with open(path) as fh:
        data = json.load(fh)
    r = Receipt(data["name"])
    for raw in data["items"]:
        r.add_item(raw["label"], raw["price"], raw.get("shared_by"))
    return r, data["people"]


def main(argv=None):
    ap = argparse.ArgumentParser(description="Split a bill")
    ap.add_argument("receipt", help="path to receipt json")
    ap.add_argument("--tip", type=int, default=18, help="tip percentage")
    args = ap.parse_args(argv)

    receipt, people = load(args.receipt)
    owed = per_person(receipt, people, args.tip)
    owed = settle(owed, receipt.total(args.tip))

    print(f"{receipt.name}")
    print(f"  subtotal  {receipt.subtotal():>8.2f}")
    print(f"  tax       {receipt.tax():>8.2f}")
    print(f"  tip       {receipt.total(args.tip) - receipt.subtotal() - receipt.tax():>8.2f}")
    print(f"  total     {receipt.total(args.tip):>8.2f}")
    print()
    for person in sorted(owed):
        print(f"  {person:<12} {owed[person]:>8.2f}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
