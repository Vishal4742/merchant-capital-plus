"""Rough win odds per idea. Edit ENTRANTS after the workshops and re-run: python3 research/odds.py

Model: p(place in track) = min(0.9, places / serious_entrants) * fit
  serious_entrants = entrants * SERIOUS (about half of submissions are incomplete or miss requirements)
  fit = how cleanly the idea meets that track's brief (1.0 = exact match)
Tracks of one sponsor (Whitechain Operate+Scale) merge into one partner prize.
ponytail: assumes tracks are independent; real odds correlate with team quality, so P(any) is optimistic.
"""
SERIOUS = 0.5

# track: (places, avg $ per place, entrants low, entrants high) — entrant counts are guesses
T = {  # entrant ranges from research_notes/Mumbai hackathon idea validation/mumbai_competition.md (estimates)
    "Whitechain Operate": (3, 1667, 15, 35),
    "Whitechain Scale": (2, 1500, 8, 20),
    "Whitechain Tokenize": (2, 2000, 8, 20),  # thin field; CollateralLock + OpenShare already on testnet
    "World Agent Pass": (3, 1667, 40, 90),
    "World IDKit": (2, 1250, 40, 90),
    "ENSv2": (4, 1750, 50, 110),
    "Hedera x402": (3, 2167, 40, 80),
    "0G PC": (3, 1667, 30, 70),
    "EF alt mempool": (3, 1667, 5, 15),
    "Arkiv build": (2, 2000, 15, 30),
    "1inch Aqua": (3, 1667, 10, 25),
    "Chainlink CRE": (1, 1500, 20, 40),
    "0G Physical AI": (2, 2000, 10, 25),
    "EF CROPS": (3, 1167, 15, 40),
    "EF Anon-RPC": (3, 1667, 15, 40),  # EF research guess  # guess: no data on CROPS entrants  # 3rd place is "best on real hardware" -> 2 places for a sim; "thin field" per notes
}

# idea: list of (sponsor group, track, fit)
IDEAS = {  # fit < 1.0 = known weakness vs that track's brief or strong rivals (see notes)
    "LOCKED Pocket money: WC + World + Arkiv": [  # locked 2026-11-05 10:40; no hacked-agent demo
        ("WC", "Whitechain Operate", 0.6),  # OpenBox + GraphPay already there
        ("WC", "Whitechain Scale", 0.8),  # someone already settles x402 on testnet (59 txs, Oct 26-Nov 4)
        ("World", "World Agent Pass", 0.7),  # near-identical past builds (DSAP, Proviso)
        ("Arkiv", "Arkiv build", 0.8),  # on Arkiv's idea list, low "reach"
    ],
    "PayKit (old plan): WC Operate + ENS + IDKit": [
        ("WC", "Whitechain Operate", 0.6),  # head-on with OpenBox/GraphPay
        ("ENS", "ENSv2", 0.8),
        ("World", "World IDKit", 0.8),
    ],
    "1 Agent pocket money / Whitechain": [
        ("WC", "Whitechain Operate", 0.6),  # OpenBox + GraphPay rivals; agent-pays-shop fit unclear
        ("WC", "Whitechain Scale", 0.8),  # someone already settles x402 on testnet (59 txs, Oct 26-Nov 4)
        ("World", "World Agent Pass", 0.7),  # DSAP/Proviso/AgentPass built near-identical things
        ("ENS", "ENSv2", 0.7),
    ],
    "2 Agent on Hedera + 0G": [
        ("Hedera", "Hedera x402", 0.8),  # AgentGate, Glassbox402 already placed
        ("World", "World Agent Pass", 0.8),
        ("0G", "0G PC", 1.0),
    ],
    "3 Stablecoin gas, EIP-8141": [
        ("EF", "EF alt mempool", 0.6),  # EF lists stablecoin paymasters as an example: rivals likely
        ("Arkiv", "Arkiv build", 1.0),  # sponsor directory is original
    ],
    "4 Aqua strategy board": [
        ("1inch", "1inch Aqua", 0.6),  # KYC-only fillers on mainnet; rubric favors new strategies
        ("Arkiv", "Arkiv build", 1.0),
        ("Chainlink", "Chainlink CRE", 1.0),
    ],
    "B Invoice to ITR (freelancer USDT)": [
        ("WC", "Whitechain Operate", 0.8),
        ("Chainlink", "Chainlink CRE", 0.7),  # CRE on chain 1874 unverified
        ("ENS", "ENSv2", 0.8),  # one subname per client
    ],
    "C Names you can trust (verified shops)": [
        ("ENS", "ENSv2", 1.0),  # ENSv2 subregistry: non-transferable, revocable names
        ("World", "World IDKit", 1.0),  # one human per shop name = minimum sufficient assurance
        ("WC", "Whitechain Operate", 0.8),
    ],
    "8 Claim-link payouts": [  # send USDT to a name/handle, claim gasless
        ("WC", "Whitechain Scale", 0.9),
        ("ENS", "ENSv2", 0.8),
        ("World", "World IDKit", 0.8),  # one claim per human
    ],
    "5 Auto-pay rules": [  # scheduled business payments
        ("WC", "Whitechain Operate", 0.7),  # GraphPay already has subscriptions
        ("WC", "Whitechain Scale", 0.9),
        ("Chainlink", "Chainlink CRE", 0.8),  # CRE as the scheduler
    ],
    "S Soundbox for shops": [
        ("WC", "Whitechain Operate", 0.7),
        ("WC", "Whitechain Scale", 0.9),
        ("ENS", "ENSv2", 0.8),
        ("World", "World IDKit", 0.7),  # one cashback per human
    ],
    "G2 Tended game (Arkiv)": [
        ("Arkiv", "Arkiv build", 1.0),
        ("World", "World IDKit", 0.8),
        ("EF", "EF CROPS", 0.7),
    ],
    "G3 Raid boss game (0G)": [
        ("0G", "0G PC", 0.8),
        ("WC", "Whitechain Scale", 0.8),
        ("World", "World IDKit", 0.8),
    ],
    "W1 Merchant Capital (advances repaid from sales)": [
        ("WC", "Whitechain Tokenize", 0.85),  # workshop: Tokenize covers lending; rivals pre-deployed ReceivableMarket etc.
        ("WC", "Whitechain Operate", 0.6),
        ("Arkiv", "Arkiv build", 0.9),  # expiring offers = on Arkiv's idea list
        ("Chainlink", "Chainlink CRE", 0.7),  # CRE reaching chain 1874 unverified
    ],
    "W2 Face ID wallet + World ID recovery": [
        ("WC", "Whitechain Scale", 0.9),  # no WBT, no seed phrase, no chain awareness
        ("World", "World IDKit", 0.8),  # recovery = real trust event
        ("ENS", "ENSv2", 0.7),  # no name service on Whitechain: pay-to-name fills a real gap
    ],
    "W3+ Chargebacks + gasless buyer": [
        ("WC", "Whitechain Operate", 0.8), ("WC", "Whitechain Scale", 0.7),
        ("World", "World IDKit", 0.8), ("Arkiv", "Arkiv build", 0.8),
    ],
    "W3 Chargebacks for stablecoins": [
        ("WC", "Whitechain Operate", 0.8),  # refunds are on the flyer
        ("World", "World IDKit", 0.8),  # one juror per human
        ("Arkiv", "Arkiv build", 0.8),  # dispute cases with expiry
    ],
    "H1 Merchant Capital+ (invoices + advances)": [  # verified vs prize text 17:50
        ("WC", "Whitechain Operate", 0.7), ("WC", "Whitechain Scale", 0.8), ("WC", "Whitechain Tokenize", 0.85),  # workshop: Tokenize covers lending/borrowing too
        ("Arkiv", "Arkiv build", 0.9),  # "listings or offers that expire" is on Arkiv's list
        ("EF", "EF Anon-RPC", 0.85)  # TESTED: tor-js + Nym reach Whitechain via Ankr, ("EF", "EF CROPS", 0.3),  # EF places a project in at most one EF track
    ],
    "H2 Gas in USDT on two chains": [
        ("WC", "Whitechain Scale", 0.9), ("WC", "Whitechain Operate", 0.5),
        ("EF", "EF alt mempool", 0.55),  # devnet: no faucet, may reset
        ("Arkiv", "Arkiv build", 0.8),
    ],
    "H4 Private Face ID wallet": [
        ("WC", "Whitechain Scale", 0.9), ("WC", "Whitechain Operate", 0.5),
        ("EF", "EF Anon-RPC", 0.9), ("EF", "EF CROPS", 0.6), ("Arkiv", "Arkiv build", 0.6),  # Anon-RPC tested
    ],
    "G Courier game (robot coached in words)": [
        ("0G", "0G Physical AI", 0.8),  # sim only; inference latency
        ("World", "World IDKit", 0.8),  # Orb paused in India -> simulator demo
        ("Arkiv", "Arkiv build", 1.0),  # season ladder expires on Arkiv
    ],
}


def p_place(track, fit, entrants):
    places = T[track][0]
    return min(0.9, places / (entrants * SERIOUS)) * fit


def odds(idea, case):  # case 0 = few rivals (low), 1 = many rivals (high)
    groups, ev = {}, 0.0
    for g, track, fit in IDEAS[idea]:
        p = p_place(track, fit, T[track][2 + case])
        groups[g] = 1 - (1 - groups.get(g, 0)) * (1 - p)
        ev += p * T[track][1]
    miss = 1.0
    for p in groups.values():
        miss *= 1 - p
    return 1 - miss, ev


if __name__ == "__main__":
    # self-check: one sure track (0.9 cap) alone gives 90%
    T["_t"] = (3, 1, 1, 1)
    IDEAS["_t"] = [("x", "_t", 1.0)]
    assert abs(odds("_t", 0)[0] - 0.9) < 1e-9
    del T["_t"], IDEAS["_t"]

    print(f"{'idea':36}{'P(>=1 prize)':>16}{'expected $':>16}")
    for idea in IDEAS:
        (hi, ev_hi), (lo, ev_lo) = odds(idea, 0), odds(idea, 1)
        print(f"{idea:36}{lo:7.0%} – {hi:4.0%}{ev_lo:9,.0f} – {ev_hi:,.0f}")
