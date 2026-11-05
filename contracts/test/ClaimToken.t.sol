// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC1155Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IInvestorRegistry} from "../src/interfaces/IInvestorRegistry.sol";
import {IClaimToken} from "../src/interfaces/IClaimToken.sol";
import {InvestorRegistry} from "../src/InvestorRegistry.sol";
import {ClaimToken, IERC7943MultiToken} from "../src/ClaimToken.sol";

/// @notice InvestorRegistry owner list with expiry (SRS FR-KYC-1).
contract InvestorRegistryTest is Test {
    InvestorRegistry reg;
    address admin = makeAddr("admin");
    address alice = makeAddr("alice");

    function setUp() public {
        reg = new InvestorRegistry(admin);
    }

    function test_UnknownInvestorIsNotEligible() public view {
        assertFalse(reg.isEligible(alice));
        assertFalse(reg.isEligible(address(0)));
        assertEq(reg.owner(), admin);
    }

    function test_EligibleUntilExpiry() public {
        uint64 expiry = uint64(vm.getBlockTimestamp() + 100);
        vm.expectEmit(address(reg));
        emit IInvestorRegistry.EligibilitySet(alice, expiry);
        vm.prank(admin);
        reg.setEligible(alice, expiry);
        assertEq(reg.expiryOf(alice), expiry);
        assertTrue(reg.isEligible(alice));
        vm.warp(expiry - 1);
        assertTrue(reg.isEligible(alice));
        vm.warp(expiry); // expiry is exclusive
        assertFalse(reg.isEligible(alice));
    }

    function test_ZeroExpiryRevokes() public {
        vm.startPrank(admin);
        reg.setEligible(alice, type(uint64).max);
        reg.setEligible(alice, 0);
        vm.stopPrank();
        assertFalse(reg.isEligible(alice));
    }

    function test_RevertWhen_NotOwnerSetsEligible() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        reg.setEligible(alice, type(uint64).max);
    }

    function test_OwnershipTransferNeedsAcceptance() public {
        vm.prank(admin);
        reg.transferOwnership(alice);
        assertEq(reg.owner(), admin); // two-step: nothing changes until alice accepts
        assertEq(reg.pendingOwner(), alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, admin));
        vm.prank(admin);
        reg.acceptOwnership();
        vm.prank(alice);
        reg.acceptOwnership();
        assertEq(reg.owner(), alice);
    }

    function test_RevertWhen_ZeroAddressSetEligible() public {
        vm.expectRevert(InvestorRegistry.ZeroAddress.selector);
        vm.prank(admin);
        reg.setEligible(address(0), type(uint64).max);
    }
}

/// @notice ClaimToken rules T1 and the ERC-7943 views (SRS FR-TOK-1–4, 6, 7).
contract ClaimTokenTest is Test {
    uint256 constant ID = 1;
    uint256 constant ID2 = 2;
    uint64 constant LOCK = 60;

    InvestorRegistry reg;
    ClaimToken token;
    address admin = makeAddr("admin"); // compliance admin: owns the registry and the token
    address market = makeAddr("market");
    address a = makeAddr("a");
    address b = makeAddr("b");
    address stranger = makeAddr("stranger"); // never eligible
    address[] investors; // 9 eligible wallets: investors[0] == a, investors[1] == b

    function setUp() public {
        reg = new InvestorRegistry(admin);
        token = new ClaimToken(reg, admin, LOCK);
        vm.startPrank(admin);
        token.setMarket(market);
        investors.push(a);
        investors.push(b);
        for (uint256 i = 2; i < 9; ++i) {
            investors.push(makeAddr(string.concat("investor", vm.toString(i))));
        }
        for (uint256 i; i < investors.length; ++i) {
            reg.setEligible(investors[i], type(uint64).max);
        }
        vm.stopPrank();
    }

    // ---------- helpers ----------

    function _mint(address to, uint256 id, uint256 amount) internal {
        vm.prank(market);
        token.mint(to, id, amount);
    }

    function _burn(address from, uint256 id, uint256 amount) internal {
        vm.prank(market);
        token.burn(from, id, amount);
    }

    function _send(address from, address to, uint256 id, uint256 amount) internal {
        vm.prank(from);
        token.safeTransferFrom(from, to, id, amount, "");
    }

    function _batch(address from, address to, uint256[] memory ids, uint256[] memory values) internal {
        vm.prank(from);
        token.safeBatchTransferFrom(from, to, ids, values, "");
    }

    function _sameId(uint256 id, uint256 n) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            ids[i] = id;
        }
    }

    function _values(uint256 x, uint256 y) internal pure returns (uint256[] memory v) {
        v = new uint256[](2);
        v[0] = x;
        v[1] = y;
    }

    function _freeze(address account, uint256 id, uint256 amount) internal {
        vm.prank(admin);
        token.setFrozenTokens(account, id, amount);
    }

    function _revoke(address account) internal {
        vm.prank(admin);
        reg.setEligible(account, 0);
    }

    function _fillHolders(uint256 id) internal {
        for (uint256 i; i < 8; ++i) {
            _mint(investors[i], id, 10);
        }
    }

    /// holdersOf(id) lists exactly the investors with a non-zero balance, once each, at most 8.
    function _assertHolders(uint256 id) internal view {
        address[] memory h = token.holdersOf(id);
        assertLe(h.length, token.MAX_HOLDERS());
        uint256 nonZero;
        for (uint256 i; i < investors.length; ++i) {
            if (token.balanceOf(investors[i], id) != 0) ++nonZero;
        }
        assertEq(h.length, nonZero, "holder count");
        for (uint256 i; i < h.length; ++i) {
            assertGt(token.balanceOf(h[i], id), 0, "listed holder has a balance");
            for (uint256 j = i + 1; j < h.length; ++j) {
                assertTrue(h[i] != h[j], "no duplicates");
            }
        }
    }

    // ---------- construction and wiring ----------

    function test_ConstructorSetsState() public {
        assertEq(token.LOCK_WINDOW(), LOCK);
        assertEq(address(token.registry()), address(reg));
        assertEq(token.owner(), admin);
        assertEq(token.market(), market);
        assertEq(token.MAX_HOLDERS(), 8);
        ClaimToken fresh = new ClaimToken(reg, admin, LOCK);
        assertEq(fresh.market(), address(0));
    }

    function test_RevertWhen_ConstructorZeroRegistry() public {
        vm.expectRevert(ClaimToken.ZeroAddress.selector);
        new ClaimToken(IInvestorRegistry(address(0)), admin, LOCK);
    }

    function test_SetMarketIsOneTime() public {
        ClaimToken fresh = new ClaimToken(reg, admin, LOCK);
        vm.expectEmit(address(fresh));
        emit ClaimToken.MarketSet(market);
        vm.prank(admin);
        fresh.setMarket(market);
        assertEq(fresh.market(), market);
        vm.expectRevert(ClaimToken.MarketAlreadySet.selector);
        vm.prank(admin);
        fresh.setMarket(a);
    }

    function test_RevertWhen_SetMarketZeroOrNotOwner() public {
        ClaimToken fresh = new ClaimToken(reg, admin, LOCK);
        vm.expectRevert(ClaimToken.ZeroAddress.selector);
        vm.prank(admin);
        fresh.setMarket(address(0));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, a));
        vm.prank(a);
        fresh.setMarket(market);
    }

    function test_TokenOwnershipTransferNeedsAcceptance() public {
        vm.prank(admin);
        token.transferOwnership(a);
        assertEq(token.owner(), admin);
        assertEq(token.pendingOwner(), a);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, b));
        vm.prank(b);
        token.acceptOwnership();
        vm.prank(a);
        token.acceptOwnership();
        assertEq(token.owner(), a);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, admin));
        vm.prank(admin);
        token.setFrozenTokens(b, ID, 1); // the old admin lost its powers
    }

    // ---------- market-only entry points ----------

    function test_RevertWhen_NotMarketMintsBurnsOrSetsState() public {
        vm.startPrank(admin);
        vm.expectRevert(ClaimToken.NotMarket.selector);
        token.mint(a, ID, 1);
        vm.expectRevert(ClaimToken.NotMarket.selector);
        token.burn(a, ID, 1);
        vm.expectRevert(ClaimToken.NotMarket.selector);
        token.setClaimState(ID, 1, true);
        vm.stopPrank();
    }

    function test_MintTracksSupplyAndHolders() public {
        _mint(a, ID, 60);
        _mint(b, ID, 40);
        _mint(a, ID, 5);
        assertEq(token.totalSupply(ID), 105);
        assertEq(token.balanceOf(a, ID), 65);
        address[] memory h = token.holdersOf(ID);
        assertEq(h.length, 2);
        assertEq(h[0], a);
        assertEq(h[1], b);
    }

    function test_RevertWhen_MintToIneligible() public {
        vm.expectRevert(abi.encodeWithSelector(IERC7943MultiToken.ERC7943CannotReceive.selector, stranger));
        _mint(stranger, ID, 1);
    }

    function test_SetClaimStateStoresAndEmits() public {
        vm.expectEmit(address(token));
        emit IClaimToken.ClaimStateSet(ID, 1000, true);
        vm.prank(market);
        token.setClaimState(ID, 1000, true);
        (uint64 lockFrom, bool frozen) = token.claimState(ID);
        assertEq(lockFrom, 1000);
        assertTrue(frozen);
    }

    // ---------- T1 transfer rules ----------

    function test_TransferBetweenEligibleInvestors() public {
        _mint(a, ID, 100);
        _send(a, b, ID, 30);
        assertEq(token.balanceOf(a, ID), 70);
        assertEq(token.balanceOf(b, ID), 30);
        _assertHolders(ID);
    }

    function test_RevertWhen_SenderIneligible() public {
        _mint(a, ID, 100);
        _revoke(a);
        vm.expectRevert(abi.encodeWithSelector(IERC7943MultiToken.ERC7943CannotSend.selector, a));
        _send(a, b, ID, 1);
    }

    function test_RevertWhen_ReceiverIneligible() public {
        _mint(a, ID, 100);
        vm.expectRevert(abi.encodeWithSelector(IERC7943MultiToken.ERC7943CannotReceive.selector, stranger));
        _send(a, stranger, ID, 1);
    }

    function test_RevertWhen_ReceiverEligibilityExpired() public {
        _mint(a, ID, 100);
        vm.prank(admin);
        reg.setEligible(b, uint64(vm.getBlockTimestamp() + 10));
        vm.warp(vm.getBlockTimestamp() + 10);
        vm.expectRevert(abi.encodeWithSelector(IERC7943MultiToken.ERC7943CannotReceive.selector, b));
        _send(a, b, ID, 1);
    }

    function test_TransferLockedFromLockFrom() public {
        _mint(a, ID, 100);
        uint64 lockFrom = uint64(vm.getBlockTimestamp() + 100);
        vm.prank(market);
        token.setClaimState(ID, lockFrom, false);
        vm.warp(lockFrom - 1);
        _send(a, b, ID, 1); // still open one second before the lock
        vm.warp(lockFrom);
        vm.expectRevert(abi.encodeWithSelector(IERC7943MultiToken.ERC7943CannotTransfer.selector, a, b, ID, 1));
        _send(a, b, ID, 1);
    }

    function test_RevertWhen_ClaimFrozen() public {
        _mint(a, ID, 100);
        vm.prank(market);
        token.setClaimState(ID, 0, true);
        vm.expectRevert(abi.encodeWithSelector(IERC7943MultiToken.ERC7943CannotTransfer.selector, a, b, ID, 1));
        _send(a, b, ID, 1);
        _mint(b, ID2, 5); // other ids are unaffected
        _send(b, a, ID2, 5);
    }

    function test_PartialFreezeBlocksOnlyFrozenUnits() public {
        _mint(a, ID, 100);
        _freeze(a, ID, 70);
        _send(a, b, ID, 30); // exactly the unfrozen part
        vm.expectRevert(
            abi.encodeWithSelector(IERC7943MultiToken.ERC7943InsufficientUnfrozenBalance.selector, a, ID, 1, 0)
        );
        _send(a, b, ID, 1);
    }

    function test_RevertWhen_AmountAboveWholeBalanceUsesBaseError() public {
        _mint(a, ID, 100);
        _freeze(a, ID, 70);
        vm.expectRevert(abi.encodeWithSelector(IERC1155Errors.ERC1155InsufficientBalance.selector, a, 100, 101, ID));
        _send(a, b, ID, 101);
    }

    function test_RevertWhen_NinthHolderMinted() public {
        _fillHolders(ID);
        vm.expectRevert(abi.encodeWithSelector(ClaimToken.TooManyHolders.selector, ID));
        _mint(investors[8], ID, 1);
    }

    function test_RevertWhen_NinthHolderByTransfer() public {
        _fillHolders(ID);
        vm.expectRevert(abi.encodeWithSelector(ClaimToken.TooManyHolders.selector, ID));
        _send(a, investors[8], ID, 1);
    }

    function test_HolderAtZeroFreesItsSlot() public {
        _fillHolders(ID);
        _send(a, investors[8], ID, 10); // a leaves, investor8 joins in the same transfer
        assertEq(token.balanceOf(a, ID), 0);
        _assertHolders(ID);
        _burn(b, ID, 10); // b leaves by settlement
        _mint(a, ID, 1); // a rejoins into b's slot
        assertEq(token.holdersOf(ID).length, 8);
        _assertHolders(ID);
    }

    function test_RevokedInvestorStillBurnable() public {
        _mint(a, ID, 100);
        _revoke(a);
        vm.prank(market);
        token.setClaimState(ID, uint64(vm.getBlockTimestamp()), true); // locked and frozen too
        _freeze(a, ID, 100);
        _burn(a, ID, 100);
        assertEq(token.balanceOf(a, ID), 0);
        assertEq(token.totalSupply(ID), 0);
        assertEq(token.holdersOf(ID).length, 0);
    }

    function test_BatchTransferAppliesRulesPerId() public {
        _mint(a, ID, 10);
        _mint(a, ID2, 10);
        vm.prank(market);
        token.setClaimState(ID2, 0, true);
        uint256[] memory ids = new uint256[](2);
        uint256[] memory values = new uint256[](2);
        ids[0] = ID;
        ids[1] = ID2;
        values[0] = 4;
        values[1] = 4;
        vm.expectRevert(abi.encodeWithSelector(IERC7943MultiToken.ERC7943CannotTransfer.selector, a, b, ID2, 4));
        vm.prank(a);
        token.safeBatchTransferFrom(a, b, ids, values, "");

        ids[1] = ID; // same id twice: 4 + 6 moves a's whole balance
        values[1] = 6;
        vm.prank(a);
        token.safeBatchTransferFrom(a, b, ids, values, "");
        assertEq(token.balanceOf(b, ID), 10);
        _assertHolders(ID);
        assertEq(token.holdersOf(ID)[0], b);
    }

    function test_RevertWhen_BatchArrayLengthMismatch() public {
        _mint(a, ID, 10);
        uint256[] memory ids = new uint256[](2);
        uint256[] memory values = new uint256[](1);
        vm.expectRevert(abi.encodeWithSelector(IERC1155Errors.ERC1155InvalidArrayLength.selector, 2, 1));
        vm.prank(a);
        token.safeBatchTransferFrom(a, b, ids, values, "");
    }

    function test_RevertWhen_BatchRepeatsAnIdPastTheUnfrozenBalance() public {
        _mint(a, ID, 100);
        _freeze(a, ID, 60); // 40 unfrozen
        uint256[] memory values = new uint256[](3);
        values[0] = 40;
        values[1] = 40;
        values[2] = 20; // each entry fits the 40 unfrozen; together they would move all 100
        vm.expectRevert(
            abi.encodeWithSelector(IERC7943MultiToken.ERC7943InsufficientUnfrozenBalance.selector, a, ID, 80, 40)
        );
        _batch(a, b, _sameId(ID, 3), values);
        assertFalse(token.canTransfer(a, b, ID, 100)); // the batch total, as one query
        assertEq(token.balanceOf(a, ID), 100);

        // Past the whole balance, ERC-1155's own error still wins.
        vm.expectRevert(abi.encodeWithSelector(IERC1155Errors.ERC1155InsufficientBalance.selector, a, 60, 70, ID));
        _batch(a, b, _sameId(ID, 2), _values(40, 70));

        _batch(a, b, _sameId(ID, 2), _values(20, 20)); // within the unfrozen balance in total
        assertEq(token.balanceOf(a, ID), 60);
        assertEq(token.getFrozenTokens(a, ID), 60);
        vm.expectRevert(
            abi.encodeWithSelector(IERC7943MultiToken.ERC7943InsufficientUnfrozenBalance.selector, a, ID, 1, 0)
        );
        _batch(a, b, _sameId(ID, 2), _values(0, 1)); // nothing unfrozen is left
    }

    function test_BatchRepeatingAnIdCountsOnceForTheHolderCap() public {
        _fillHolders(ID); // a holds 10
        address newcomer = investors[8];
        vm.expectRevert(abi.encodeWithSelector(ClaimToken.TooManyHolders.selector, ID));
        _batch(a, newcomer, _sameId(ID, 2), _values(4, 5)); // a keeps 1: newcomer would be the 9th
        _batch(a, newcomer, _sameId(ID, 2), _values(4, 6)); // a leaves, newcomer takes its slot
        assertEq(token.holdersOf(ID).length, 8);
        _assertHolders(ID);
    }

    // ---------- burn and the frozen amount (ERC-7943 permissioned burn) ----------

    function test_BurnAboveUnfrozenLowersFrozenFirst() public {
        _mint(a, ID, 100);
        _freeze(a, ID, 70); // unfrozen 30
        vm.expectEmit(address(token));
        emit IERC7943MultiToken.Frozen(a, ID, 50); // 50 burned, 30 unfrozen used, 20 taken from frozen
        vm.expectEmit(address(token));
        emit IERC1155.TransferSingle(market, a, address(0), ID, 50);
        _burn(a, ID, 50);
        assertEq(token.getFrozenTokens(a, ID), 50);
        assertEq(token.balanceOf(a, ID), 50);
    }

    function test_BurnWithinUnfrozenKeepsFrozen() public {
        _mint(a, ID, 100);
        _freeze(a, ID, 70);
        vm.recordLogs();
        _burn(a, ID, 30);
        assertEq(vm.getRecordedLogs().length, 1); // TransferSingle only, no Frozen
        assertEq(token.getFrozenTokens(a, ID), 70);
    }

    function test_BurnWhenFrozenExceedsBalance() public {
        _mint(a, ID, 100);
        _freeze(a, ID, 150); // frozen may exceed the balance; unfrozen is 0
        _burn(a, ID, 40);
        assertEq(token.getFrozenTokens(a, ID), 110);
    }

    function test_RevertWhen_BurnAboveBalance() public {
        _mint(a, ID, 100);
        _freeze(a, ID, 70);
        vm.expectRevert(abi.encodeWithSelector(IERC1155Errors.ERC1155InsufficientBalance.selector, a, 100, 101, ID));
        _burn(a, ID, 101);
    }

    // ---------- canTransfer / canSend / canReceive mirror the rules, never revert ----------

    function test_CanSendAndReceiveFollowRegistry() public view {
        assertTrue(token.canSend(a));
        assertTrue(token.canReceive(a));
        assertFalse(token.canSend(stranger));
        assertFalse(token.canReceive(stranger));
        assertFalse(token.canReceive(address(0)));
    }

    function test_CanTransferMirrorsEveryRule() public {
        _mint(a, ID, 100);
        assertTrue(token.canTransfer(a, b, ID, 100));
        assertFalse(token.canTransfer(a, stranger, ID, 1)); // receiver
        assertFalse(token.canTransfer(stranger, a, ID, 1)); // sender
        assertTrue(token.canTransfer(a, b, 99, 0)); // unknown id, nothing frozen: not a permission issue

        _freeze(a, ID, 70);
        assertTrue(token.canTransfer(a, b, ID, 30));
        assertFalse(token.canTransfer(a, b, ID, 31)); // partial freeze
        _freeze(a, ID, 0);

        uint64 lockFrom = uint64(vm.getBlockTimestamp() + 100);
        vm.prank(market);
        token.setClaimState(ID, lockFrom, false);
        assertTrue(token.canTransfer(a, b, ID, 1));
        vm.warp(lockFrom);
        assertFalse(token.canTransfer(a, b, ID, 1)); // lock

        vm.prank(market);
        token.setClaimState(ID, 0, true);
        assertFalse(token.canTransfer(a, b, ID, 1)); // claim frozen

        vm.prank(market);
        token.setClaimState(ID, 0, false);
        assertTrue(token.canTransfer(a, b, ID, 1));
        _revoke(a);
        assertFalse(token.canTransfer(a, b, ID, 1)); // sender revoked
    }

    function test_CanTransferMirrorsHolderCap() public {
        _fillHolders(ID);
        address newcomer = investors[8];
        assertFalse(token.canTransfer(a, newcomer, ID, 1)); // would be the 9th holder
        assertTrue(token.canTransfer(a, newcomer, ID, 10)); // a leaves, so the slot frees
        assertTrue(token.canTransfer(a, b, ID, 1)); // existing holder
        assertTrue(token.canTransfer(a, newcomer, ID, 0)); // nothing moves
        _send(a, newcomer, ID, 10);
        _assertHolders(ID);
    }

    // ---------- ERC-165 ----------

    function test_SupportsInterfaces() public view {
        assertEq(type(IERC7943MultiToken).interfaceId, bytes4(0x41c4fbad));
        assertTrue(token.supportsInterface(0x41c4fbad));
        assertTrue(token.supportsInterface(0xd9b67a26)); // ERC-1155
        assertTrue(token.supportsInterface(0x0e89341c)); // ERC-1155 metadata URI
        assertTrue(token.supportsInterface(type(IERC165).interfaceId));
        assertFalse(token.supportsInterface(0xffffffff));
    }

    // ---------- compliance admin: setFrozenTokens, forcedTransfer ----------

    function test_SetFrozenTokensOverwritesAndEmits() public {
        _mint(a, ID, 10);
        vm.expectEmit(address(token));
        emit IERC7943MultiToken.Frozen(a, ID, 25);
        vm.prank(admin);
        assertTrue(token.setFrozenTokens(a, ID, 25)); // more than the balance is allowed
        _freeze(a, ID, 5); // overwrite, not a delta
        assertEq(token.getFrozenTokens(a, ID), 5);
    }

    function test_RevertWhen_NotAdminFreezesOrForces() public {
        _mint(a, ID, 10);
        vm.startPrank(market);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, market));
        token.setFrozenTokens(a, ID, 1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, market));
        token.forcedTransfer(a, b, ID, 1);
        vm.stopPrank();
    }

    function test_ForcedTransferIgnoresLockFreezeAndSenderEligibility() public {
        _mint(a, ID, 100);
        _freeze(a, ID, 80);
        _revoke(a);
        vm.prank(market);
        token.setClaimState(ID, uint64(vm.getBlockTimestamp()), true);

        vm.expectEmit(address(token));
        emit IERC7943MultiToken.Frozen(a, ID, 10); // 90 forced, 20 unfrozen used, 70 taken from frozen
        vm.expectEmit(address(token));
        emit IERC1155.TransferSingle(admin, a, b, ID, 90);
        vm.expectEmit(address(token));
        emit IERC7943MultiToken.ForcedTransfer(a, b, ID, 90);
        vm.prank(admin);
        assertTrue(token.forcedTransfer(a, b, ID, 90));

        assertEq(token.balanceOf(a, ID), 10);
        assertEq(token.balanceOf(b, ID), 90);
        assertEq(token.getFrozenTokens(a, ID), 10);
        _assertHolders(ID);
    }

    function test_ForcedTransferOfEverythingMovesTheHolderSlot() public {
        _fillHolders(ID);
        vm.prank(admin);
        token.forcedTransfer(a, investors[8], ID, 10);
        _assertHolders(ID);
        assertEq(token.holdersOf(ID).length, 8);
    }

    function test_RevertWhen_ForcedTransferBreaksHolderCap() public {
        _fillHolders(ID);
        vm.expectRevert(abi.encodeWithSelector(ClaimToken.TooManyHolders.selector, ID));
        vm.prank(admin);
        token.forcedTransfer(a, investors[8], ID, 1);
    }

    function test_RevertWhen_ForcedTransferInvalid() public {
        _mint(a, ID, 10);
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(IERC7943MultiToken.ERC7943CannotReceive.selector, stranger));
        token.forcedTransfer(a, stranger, ID, 1);
        vm.expectRevert(abi.encodeWithSelector(IERC1155Errors.ERC1155InvalidReceiver.selector, address(0)));
        token.forcedTransfer(a, address(0), ID, 1);
        vm.expectRevert(abi.encodeWithSelector(IERC1155Errors.ERC1155InvalidSender.selector, address(0)));
        token.forcedTransfer(address(0), b, ID, 1);
        vm.expectRevert(abi.encodeWithSelector(IERC1155Errors.ERC1155InsufficientBalance.selector, a, 10, 11, ID));
        token.forcedTransfer(a, b, ID, 11);
        vm.stopPrank();
    }

    function test_RevertWhen_ForcedTransferToNonReceiverContract() public {
        _mint(a, ID, 10);
        vm.prank(admin);
        reg.setEligible(address(this), type(uint64).max); // eligible, but no onERC1155Received
        vm.expectRevert(abi.encodeWithSelector(IERC1155Errors.ERC1155InvalidReceiver.selector, address(this)));
        vm.prank(admin);
        token.forcedTransfer(a, address(this), ID, 1);
    }

    // ---------- holdersOf across a mix of operations ----------

    function test_HoldersOfAfterMixedOperations() public {
        _mint(a, ID, 50);
        _mint(b, ID, 50);
        _mint(investors[2], ID, 50);
        _send(a, investors[3], ID, 20);
        _send(b, a, ID, 50); // b leaves
        _assertHolders(ID);
        _burn(investors[2], ID, 50); // investor2 leaves by settlement
        _send(investors[3], b, ID, 5); // b rejoins
        _send(a, a, ID, 10); // self-transfer changes nothing
        _send(a, b, ID, 0); // zero transfer changes nothing
        _send(investors[4], investors[5], ID, 0); // zero transfer between non-holders adds nobody
        _assertHolders(ID);
        assertEq(token.holdersOf(ID).length, 3);
        assertEq(token.holdersOf(ID2).length, 0);

        _burn(a, ID, 80);
        _burn(b, ID, 5);
        _burn(investors[3], ID, 15);
        assertEq(token.holdersOf(ID).length, 0);
        assertEq(token.totalSupply(ID), 0);
    }

    function testFuzz_HoldersMatchBalances(uint256 seed) public {
        for (uint256 step; step < 24; ++step) {
            uint256 r = uint256(keccak256(abi.encode(seed, step)));
            address from = investors[r % 9];
            address to = investors[(r >> 8) % 9];
            uint256 bal = token.balanceOf(from, ID);
            uint256 op = (r >> 16) % 3;
            if (op == 0) {
                if (token.holdersOf(ID).length < 8 || bal != 0) _mint(from, ID, 1 + ((r >> 24) % 20));
            } else if (bal != 0) {
                uint256 amount = 1 + ((r >> 24) % bal);
                if (op == 1) {
                    _burn(from, ID, amount);
                } else if (token.canTransfer(from, to, ID, amount)) {
                    _send(from, to, ID, amount);
                }
            }
            _assertHolders(ID);
        }
    }
}
