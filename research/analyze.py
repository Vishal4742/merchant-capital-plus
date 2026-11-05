import json, glob, re, collections

PLACE = re.compile(r"^(\d+(st|nd|rd|th) place|.*\bplace\b.*|.*winner.*|.*split.*|.*runner.?up.*|honou?rable.*)$", re.I)
THEMES = {
    "AI agent": r"\bagent|\bllm|\bai\b|gpt|claude|inference",
    "payments/stablecoin": r"stablecoin|usdc|usdt|pyusd|payment|payroll|checkout|remittanc|upi",
    "x402/agent pay": r"x402|nanopayment|pay-per",
    "privacy/ZK": r"\bzk|zero.knowledge|privacy|private|noir|circom|encrypt|fhe",
    "TEE": r"\btee\b|enclave|sgx|rofl|phala|nitro",
    "DeFi/trading": r"swap|amm|liquidity|lending|yield|perp|vault|dex\b|hook",
    "cross-chain": r"cross.?chain|bridge|ccip|cctp|layerzero|omnichain|fusion\+",
    "identity": r"world id|\\bens\\b|identity|passport|self protocol|kyc|sybil",
    "security": r"security|audit|malicious|phish|attack|clear sign|guard",
    "gaming/social": r"\bgame|gaming|player|social|dating|friends|telegram|mini.?app",
    "RWA": r"\brwa\b|real.world|tokeniz",
    "hardware": r"hardware|raspberry|arduino|esp32|robot|ledger device|sensor|drone",
    "account abstraction/7702": r"7702|4337|account abstraction|smart account|gasless|paymaster",
}

def parse(prizes):
    """['Ledger','Track','1st place','ETHGlobal','🏆 X Finalist'] -> finalist flag, [(sponsor, track)]"""
    fin = any("Finalist" in p for p in prizes)
    out, i = [], 0
    p = [x for x in prizes if "Finalist" not in x]
    while i < len(p):
        if p[i] == "ETHGlobal":
            i += 1; continue
        sponsor = p[i]; track = p[i + 1] if i + 1 < len(p) else ""
        i += 2
        if i < len(p) and PLACE.match(p[i]) and len(p[i]) < 40:
            track += " | " + p[i]; i += 1
        out.append((sponsor, track))
    return fin, out

rows = []
for f in sorted(glob.glob("w_*.json")):
    for r in json.load(open(f)):
        if not r["prizes"]:
            continue
        r["finalist"], r["wins"] = parse(r["prizes"])
        blob = (r["name"] + " " + r["tagline"] + " " + r["desc"] + " " + r["how"]).lower()
        r["themes"] = [t for t, rx in THEMES.items() if re.search(rx, blob)]
        if r["slug"] not in {x["slug"] for x in rows}: rows.append(r)

events = sorted(set(r["event"] for r in rows))
print("EVENTS:", {e: (sum(r["event"] == e for r in rows), sum(r["event"] == e and r["finalist"] for r in rows)) for e in events})

print("\n== prizes per winning project (all events) ==")
print(collections.Counter(len(r["wins"]) + r["finalist"] for r in rows))

print("\n== finalists: how many sponsor prizes they also won ==")
print(collections.Counter(len(r["wins"]) for r in rows if r["finalist"]))

print("\n== theme share: finalists vs all prize winners ==")
fin = [r for r in rows if r["finalist"]]
for t in THEMES:
    a = sum(t in r["themes"] for r in rows) / len(rows)
    b = sum(t in r["themes"] for r in fin) / max(1, len(fin))
    print(f"{t:28s} winners {a:5.0%}  finalists {b:5.0%}")

print("\n== theme share by event (winners) ==")
for e in events:
    er = [r for r in rows if r["event"] == e]
    c = collections.Counter(t for r in er for t in r["themes"])
    print(e, len(er), ", ".join(f"{t} {n/len(er):.0%}" for t, n in c.most_common(6)))

print("\n== sponsor prize counts by event ==")
for e in events:
    c = collections.Counter(s for r in rows if r["event"] == e for s, _ in r["wins"])
    print(e, dict(c.most_common(25)))

print("\n== most common sponsor pairs among multi-prize winners ==")
pairs = collections.Counter()
for r in rows:
    ss = sorted(set(s for s, _ in r["wins"]))
    pairs.update((a, b) for i, a in enumerate(ss) for b in ss[i + 1:])
print(pairs.most_common(20))

print("\n== FINALISTS ==")
for r in fin:
    print(f"[{r['event']}] {r['name']} — {r['tagline'][:110]} || sponsors: {[s for s,_ in r['wins']]} || {r['themes']}")

json.dump(rows, open("all.json", "w"))
