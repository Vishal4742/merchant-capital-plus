# What wins ETHGlobal finalist slots and partner prizes (qualitative evidence)

Researched 2026-11-05. Scope: what judges, ETHGlobal staff, sponsors and past winners say, plus the written rules. It does not redo the quantitative analysis in `research/ethglobal_winners_11_events.json`. Source quality is marked in each section. Several popular "how to win" guides turned out to be unsourced or AI-generated; they are flagged where used and are not relied on.

## 1. What judges, ETHGlobal staff and sponsor DevRel say they look for, and how finalist judging runs

### Takeaway
The Mumbai rules are explicit. Finalist judging is a 7-minute session (4 min demo, 3 min Q&A) scored on Technicality, Originality, Practicality, Usability (UI/UX/DX) and "WOW Factor". Partner prizes are judged only from submitted materials, and booth visits are optional. What ETHGlobal does not publish: panel size, how many rounds an in-person event uses, or what gets a team cut. Sponsors who publish criteria keep asking for the same three things: integration that is real and findable in the code, onchain proof, and written developer feedback.

### Cited Findings
**Mumbai rules (primary, fetched 2026-11-05)**
- Each finalist team gets "7 minutes to present: 4 minutes for the demo, followed by 3 minutes for Q&A with the judges." Session details appear on the Hacker Dashboard after submission. — [ETHGlobal Mumbai details](https://ethglobal.com/events/mumbai/info/details)
- The five criteria, verbatim: Technicality ("How complex is the problem you're addressing, and how sophisticated is your solution?"), Originality ("Is your project introducing a new idea or creatively solving an existing problem?"), Practicality ("How complete and functional is your project?"), Usability (UI/UX/DX) ("How intuitive is your project?"), WOW Factor ("Does your project leave a lasting impression?"). — [ETHGlobal Mumbai details](https://ethglobal.com/events/mumbai/info/details)
- "Partners will judge submissions based on the project materials you submit." Partner winners are announced at the closing ceremony. — [ETHGlobal Mumbai details](https://ethglobal.com/events/mumbai/info/details)
- Teams can select up to 3 Partner Prizes. "If a partner has multiple tracks, you can be eligible for all of them while only counting as 1 Partner Prize." — [ETHGlobal Mumbai details](https://ethglobal.com/events/mumbai/info/details)
- Deadline: "Saturday, November 7th 2026 at 09:00 am IST"; "Late submissions won't be accepted." — [ETHGlobal Mumbai details](https://ethglobal.com/events/mumbai/info/details)

**Finalist session format at other events (primary)**
- Cannes 2025 lists "Common Questions to Prepare For": "What inspired your project?", "What tools did you use, and why?", "What challenges did you solve, and how?" It says "Visiting partner booths to present your project is optional." Choosing the Finalist option "will require you to present your project to judges in the Finalist judging session." — [ETHGlobal Cannes details](https://ethglobal.com/events/cannes/info/details)
- Singapore 2024: "Head to the judging check-in table, where you'll be prepared for your session." Teams that pick "Partner Prizes Only" have no judging session. Same 7-minute format. — [ETHGlobal Singapore 2024 details](https://ethglobal.com/events/singapore2024/info/details)
- At ETHOnline 2024, teams went to a green room and then a judging room (per search-result summary; not re-read verbatim). — [ETHOnline 2024 details](https://ethglobal.com/events/ethonline2024/info/details)
- For async/online events (Superhack 2023): "The first round is asynchronous, and the second round is live judging at the event." "Typically, only the top 20% of projects advance to the live judging session." The page says this is general to "most async events", not Superhack specifically. — [ETHGlobal Superhack details](https://ethglobal.com/events/superhack/info/details)
- ETHGlobal describes finalist judging as "a Live Judging Session with a panel of industry experts" (quoted on a project's showcase page, not an official rules page). — [GasMonkey showcase](https://ethglobal.com/showcase/gasmonkey-9cap8)
- Judges get a briefing from co-founder Kartik Talwar. A Bangkok 2024 judge posted: "During the @kartiktalwar meeting for judges, I developed an AI judge that simplifies the entire process. It takes notes during the pitch, writes a summary, and provides its own evaluations." — [0xmikko.eth on X, Nov 2024](https://x.com/0xmikko_eth/status/1858049576609132867)

**Finalist counts from ETHGlobal's own posts (matches our ~9/event)**
- Bangkok 2024: 10 finalists "that stuck out to our judges from 713 built." — [ETHGlobal on X](https://x.com/ETHGlobal/status/1858086013576585678)
- Singapore 2024: 10 from 310. — [ETHGlobal on X](https://x.com/ETHGlobal/status/1837771164116263146?lang=en)
- ETHOnline 2024: 8 from 417. — [ETHGlobal on X](https://x.com/ethglobal/status/1834627552914375038)
- Brussels 2024: top 10 of 355 submissions, after "live judging by industry experts." — [ETHGlobal Brussels 2024 recap](https://ethglobal.medium.com/ethglobal-brussels-2024-recap-68512e2502a8)

**What sponsors publish as criteria (primary prize pages)**
- Coinbase Developer Platform, New York 2025: "Product Quality: Is it well-built, useful, and polished? Would someone actually use this?"; "Use of CDP: Higher scores for using more CDP tools but just one is required to qualify"; "Developer Feedback: Did you give thoughtful feedback on what worked and what didn't"; "Social Signal: Did you share your build on X (Twitter) and tag @CoinbaseDev?" (wording via search-result summary). — [ETHGlobal NY 2025 prizes](https://ethglobal.com/events/newyork2025/prizes)
- Uniswap Foundation, New York 2026: transaction IDs showing real onchain execution, a public GitHub repo, a demo video of at most 3 minutes, and a completed Uniswap Developer Feedback Form. Mumbai's Uniswap track also requires FEEDBACK.md plus the form (see `research/mumbai_prizes_2026-11-05.md`). — [ETHGlobal NY 2026 prizes](https://ethglobal.com/events/newyork2026/prizes)
- NEAR, Singapore 2024: creativity, product quality, code readability and documentation, plus "BONUS: Feedback on the chain signatures technology and developer experience." — [ETHGlobal Singapore 2024 prizes](https://ethglobal.com/events/singapore2024/prizes)
- Chainlink, Superhack 2023: you must use Chainlink to make a state change onchain, and "the judges must be able to find the Chainlink use in your code, and only the intention to use is not valid." It also required presenting to Chainlink judges, which conflicts with ETHGlobal's current "booth optional" line. — [ETHGlobal Superhack Chainlink prize](https://ethglobal.com/events/superhack/prizes/chainlink)
- World ID, Singapore 2024: "Proof validation is required and needs to occur in a web backend or smart contract" (via search-result summary). — [ETHGlobal Singapore 2024 prizes](https://ethglobal.com/events/singapore2024/prizes)
- A former Polygon Labs hackathon judge said she saw about 200 projects per judging round and was drawn to projects with strong imagery (June 2024 interview, auto-caption transcript). — [DappaDan "Hackathon Heroes" ep. 5](https://rosetta.to/u/dappadandev/i-asked-a-7-web3-hackathon-winner-how-she-hacks)

### Inferences
- In 4 minutes the judges can see one working flow, not a product tour. The "What tools did you use, and why?" question gives the 3-minute Q&A a chance to show Technicality and sponsor depth.
- Sponsor judges reviewing hundreds of projects from paper need sponsor proof they can find in seconds: tx hashes, file paths, a per-sponsor README section. If a judge has to hunt for it, assume they won't.
- Judges are already using AI to summarise pitches (one confirmed case). A plainly structured README and description probably survives that summarisation better.

### Gaps
- No ETHGlobal source gives panel size, the number of rounds at an in-person event, or how a first-round panel's picks become the roughly 10 finalists. 2026 pages only say a "Finalist judging session" appears on the dashboard. Unverified for Mumbai.
- I found no ETHGlobal staff talk, podcast or blog post on what gets a team cut. Searches for Kartik Talwar interviews on judging returned only opening-ceremony videos.
- No Reddit, Hacker News or X threads by ETHGlobal judges came up in search. X content mostly could not be fetched.

## 2. What past finalists and multi-prize winners say they did

### Takeaway
First-hand ETHGlobal write-ups are scarce and thin. The few that exist share three points: a working, visible demo matters more than ambition; sponsor tech should fit the product rather than be bolted on; and the README and showcase visuals get more attention than teams expect. None of them describes AI-assisted building.

### Cited Findings
- Base42 team (published 23 Apr 2026; event not named) took first place with a multi-agent DeFi system: agents vote on actions, 0G Compute for inference, 0G storage, trades via Uniswap, React UI showing the agent workflow. The visualisation "made a big difference during the demo" because viewers could watch the agents work. They "didn't pick the 0G track strategically"; its compute and storage fit the product. They slept 4–5 hours a night. The project "wasn't just an idea, it was something people could actually try and understand." Main lesson: team chemistry. — [Base42 blog](https://blog.42.mk/how-we-won-ethglobal-with-a-project-called-shawarma-orchestrate/)
- Steph (oceans444), ETHGlobal finalist and multiple Web3 hackathon winner, ex-Polygon Labs judge (June 2024): her first ETHGlobal finalist project "didn't actually submit to any of the prizes". Her rule for sponsor tech: "I'll give a sponsor technology three tries and on the second try I'll go talk to someone from the sponsor"; drop it after the third failure. She spends polish time on README and showcase images "since judges may look at those more than the live app", makes at least one attention-grabbing image in Canva, and documents what does not work in the README instead of hiding it. She plans the first hour as a feature and tech checklist and cuts scope from it. — [DappaDan interview](https://rosetta.to/u/dappadandev/i-asked-a-7-web3-hackathon-winner-how-she-hacks)
- Lisbon 2026 0G track winners (sponsor recap, 17 Aug 2026): the first-place project "0run" used all four 0G components (Compute, Storage, Agentic ID, Chain), "the full-stack winner". Other winners used TEE-attested steps for their trust claims, and one used a Safe 2-of-3 so an agent "cannot spend alone". — [0G Lisbon 2026 recap](https://0g.ai/blog/ethglobal-lisbon-2026-recap)
- Blockscout Prague 2025 winners' advice: "Don't just use Blockscout as an explorer - leverage the full SDK." 81 of 217 projects won Blockscout pool prizes, and 7 of the 10 finalists used Blockscout. — [Blockscout blog, 12 Jun 2025](https://www.blog.blockscout.com/learnings-from-ethglobal-prague)
- An older ETHGlobal winner's write-up (James Bachini, "Winning $4300") reportedly says not to count on prizes whatever the quality, because judging has variance. Per search snippet only; the page returned HTTP 522 twice, so this is unverified. — [jamesbachini.com](https://jamesbachini.com/ethglobal-hackathon/)
- Low-reliability forum advice (BlockEden forum, Nov 2025; persona-like accounts, promotional, no citations): "A $5K bounty with 10 submissions beats a $50K bounty with 500"; "Useful and working beats ambitious and broken"; common mistakes are integrating late (around hour 30), skipping version control, and no backup video. — [BlockEden forum](https://blockeden.xyz/forum/t/ethglobal-buenos-aires-36-hour-hackathon-with-record-prize-pool/184)

### Inferences
- The two most concrete winner accounts (Base42, 0G Lisbon) both won on 0G with agent products that made agent behaviour visible or verifiable. That fits our dataset's finding that agent-payment themes reach finals at about 2x the average rate.
- Using more of one sponsor's stack (0G's 4 of 4, Blockscout's full SDK, CDP's "more tools = higher score") is rewarded explicitly. Depth within one sponsor looks worth more than a fourth shallow sponsor, and Mumbai caps partner prizes at 3 anyway.

### Gaps
- No first-hand finalist write-up gives an hour-by-hour plan for a 36-hour event or says how many tracks they targeted. The Taipei 2025 lessons post ([Medium](https://medium.com/@0xnicholasy.eth/lessons-from-ethglobal-taipei-hackathon-9f3ab215b6aa)) and the Bankless "How to win a hackathon" post ([Medium](https://medium.com/bankless-dao/how-to-win-a-hackathon-ca7e3fca1dff)) both returned HTTP 403. Search snippets only say "keep scope narrow, design around the demo, stick with familiar tools."
- An Indie Hackers HackMoney 2026 finalist diary ([link](https://www.indiehackers.com/post/claimable-hack-money-finalist-day-449-c856ebefce)) returned HTTP 403. It may hold recent AI-era detail.
- Unsourced guides (agentrel "how to win", hackathon.exchange) publish rubric weights such as "technical innovation 30%" that are labelled "patterns" and match no ETHGlobal document. Excluded.

## 3. Common reasons projects lose partner prizes

### Takeaway
Rules and sponsor recaps point to a few repeat failures: the integration can't be found in the code, or is only "intended"; there's no onchain proof (tx IDs, state change); sponsor-required files or forms are missing; the demo video breaks ETHGlobal's format rules; and the git history looks like a dump. Sponsors read code, not just forms. In one case they found more integration than teams had reported, so under-documenting costs you too.

### Cited Findings
- 0G Lisbon 2026: "Judging combined live demos with repo-level review." 10 of 67 submissions lacked verified 0G integration in their repos. 18 of 67 did not demo live even though the recap calls the demo "mandatory" (an internal inconsistency). Teams also under-reported: "Repo review found more 0G Storage and Agentic ID usage than the write-ups claimed", because "starter templates and docs quickstarts wire these components in before a team ever thinks about what to put on the form." — [0G Lisbon 2026 recap](https://0g.ai/blog/ethglobal-lisbon-2026-recap)
- Chainlink: intention to use does not count; the use must be findable in code and cause an onchain state change. — [Superhack Chainlink prize](https://ethglobal.com/events/superhack/prizes/chainlink). For its own hackathon, Chainlink said reading Data Feeds alone was not a valid core-prize submission (via search snippet). — [Chainlink Constellation blog](https://chain.link/blog/introducing-constellation-chainlink-hackathon)
- Uniswap NY 2026 required tx IDs, a public repo, a video of 3 minutes or less and the feedback form. Missing any of these is a requirements miss. — [ETHGlobal NY 2026 prizes](https://ethglobal.com/events/newyork2026/prizes)
- Mumbai "won't qualify" lines, quoted in our prize summary: World Agent Pass rejects a login screen with no action that needs a human; 0G PC rejects AI calls "removable without anyone noticing"; 0G Agents That Pay rejects wallets a human refills; Hedera x402 rejects any human approval step; Whitechain Scale rejects a payer who signs a gas-costing tx; Arkiv rejects an SDK never used for reads. — local file `research/mumbai_prizes_2026-11-05.md` (source: [Mumbai prizes](https://ethglobal.com/events/mumbai/prizes))
- Demo video rules (Mumbai), verbatim: "DO NOT export the video in any resolution less than 720p"; "DO NOT exceed the 4-minute submission length"; "DO NOT speed up the video to fit under the time limit"; "DO NOT play music with text on the video describing your project (instead of talking)"; "DO NOT use mobile phones to record the video submission"; "DO NOT use a text to speech synthesizer / AI Voiceover". Videos under 2 or over 4 minutes are rejected at upload, and flagged videos must be re-submitted. — [ETHGlobal Mumbai details](https://ethglobal.com/events/mumbai/info/details)
- Git history: teams must use version control throughout; "Submissions with large single commits or missing histories may be disqualified." Classic-track projects with pre-event project code "won't qualify for partner prizes or the Finalist category." — [ETHGlobal Mumbai details](https://ethglobal.com/events/mumbai/info/details); same text at [Singapore 2024](https://ethglobal.com/events/singapore2024/info/details)
- Chainlink DevRel's README advice (Apr 2021, older, non-ETHGlobal event): the README is the first thing judges see. Include an overview, the demo video link, a live demo link, an architecture diagram and step-by-step run instructions. Keep keys in env files and keep the repo uncluttered ("less is more"). — [Chainlink blog, H. Papacharissiou](https://chain.link/blog/blockchain-hackathon-tips)
- ETHGlobal SF guidance (older): organizers "have no influence on either the challenge or the judging, this is entirely up to the sponsors." — [ethglobal/ethsanfrancisco-bounties](https://github.com/ethglobal/ethsanfrancisco-bounties)

### Inferences
- Since judges read code and some sponsors (0G, Chainlink) review the repo directly, every sponsor claim in the README should link to the file and line plus a tx hash on an explorer. Verified contracts make that click-through work. No source found says unverified contracts are disqualifying, but an unverified contract makes the "find it in the code" test harder.
- Hard-coded demo values aren't named as a disqualifier in any source I found. 0G's "AI call removable without anyone noticing" and Hedera's "no human approval" rules show sponsors are testing whether the integration is load-bearing, so a mocked path seen in the code would likely fail that test (inference, not sourced).
- The video rules mean a human has to narrate on a laptop screen recording at 720p or higher, in 2–4 minutes and in real time. That has to be planned as a timed task; it can't be left to the last hour.

### Gaps
- No sponsor post-mortem lists specific disqualified projects and the reason. 0G's counts are the closest. The 0G recap is sponsor marketing with self-reported numbers.
- No source on whether partner judges watch the full video or just skim; nothing on how much weight the video carries against the repo.

## 4. Lessons for teams that use AI coding agents heavily, and ETHGlobal's AI rules

### Takeaway
ETHGlobal allows AI tools, but the 2026 rules (Mumbai, NY 2026, HackMoney 2026) require three things: document in the submission where AI was used, down to files or assets; keep a meaningful human contribution; and, for spec-driven workflows, commit "all spec files, prompts, and planning artifacts" so judges can see how the team directed the AI. A submission that "rel[ies] entirely on AI" may lose eligibility for partner prizes and finalist. AI voiceover in the demo video is banned. I found no ETHGlobal-specific write-up by an AI-heavy winning team.

### Cited Findings
- Verbatim, Mumbai: "The use of AI tools (e.g., ChatGPT, Claude Code, GitHub Copilot, Cursor, etc.) is generally permitted"; "Clearly document in your submission where and how AI tools were used in the project. This includes specifying which parts of the code, specific files, or assets were generated or assisted by AI."; "AI tools should be used to assist your development process, not to create the entire project."; "Submissions that rely entirely on AI without meaningful contributions from team members may not be eligible for partner prizes or finalist consideration." — [ETHGlobal Mumbai details](https://ethglobal.com/events/mumbai/info/details)
- Spec-driven workflows, verbatim: "Using spec-driven workflows (e.g., OpenSpec, Kiro, spec-kit) is permitted. If you use one, you must include all spec files, prompts, and planning artifacts in your submission repository. Judges need to see the full picture of how you directed the AI, not just the generated output." — [ETHGlobal Mumbai details](https://ethglobal.com/events/mumbai/info/details)
- The same policy appears at Cannes 2025, NY 2026 and HackMoney 2026, so it has been standard since at least mid-2025. — [Cannes](https://ethglobal.com/events/cannes/info/details); [NY 2026](https://ethglobal.com/events/newyork2026/info/details); [HackMoney 2026](https://ethglobal.com/events/hackmoney/info/details)
- The demo video bans "a text to speech synthesizer / AI Voiceover." — [ETHGlobal Mumbai details](https://ethglobal.com/events/mumbai/info/details)
- Large single commits and missing histories may be disqualified. This applies with extra force to agent-generated code that lands in big batches. — [ETHGlobal Mumbai details](https://ethglobal.com/events/mumbai/info/details)
- Judges use AI too: a Bangkok 2024 judge built an AI note-taker and evaluator during the judges' briefing. — [0xmikko.eth on X](https://x.com/0xmikko_eth/status/1858049576609132867)
- Opinion only (X article, 2026, not ETHGlobal): ETHGlobal judges reward technical depth, native use of Ethereum primitives, and "ready to ship" submissions. — [meta_alchemist on X](https://x.com/meta_alchemist/article/2049846781576622570?lang=en)

### Inferences (checked against our AGENTS.md and HANDOFF setup)
- **Conflict to fix:** AGENTS.md says "No commits or pushes unless the human asks." ETHGlobal says large single commits or missing histories may be disqualified. The human should approve a standing rule now: small commits per lane, at least every hour or two, pushed to the public repo during the event. Multiple agents committing to one repo also makes the per-lane history look real.
- Our HANDOFF.md, ARCHITECTURE.md, HANDOFF_LOG.md and per-lane task briefs count as "planning artifacts". Under the spec-driven rule they should ship in the repo (with secrets scrubbed; agentbus already refuses secrets). An `AI_USAGE.md` mapping files or directories to "agent-written / human-reviewed / human-written" would meet the attribution line. These are inferences from the rule text; ETHGlobal gives no template.
- The "meaningful contributions from team members" test is not defined. The safest evidence is human-authored commits on design decisions, a human narrating the video, and a human answering 3 minutes of live Q&A on why each tool was chosen ("What tools did you use, and why?" is a listed question). Teams that can't explain agent-written code will show it in Q&A.
- The rehearsal/ and design-lab/ practice code must not reach the submission repo (AGENTS.md already says it is deleted before submission). The Classic-track rule disqualifies prior project-specific code from partner prizes and finalist.

### Gaps
- No ETHGlobal statement or judge account says how disclosed AI use affects scoring in practice, or whether any team has been disqualified under the AI rule.
- No ETHGlobal finalist write-up from a team that built mainly with AI agents was found (searches returned Anthropic or AI Tinkerers hackathons instead).
- When the AI rule was introduced is unverified; earliest confirmed page is Cannes (mid-2025).
