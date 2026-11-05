#!/usr/bin/env python3
"""agentbus: file-based messaging between agents/sessions (Claude Code, zcode, humans).

  agentbus.py send  --as NAME --to NAME|all "message"
  agentbus.py read  --as NAME            # unread messages for NAME, marks them read
  agentbus.py watch --as NAME [--timeout S]  # block until a message arrives, print it, exit
  agentbus.py log   [-n N]               # whole conversation
  agentbus.py who                        # names seen on the bus
  agentbus.py hook EVENT --as NAME [--wait S]  # for Claude-Code-style hooks (Claude Code, ZCode, ...)
      EVENT=session|prompt : inject unread messages as context (SessionStart / UserPromptSubmit)
      EVENT=stop   : wait up to S seconds for a message; if one arrives, block the stop so the
                     agent wakes up and handles it (this is what makes delivery push, not pull)

Bus dir: $AGENTBUS_DIR or ~/.agentbus (machine-wide, any folder, any agent of this user).
"""
import argparse, fcntl, json, os, re, sys, time
from datetime import datetime

BUS = os.environ.get("AGENTBUS_DIR", os.path.expanduser("~/.agentbus"))
LOG = os.path.join(BUS, "messages.jsonl")

# Hard floor: the bus is a plain-text log every agent reads, so secrets never go on it.
# 0x-prefixed 64-hex (tx hashes) is allowed; a bare 64-hex string is how private keys sit in .env files.
SECRET = re.compile(
    r"(?<![0-9a-fA-Fx])[0-9a-fA-F]{64}(?![0-9a-fA-F])"
    r"|\bsk-[A-Za-z0-9_-]{20,}"
    r"|-----BEGIN [A-Z ]*PRIVATE KEY"
    r"|\b(PRIVATE_KEY|MNEMONIC|SECRET|API_KEY|TOKEN)\s*[=:]\s*\S{8,}",
    re.I,
)


def _lines():
    if not os.path.exists(LOG):
        return []
    with open(LOG) as f:
        return [json.loads(l) for l in f if l.strip()]


def send(sender, to, text):
    if SECRET.search(text):
        sys.exit("agentbus: refused, message looks like it contains a secret (key/token). Point to the file instead.")
    os.makedirs(BUS, exist_ok=True)
    msg = {"ts": datetime.now().isoformat(timespec="seconds"), "from": sender, "to": to, "text": text}
    with open(LOG, "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)  # safe concurrent appends from several agents
        f.write(json.dumps(msg) + "\n")
    return msg


def unread(name):
    cur = os.path.join(BUS, f".cursor_{name}")
    seen = int((open(cur).read() if os.path.exists(cur) else "") or 0)
    msgs = _lines()
    mine = [m for m in msgs[seen:] if m["to"] in (name, "all") and m["from"] != name]
    os.makedirs(BUS, exist_ok=True)
    open(cur + ".tmp", "w").write(str(len(msgs)))
    os.replace(cur + ".tmp", cur)  # atomic: concurrent watchers never read a half-written cursor
    return mine


def fmt(m):
    return f"[{m['ts']}] {m['from']} -> {m['to']}: {m['text']}"


def wait_unread(name, timeout):
    # ponytail: 1s polling, switch to fsevents/inotify if latency ever matters
    end = time.time() + timeout if timeout else None
    while not (msgs := unread(name)):
        if end and time.time() > end:
            return []
        time.sleep(1)
    return msgs


def hook_output(event, name, msgs):
    """JSON a Claude-Code-compatible hook prints; None means stay silent."""
    if not msgs:
        return None
    body = "\n".join(map(fmt, msgs))
    howto = f'Reply with: agentbus send --as {name} --to <sender> "..."'
    if event == "stop":
        return {"decision": "block", "reason": f"New agentbus messages for {name}:\n{body}\nHandle them now. {howto}"}
    return {"hookSpecificOutput": {"hookEventName": "SessionStart" if event == "session" else "UserPromptSubmit",
                                   "additionalContext": f"Unread agentbus messages for {name}:\n{body}\n{howto}"}}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("send"); s.add_argument("--as", dest="name", required=True); s.add_argument("--to", required=True); s.add_argument("text", nargs="+")
    r = sub.add_parser("read"); r.add_argument("--as", dest="name", required=True)
    w = sub.add_parser("watch"); w.add_argument("--as", dest="name", required=True); w.add_argument("--timeout", type=float, default=0)
    l = sub.add_parser("log"); l.add_argument("-n", type=int, default=50)
    sub.add_parser("who")
    h = sub.add_parser("hook"); h.add_argument("event", choices=["session", "prompt", "stop"]); h.add_argument("--as", dest="name", required=True); h.add_argument("--wait", type=float, default=600)
    a = p.parse_args(argv)

    if a.cmd == "send":
        print("sent", fmt(send(a.name, a.to, " ".join(a.text))))
    elif a.cmd == "read":
        msgs = unread(a.name)
        print("\n".join(map(fmt, msgs)) if msgs else "(no new messages)")
    elif a.cmd == "watch":
        msgs = wait_unread(a.name, a.timeout)
        if not msgs:
            print("(timeout, no messages)"); return 1
        print("\n".join(map(fmt, msgs)))
    elif a.cmd == "hook":
        sys.stdin.read() if not sys.stdin.isatty() else None  # hook payload; not needed
        msgs = wait_unread(a.name, a.wait) if a.event == "stop" else unread(a.name)
        out = hook_output(a.event, a.name, msgs)
        if out:
            print(json.dumps(out))
    elif a.cmd == "log":
        print("\n".join(map(fmt, _lines()[-a.n:])) or "(empty)")
    elif a.cmd == "who":
        print(", ".join(sorted({m["from"] for m in _lines()} | {m["to"] for m in _lines()} - {"all"})) or "(nobody yet)")
    return 0


def _selfcheck():
    import tempfile
    global BUS, LOG
    BUS = tempfile.mkdtemp(); LOG = os.path.join(BUS, "messages.jsonl")
    send("claude", "zcode", "hi")
    send("zcode", "all", "hello everyone")
    send("claude", "human", "not for zcode")
    assert [m["text"] for m in unread("zcode")] == ["hi"]
    assert unread("zcode") == []  # cursor advanced
    assert [m["text"] for m in unread("claude")] == ["hello everyone"]  # broadcast, own msgs skipped
    assert [m["text"] for m in unread("human")] == ["hello everyone", "not for zcode"]
    assert hook_output("stop", "zcode", []) is None  # nothing new -> let the agent stop
    send("claude", "zcode", "wake up")
    out = hook_output("stop", "zcode", wait_unread("zcode", 2))
    assert out["decision"] == "block" and "wake up" in out["reason"]
    send("claude", "zcode", "fyi")
    out = hook_output("prompt", "zcode", unread("zcode"))
    assert "fyi" in out["hookSpecificOutput"]["additionalContext"]
    send("claude", "zcode", "tx 0x" + "ab" * 32 + " confirmed")  # tx hashes pass
    for leak in ["key " + "ab" * 32, "PRIVATE_KEY=0xdeadbeefcafe", "sk-ant-" + "x" * 30]:
        try:
            send("claude", "zcode", leak)
            raise AssertionError("leaked: " + leak)
        except SystemExit:
            pass
    print("selfcheck ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["selfcheck"]:
        _selfcheck()
    else:
        sys.exit(main())
