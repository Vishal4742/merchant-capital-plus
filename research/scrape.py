import re, html, json, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = {"User-Agent": "Mozilla/5.0"}
EVENTS = sys.argv[1:]

def get(url):
    # ponytail: fixed backoff; site rate-limits around 6 parallel requests
    for n in range(6):
        try:
            s = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read().decode()
            if "<title>" in s:
                return s
        except Exception:
            pass
        time.sleep(3 * (n + 1))
    print("FAILED", url, flush=True)
    return ""

def text(s):
    s = re.sub(r"<script.*?</script>", "", s, flags=re.S)
    s = re.sub(r"<[^>]+>", "\n", s)
    return [l.strip() for l in html.unescape(s).split("\n") if l.strip()]

def winners(event):
    slugs, page = [], 1
    while True:
        s = get(f"https://ethglobal.com/showcase?events={event}&page={page}")
        cards = re.findall(r'<a class="block border-2[^"]*" href="/showcase/([^"]+)">(.*?)</a>', s, flags=re.S)
        if not cards:
            break
        slugs += [slug for slug, body in cards if 'alt="prize"' in body]
        page += 1
    return slugs

def project(slug):
    raw = get(f"https://ethglobal.com/showcase/{slug}")
    L = text(raw)
    t = re.search(r"<title>(.*?) \| ETHGlobal</title>", raw)
    d = re.search(r'<meta name="description" content="([^"]*)"', raw)
    def between(a, b):
        try:
            i = L.index(a) + 1
            j = L.index(b, i) if b in L[i:] else len(L)
            return L[i:j]
        except ValueError:
            return []
    w = between("Winner of", "Project Description")
    prizes = [x for x in w if x != "-"]
    return {
        "slug": slug,
        "name": html.unescape(t.group(1)) if t else slug,
        "tagline": html.unescape(d.group(1)) if d else "",
        "prizes": prizes,
        "desc": " ".join(between("Project Description", "How it's Made"))[:1500],
        "how": " ".join(between("How it's Made", "Join the mailing list"))[:1500],
    }

import os
for ev in EVENTS:
    f = f"w_{ev}.json"
    if os.path.exists(f):
        # refill only the rows whose fetch failed
        old = json.load(open(f))
        good = [r for r in old if r["prizes"]]
        slugs = [r["slug"] for r in old if not r["prizes"]]
    else:
        good, slugs = [], winners(ev)
    with ThreadPoolExecutor(2) as ex:
        rows = list(ex.map(project, slugs))
    rows = good + rows
    for r in rows:
        r["event"] = ev
    json.dump(rows, open(f"w_{ev}.json", "w"), indent=1)
    print(ev, len(rows), sum(any("Finalist" in p for p in r["prizes"]) for r in rows), flush=True)
