# receipt-splitter

Splits a restaurant bill between people. Items can be assigned to a subset of
the group; anything unassigned is shared by everyone. Tax and tip are spread
proportionally to what each person ordered.

```
python splitter.py example.json --tip 20
```

Receipt format is JSON:

```json
{
  "name": "Taqueria Vista",
  "people": ["ana", "ben"],
  "items": [{"label": "tacos", "price": 12.0, "shared_by": ["ana"]}]
}
```
