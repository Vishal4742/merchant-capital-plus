#!/usr/bin/env python3
"""20 Merchant (ShelfShare rehearsal) Figma build scripts — BLOCKED 2026-10-25 by Starter quota.

Usage: python3 figma-merchant-build.py <overview|loans|modal|empty>  -> writes /tmp/req_fig.json
       then POST it to mcp.figma.com (tools/call use_figma) with the Bearer token from
       ~/.zcode/cli/figma-mcp-oauth.json — see /tmp/figmacall.sh pattern in HANDOFF log.

Reusable for Thursday's PayKit build: BOILER has the verified Figma Plugin API patterns
(variable binding incl. spacing/corner fields, component instancing + variant setProperties,
nested-badge relabel, FILL-after-append ordering, font loading, page switching).
Component/variable/style IDs in BOILER are rehearsal-file-specific — regenerate from
figma-rehearsal-state.json equivalent on Thursday. Mind paid-plan per-minute caps (10/min Prof).

"""
#!/usr/bin/env python3
"""Builds use_figma JSON payloads for the 20 Merchant rehearsal frames."""
import json, sys

SESSION = "f3441b20-6061-4d71-80b4-83dc10cdea3e"
FILEKEY = "ZIHZ0QdzQNshSQhZwIjeCp"

BOILER = r'''
// ---- shared boilerplate (repeat per call: no state persists) ----
const IDS = {
  btnSet: '3:27', badgeSet: '3:36', inputSet: '3:50', card: '3:51', row: '3:54',
  btn: { primDef: '3:9', primLoad: '3:11', primDis: '3:13', secDef: '3:15', secLoad: '3:17', secDis: '3:19', ghostDef: '3:21', ghostLoad: '3:23', ghostDis: '3:25' },
  badge: { Success: '3:28', Warning: '3:30', Danger: '3:32', Neutral: '3:34' },
  input: { Default: '3:37', Focus: '3:41', Error: '3:45' },
};
const VAR = { canvas:'2:21', surface:'2:22', subtle:'2:23', accent:'2:24', success:'2:25', warning:'2:26', danger:'2:27', textPrimary:'2:28', textSecondary:'2:29', onAccent:'2:30', textSuccess:'2:31', textWarning:'2:32', textDanger:'2:33', border:'2:34', borderStrong:'2:35', xs:'2:37', sm:'2:38', md:'2:39', lg:'2:40', xl:'2:41', xxl:'2:42', rsm:'2:43', rmd:'2:44', rlg:'2:45' };
const V = {};
for (const [k, id] of Object.entries(VAR)) V[k] = figma.variables.getVariableById('VariableID:' + id);
const STY = { display:'4f58266db3bdfcc4b87973eb8f4d304c58f528c1', h1:'29725cab4d1a9829c15c70cb59f1229197e30369', h2:'13a7f15dd150013452d77dfe5e5b64bb478580f7', body:'f3b546f9e06301f642901c0c866da62644c2150e', bodyStrong:'dfc92f5f75bff554cc00114c778e91d40af01648', caption:'09fc6d49df9eb6385c123f3b53b7fb18cbdc4f78', label:'d1b9c73f074a7209168e7cb34223c657e2948959' };
const T = {};
for (const [k, key] of Object.entries(STY)) T[k] = await figma.getTextStyleByIdAsync('S:' + key);

await Promise.all(['Regular','Medium','Semi Bold','Bold'].map(s => figma.loadFontAsync({ family: 'Inter', style: s })));
const page = await figma.getNodeByIdAsync('2:3');
await figma.setCurrentPageAsync(page);
const created = [];
const CREATED = n => { created.push(n.id); return n; };

function fillVar(node, v) { node.fills = [v.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } })]; }
function bindCorners(node, rv) { for (const f of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius']) node.setBoundVariable(f, rv); }
function bindPad(node, v, sides) { for (const s of sides) node.setBoundVariable('padding' + s[0].toUpperCase() + s.slice(1), v); }
function AL(mode) { const f = (typeof figma.createAutoLayout === 'function') ? figma.createAutoLayout() : (() => { const x = figma.createFrame(); x.layoutMode = mode; return x; })(); if (f.layoutMode !== mode) f.layoutMode = mode; return f; }
function txt(chars, style, fillsVar) {
  const t = figma.createText();
  t.characters = chars;
  if (style) t.textStyleId = style.id;
  if (fillsVar) fillVar(t, fillsVar);
  return CREATED(t);
}
async function loadNodeFont(t) { const fn = t.fontName; if (fn && fn !== figma.mixed) await figma.loadFontAsync(fn); }
async function comp(id) { return await figma.getNodeByIdAsync(id); }
async function relabel(inst, label) { const t = inst.findOne(n => n.type === 'TEXT'); if (t) { await loadNodeFont(t); t.characters = label; } return inst; }
async function mkButton(variantId, label) { return CREATED(await relabel((await comp(variantId)).createInstance(), label)); }
async function mkCard(title, body) { const i = CREATED((await comp(IDS.card)).createInstance()); const kids = i.findAll(n => n.type === 'TEXT'); for (const k of kids) await loadNodeFont(k); if (kids.find(k => k.name === 'Title')) kids.find(k => k.name === 'Title').characters = title; if (kids.find(k => k.name === 'Body')) kids.find(k => k.name === 'Body').characters = body; return i; }
async function mkBadge(tone, label) { return CREATED(await relabel((await comp(IDS.badge[tone])).createInstance(), label)); }
async function mkInput(state, label) { return CREATED(await relabel((await comp(IDS.input[state])).createInstance(), label)); }
async function mkRow(primary, secondary, amount, tone, statusLabel) {
  const inst = CREATED((await comp(IDS.row)).createInstance());
  for (const nm of ['Primary','Secondary','Amount']) { const t = inst.children.find(c => c.name === nm); if (t) { await loadNodeFont(t); t.characters = { Primary: primary, Secondary: secondary, Amount: amount }[nm]; } }
  const st = inst.findOne(n => n.type === 'INSTANCE');
  if (st) { st.setProperties({ Tone: tone }); const t = st.findOne(n => n.type === 'TEXT'); if (t) { await loadNodeFont(t); t.characters = statusLabel; } }
  return inst;
}
async function shell(frameName, x, y, activeNav) {
  const f = figma.createFrame(); f.name = frameName; f.resize(1440, 900); fillVar(f, V.canvas); CREATED(f);
  f.x = x; f.y = y;
  // sidebar
  const sb = AL('VERTICAL'); sb.name = 'Sidebar'; sb.resize(240, 900); fillVar(sb, V.surface);
  sb.primaryAxisSizingMode = 'FIXED'; sb.counterAxisSizingMode = 'FIXED';
  bindPad(sb, V.lg, ['left','right','top']); bindPad(sb, V.md, ['bottom']);
  sb.setBoundVariable('itemSpacing', V.sm); CREATED(sb); f.appendChild(sb);
  sb.appendChild(txt('ShelfShare', T.h2, V.textPrimary));
  sb.appendChild(txt('Marol lending shelf', T.caption, V.textSecondary));
  const spacer0 = AL('VERTICAL'); spacer0.resize(8, 16); spacer0.setBoundVariable('itemSpacing', V.xs); CREATED(spacer0); sb.appendChild(spacer0);
  for (const nm of ['Overview','Loans','Members','Settings']) {
    const it = AL('HORIZONTAL'); it.name = 'Nav / ' + nm;
    it.resize(192, 36); it.primaryAxisSizingMode = 'FIXED'; it.counterAxisSizingMode = 'FIXED';
    bindPad(it, V.sm, ['left','right']); bindPad(it, V.xs, ['top','bottom']);
    it.setBoundVariable('itemSpacing', V.sm); it.setBoundVariable('counterAxisAlignItems' , null); it.counterAxisAlignItems = 'CENTER';
    bindCorners(it, V.rsm); CREATED(it); sb.appendChild(it);
    if (nm === activeNav) { fillVar(it, V.subtle); it.appendChild(txt(nm, T.bodyStrong, V.textPrimary)); }
    else { it.appendChild(txt(nm, T.body, V.textSecondary)); }
  }
  const spacer = AL('VERTICAL'); CREATED(spacer); sb.appendChild(spacer); spacer.layoutSizingVertical = 'FILL'; spacer.layoutSizingHorizontal = 'FILL';
  const acct = AL('VERTICAL'); acct.setBoundVariable('itemSpacing', V.xs); CREATED(acct); sb.appendChild(acct);
  acct.appendChild(txt('Marol Library', T.bodyStrong, V.textPrimary));
  acct.appendChild(txt('member since Oct', T.caption, V.textSecondary));
  // main
  const main = AL('VERTICAL'); main.name = 'Main'; main.resize(1200, 900);
  main.primaryAxisSizingMode = 'FIXED'; main.counterAxisSizingMode = 'FIXED';
  bindPad(main, V.xxl, ['left','right']); bindPad(main, V.xl, ['top','bottom']);
  main.setBoundVariable('itemSpacing', V.xxl); CREATED(main); f.appendChild(main);
  main.x = 240; main.y = 0;
  return { frame: f, main };
}
async function headerRow(title) {
  const h = AL('HORIZONTAL'); h.name = 'Header'; h.primaryAxisAlignItems = 'SPACE_BETWEEN';
  h.counterAxisAlignItems = 'CENTER'; h.setBoundVariable('itemSpacing', V.lg); CREATED(h);
  h.appendChild(txt(title, T.h1, V.textPrimary));
  return h;
}
async function tableCard(name) {
  const c = AL('VERTICAL'); c.name = name; fillVar(c, V.surface); bindCorners(c, V.rlg);
  bindPad(c, V.lg, ['left','right','top','bottom']); c.setBoundVariable('itemSpacing', V.xs); CREATED(c);
  return c;
}
function fillH(n) { n.layoutSizingHorizontal = 'FILL'; return n; }
async function divider(parent) { const r = figma.createRectangle(); r.name = 'Divider'; r.resize(1, 1); fillVar(r, V.border); CREATED(r); parent.appendChild(r); r.layoutSizingHorizontal = 'FILL'; }
'''

def payload(desc, code):
    return {
        "jsonrpc": "2.0", "id": 100, "method": "tools/call",
        "params": {"name": "use_figma", "arguments": {
            "sessionId": SESSION, "fileKey": FILEKEY,
            "skillNames": "resource:figma-use,resource:figma-generate-design",
            "description": desc, "code": code}},
    }

if __name__ == "__main__":
    which = sys.argv[1]
    code = BOILER
    if which == "overview":
        code += r'''
const { frame, main } = await shell('shelf / overview', 0, 0, 'Overview');
const h = await headerRow('Overview');
const btn = await mkButton(IDS.btn.primDef, 'Lend a book');
h.appendChild(btn); main.appendChild(h); fillH(h);
const stats = AL('HORIZONTAL'); stats.name = 'Stats'; stats.setBoundVariable('itemSpacing', V.lg); CREATED(stats); main.appendChild(stats);
for (const [t, b] of [['14','Books on loan'],['2','Overdue'],['38','Returned this month']]) {
  const c = await mkCard(t, b); stats.appendChild(c); fillH(c);
}
const tbl = await tableCard('Loans table');
const hdr = await mkRow('Book', 'Borrower', 'Due', 'Neutral', 'Status');
tbl.appendChild(hdr); fillH(hdr); await divider(tbl);
const rows = [
  ['A Fine Balance', 'Ravindra H.', '12 Nov', 'Success', 'On loan'],
  ['The Wasted Vigil', 'Prakash M.', '28 Oct', 'Danger', 'Overdue'],
  ['Malgudi Days', 'Sneha K.', '03 Nov', 'Success', 'On loan'],
  ['Sacred Games', 'Imran S.', '21 Oct', 'Neutral', 'Returned'],
];
for (const r of rows) { const ri = await mkRow(...r); tbl.appendChild(ri); fillH(ri); }
main.appendChild(tbl); fillH(tbl);
return { frame: frame.id, createdNodeIds: created, counts: { created: created.length } };
'''
    elif which == "loans":
        code += r'''
const { frame, main } = await shell('shelf / loans table', 1540, 0, 'Loans');
const h = await headerRow('Loans');
h.appendChild(await mkButton(IDS.btn.ghostDef, 'Export CSV'));
main.appendChild(h); fillH(h);
const search = await mkInput('Default', 'Search books or borrowers');
main.appendChild(search); fillH(search);
const tbl = await tableCard('All loans');
const hdr = await mkRow('Book', 'Borrower', 'Due', 'Neutral', 'Status');
tbl.appendChild(hdr); fillH(hdr); await divider(tbl);
const rows = [
  ['A Fine Balance', 'Ravindra H.', '12 Nov', 'Success', 'On loan'],
  ['The Wasted Vigil', 'Prakash M.', '28 Oct', 'Danger', 'Overdue'],
  ['Malgudi Days', 'Sneha K.', '03 Nov', 'Success', 'On loan'],
  ['Sea of Poppies', 'Farida K.', '01 Nov', 'Warning', 'Due soon'],
  ['Sacred Games', 'Imran S.', '21 Oct', 'Neutral', 'Returned'],
  ['The God of Small Things', 'Meera D.', '18 Nov', 'Success', 'On loan'],
];
for (const r of rows) { const ri = await mkRow(...r); tbl.appendChild(ri); fillH(ri); }
main.appendChild(tbl); fillH(tbl);
return { frame: frame.id, createdNodeIds: created, counts: { created: created.length } };
'''
    elif which == "modal":
        code += r'''
const { frame, main } = await shell('shelf / return modal', 0, 1000, 'Loans');
const h = await headerRow('Loans'); main.appendChild(h); fillH(h);
const tbl = await tableCard('Loans table');
const hdr = await mkRow('Book', 'Borrower', 'Due', 'Neutral', 'Status');
tbl.appendChild(hdr); fillH(hdr); await divider(tbl);
const mr = await mkRow('The Wasted Vigil', 'Prakash M.', '28 Oct', 'Danger', 'Overdue'); tbl.appendChild(mr); fillH(mr);
main.appendChild(tbl); fillH(tbl);
// overlay
const ov = figma.createRectangle(); ov.name = 'Overlay'; ov.resize(1440, 900);
ov.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.4 }];
ov.x = 0; ov.y = 0; CREATED(ov); frame.appendChild(ov);
// modal card
const m = AL('VERTICAL'); m.name = 'Return modal'; m.resize(480, 320);
m.primaryAxisSizingMode = 'FIXED'; m.counterAxisSizingMode = 'FIXED';
fillVar(m, V.surface); bindCorners(m, V.rlg);
bindPad(m, V.xl, ['left','right','top','bottom']); m.setBoundVariable('itemSpacing', V.lg); CREATED(m);
frame.appendChild(m); m.x = 480; m.y = 270;
m.appendChild(txt("Return 'The Wasted Vigil'", T.h2, V.textPrimary));
m.appendChild(txt('Prakash M. · borrowed 14 Oct · 5 books', T.caption, V.textSecondary));
const seg = AL('HORIZONTAL'); seg.name = 'Return toggle'; seg.setBoundVariable('itemSpacing', V.sm); CREATED(seg); m.appendChild(seg); fillH(seg);
const opt1 = AL('HORIZONTAL'); opt1.name = 'Toggle / Complete'; opt1.resize(220, 40); opt1.primaryAxisSizingMode = 'FIXED'; opt1.counterAxisSizingMode = 'FIXED';
bindPad(opt1, V.md, ['left','right','top','bottom']); opt1.counterAxisAlignItems = 'CENTER'; opt1.primaryAxisAlignItems = 'CENTER'; bindCorners(opt1, V.rsm); CREATED(opt1); seg.appendChild(opt1);
fillVar(opt1, V.accent); opt1.appendChild(txt('Complete return', T.bodyStrong, V.onAccent));
const opt2 = AL('HORIZONTAL'); opt2.name = 'Toggle / Partial'; opt2.resize(220, 40); opt2.primaryAxisSizingMode = 'FIXED'; opt2.counterAxisSizingMode = 'FIXED';
bindPad(opt2, V.md, ['left','right','top','bottom']); opt2.counterAxisAlignItems = 'CENTER'; opt2.primaryAxisAlignItems = 'CENTER'; bindCorners(opt2, V.rsm); CREATED(opt2); seg.appendChild(opt2);
fillVar(opt2, V.subtle); opt2.appendChild(txt('Partial return', T.bodyStrong, V.textSecondary));
const inp = await mkInput('Default', 'Books being returned (e.g. 3 of 5)');
m.appendChild(inp); fillH(inp);
const actions = AL('HORIZONTAL'); actions.name = 'Actions'; actions.setBoundVariable('itemSpacing', V.sm); actions.primaryAxisAlignItems = 'MIN'; CREATED(actions); m.appendChild(actions);
actions.appendChild(await mkButton(IDS.btn.primDef, 'Confirm return'));
actions.appendChild(await mkButton(IDS.btn.ghostDef, 'Cancel'));
return { frame: frame.id, createdNodeIds: created, counts: { created: created.length } };
'''
    elif which == "empty":
        code += r'''
const { frame, main } = await shell('shelf / empty', 1540, 1000, 'Overview');
const hero = AL('VERTICAL'); hero.name = 'Empty state'; hero.resize(1104, 620);
hero.primaryAxisSizingMode = 'FIXED'; hero.counterAxisSizingMode = 'FIXED';
hero.primaryAxisAlignItems = 'CENTER'; hero.counterAxisAlignItems = 'CENTER';
hero.setBoundVariable('itemSpacing', V.lg); CREATED(hero); main.appendChild(hero); fillH(hero);
const dot = figma.createEllipse(); dot.name = 'Hero mark'; dot.resize(96, 96); fillVar(dot, V.subtle); CREATED(dot); hero.appendChild(dot);
hero.appendChild(txt('Set up your shelf', T.h1, V.textPrimary));
hero.appendChild(txt('Get your neighbourhood book shelf lending in three steps.', T.body, V.textSecondary));
const list = AL('VERTICAL'); list.name = 'Checklist'; list.setBoundVariable('itemSpacing', V.sm);
list.counterAxisAlignItems = 'MIN'; CREATED(list); hero.appendChild(list);
const items = [ ['Done', 'Success', 'Create your shelf'], ['1', 'Neutral', 'Add your first books'], ['2', 'Neutral', 'Invite members to join'], ['3', 'Neutral', 'Share your shelf link'] ];
for (const [badge, tone, labelTxt] of items) {
  const it = AL('HORIZONTAL'); it.name = 'Check / ' + labelTxt; it.setBoundVariable('itemSpacing', V.sm);
  it.counterAxisAlignItems = 'CENTER'; CREATED(it); list.appendChild(it);
  it.appendChild(await mkBadge(tone, badge));
  it.appendChild(txt(labelTxt, T.body, V.textPrimary));
}
hero.appendChild(await mkButton(IDS.btn.primDef, 'Add books'));
return { frame: frame.id, createdNodeIds: created, counts: { created: created.length } };
'''
    else:
        raise SystemExit("unknown frame: " + which)
    with open("/tmp/req_fig.json", "w") as f:
        json.dump(payload(f"Build frame {which} (20 Merchant, ShelfShare rehearsal)", code), f)
    print("payload written: /tmp/req_fig.json, code bytes:", len(code))
