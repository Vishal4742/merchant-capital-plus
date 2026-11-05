#!/usr/bin/env python3
"""Status board: phase progress, every lane's batches with their verdicts, and what claude-research verified.

Usage: python3 tools/status.py   (read-only; reads PHASES.md, HANDOFF_LOG.md and .batches/ in every git worktree)
Sources of truth: PHASES.md ticks (tasks), round-N/*.md first lines (tester, reviewers, ci),
HANDOFF_LOG.md lines containing "VERIFIED <batch or gate>" (written by claude-research after its own check).
"""
import pathlib, re, subprocess, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
LANES = {"main": "claude-frontend", "contracts": "claude-contracts", "relayer": "claude-relayer", "sdk": "claude-sdk"}
VERDICTS = ["test", "review-code", "review-security", "review-ux-ui", "ci"]


def worktrees():
    out = subprocess.run(["git", "-C", str(ROOT), "worktree", "list", "--porcelain"], capture_output=True, text=True).stdout
    trees, path = [], None
    for line in out.splitlines():
        if line.startswith("worktree "):
            path = pathlib.Path(line.split(" ", 1)[1])
        elif line.startswith("branch "):
            trees.append((path, line.rsplit("/", 1)[-1]))
    return trees


def first_line(p):
    try:
        return p.read_text(errors="replace").splitlines()[0].strip()
    except (OSError, IndexError):
        return ""


def last_commit(path):
    r = subprocess.run(["git", "-C", str(path), "log", "-1", "--format=%h %cr · %s"], capture_output=True, text=True)
    return r.stdout.strip()[:90]


def batch_state(bdir, active, verified):
    rounds = sorted(bdir.glob("round-*"), key=lambda p: int(p.name.split("-")[1]) if p.name.split("-")[1].isdigit() else 0)
    build = next(iter(sorted(bdir.glob("build-*.md"))), None)
    marks = []
    if rounds:
        last = rounds[-1]
        for v in VERDICTS:
            line = first_line(last / f"{v}.md")
            marks.append(f"{v}:" + ("PASS" if line == "VERDICT: PASS" else "CHANGES" if line == "VERDICT: CHANGES" else "—"))
        passed = sum(m.endswith("PASS") for m in marks)
    else:
        passed = 0
    if bdir.name != active and passed == 5:
        state = "CLOSED (5/5 PASS)"
    elif rounds and any(not m.endswith("—") for m in marks):
        state = f"{rounds[-1].name}: {passed}/5 PASS"
    elif build:
        state = "built, awaiting tester" if first_line(build) == "STATUS: READY" else f"building ({first_line(build) or 'no status yet'})"
    else:
        state = "spec / building"
    check = "  ✔ research-verified" if bdir.name in verified else ""
    detail = ("  [" + " ".join(marks) + "]") if rounds and any(not m.endswith("—") for m in marks) else ""
    return f"{bdir.name}: {state}{check}{detail}"


def phases():
    text = (ROOT / "PHASES.md").read_text()
    rows = []
    for m in re.finditer(r"^## Phase (\d+): (.+?)\n(.*?)(?=^## |\Z)", text, re.S | re.M):
        n, name, body = m.group(1), m.group(2), m.group(3)
        done, total = len(re.findall(r"^- \[x\]", body, re.M)), len(re.findall(r"^- \[[ x]\]", body, re.M))
        gate = re.search(r"\*\*Gate (G\d)", body)
        rows.append((n, name, done, total, gate.group(1) if gate else ""))
    return rows


def main():
    log = (ROOT / "HANDOFF_LOG.md").read_text() if (ROOT / "HANDOFF_LOG.md").exists() else ""
    verified = set(re.findall(r"VERIFIED ([0-9]{3}-P\d-[\w-]+|G\d)", log))
    print(f"Merchant Capital+ status · {time.strftime('%a %H:%M')} IST\n")
    print("Phases (tasks ticked in PHASES.md · gate):")
    for n, name, done, total, gate in phases():
        g = f"{gate} ✔ verified" if gate in verified else f"{gate} open" if gate else ""
        bar = "█" * done + "░" * (total - done)
        print(f"  P{n} {name[:38]:<38} {done}/{total} {bar:<9} {g}")
    print("\nLanes (batches · last round's verdicts: tester, 3 reviewers, ci):")
    for path, branch in worktrees():
        bdir = path / ".batches"
        active = first_line(bdir / "ACTIVE") if (bdir / "ACTIVE").exists() else ""
        lane = LANES.get(branch, branch)
        def owner(b):
            m = re.search(r"Owner lane: (claude-[a-z]+)", (b / "batch.md").read_text(errors="replace")) if (b / "batch.md").exists() else None
            return m.group(1) if m else lane
        # merged batches appear in every checkout: show each one only under its owner lane
        batches = sorted(d for d in bdir.glob("[0-9][0-9][0-9]-P*") if d.is_dir() and owner(d) == lane) if bdir.exists() else []
        print(f"  {lane:<17} {branch:<10} {path.name:<20} last commit {last_commit(path)}")
        for b in batches:
            print(f"      {'▶ ' if b.name == active else '  '}{batch_state(b, active, verified)}")
        if not batches:
            print("        no batches yet")


if __name__ == "__main__":
    main()
