// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {ERC1155Utils} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Utils.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IClaimToken} from "./interfaces/IClaimToken.sol";
import {IInvestorRegistry} from "./interfaces/IInvestorRegistry.sol";

/// @notice ERC-7943 (uRWA, Final) multi-token interface, interface id 0x41c4fbad. Copied from the EIP (CC0).
interface IERC7943MultiToken is IERC165 {
    event ForcedTransfer(address indexed from, address indexed to, uint256 indexed tokenId, uint256 amount);
    event Frozen(address indexed account, uint256 indexed tokenId, uint256 amount);

    error ERC7943CannotSend(address account);
    error ERC7943CannotReceive(address account);
    error ERC7943CannotTransfer(address from, address to, uint256 tokenId, uint256 amount);
    error ERC7943InsufficientUnfrozenBalance(address account, uint256 tokenId, uint256 amount, uint256 unfrozen);

    function forcedTransfer(address from, address to, uint256 tokenId, uint256 amount) external returns (bool result);
    function setFrozenTokens(address account, uint256 tokenId, uint256 amount) external returns (bool result);
    function canSend(address account) external view returns (bool allowed);
    function canReceive(address account) external view returns (bool allowed);
    function getFrozenTokens(address account, uint256 tokenId) external view returns (uint256 amount);
    function canTransfer(address from, address to, uint256 tokenId, uint256 amount) external view returns (bool allowed);
}

/// @title ClaimToken: ERC-1155 claims on advances and invoices, with ERC-7943 compliance controls
/// @notice One id per advance or invoice; 1 unit = 0.000001 USDT owed to the holder. CapitalMarket mints on funding,
///         burns on repayment and sets the per-claim lock and freeze. Transfers only move between eligible investors,
///         before the lock, and never more than the unfrozen balance; at most 8 holders per id. Burns are never
///         blocked, so a revoked investor is still repaid. The owner is the compliance admin.
///         (SRS FR-TOK-1–4, 6, 7; ERC-7943)
contract ClaimToken is ERC1155Supply, Ownable, IClaimToken, IERC7943MultiToken {
    uint256 public constant MAX_HOLDERS = 8;

    struct ClaimState {
        uint64 lockFrom; // transfers revert from this timestamp; 0 = no lock
        bool frozen;
    }

    IInvestorRegistry public immutable registry;
    uint64 public immutable LOCK_WINDOW;
    address public market;
    mapping(uint256 id => ClaimState) public claimState;
    mapping(address account => mapping(uint256 id => uint256 amount)) private _frozen;
    // ponytail: bounded list scanned linearly (≤ 8); per-unit accumulator + pull claims if claims need more holders
    mapping(uint256 id => address[] holders) private _holders;

    event MarketSet(address market);

    error ZeroAddress();
    error NotMarket();
    error MarketAlreadySet();
    error TooManyHolders(uint256 id);

    modifier onlyMarket() {
        if (msg.sender != market) revert NotMarket();
        _;
    }

    /// @param lockWindow seconds before maturity when transfers lock; the market reads it to set `lockFrom`
    constructor(IInvestorRegistry registry_, address admin, uint64 lockWindow) ERC1155("") Ownable(admin) {
        if (address(registry_) == address(0)) revert ZeroAddress();
        registry = registry_;
        LOCK_WINDOW = lockWindow;
    }

    /// @notice Owner only, once: the market is fixed for the life of the token.
    function setMarket(address market_) external onlyOwner {
        if (market_ == address(0)) revert ZeroAddress();
        if (market != address(0)) revert MarketAlreadySet();
        market = market_;
        emit MarketSet(market_);
    }

    // ---------- market (IClaimToken) ----------

    /// @inheritdoc IClaimToken
    function mint(address to, uint256 id, uint256 amount) external onlyMarket {
        _mint(to, id, amount, "");
    }

    /// @inheritdoc IClaimToken
    function burn(address from, uint256 id, uint256 amount) external onlyMarket {
        _burn(from, id, amount);
    }

    /// @inheritdoc IClaimToken
    function setClaimState(uint256 id, uint64 lockFrom, bool frozen) external onlyMarket {
        claimState[id] = ClaimState(lockFrom, frozen);
        emit ClaimStateSet(id, lockFrom, frozen);
    }

    /// @inheritdoc IClaimToken
    function holdersOf(uint256 id) external view returns (address[] memory) {
        return _holders[id];
    }

    // ---------- compliance admin (ERC-7943) ----------

    /// @inheritdoc IERC7943MultiToken
    /// @dev Needs an eligible receiver; ignores the lock, the claim freeze, the sender's eligibility and its frozen
    ///      units (lowered first, `Frozen` before `TransferSingle`). Keeps the holder cap.
    function forcedTransfer(address from, address to, uint256 id, uint256 amount) external onlyOwner returns (bool) {
        if (from == address(0)) revert ERC1155InvalidSender(address(0));
        if (to == address(0)) revert ERC1155InvalidReceiver(address(0));
        if (!canReceive(to)) revert ERC7943CannotReceive(to);
        _lowerFrozen(from, id, amount);
        uint256[] memory ids = new uint256[](1);
        uint256[] memory values = new uint256[](1);
        ids[0] = id;
        values[0] = amount;
        _move(from, to, ids, values);
        emit ForcedTransfer(from, to, id, amount);
        ERC1155Utils.checkOnERC1155Received(msg.sender, from, to, id, amount, "");
        return true;
    }

    /// @inheritdoc IERC7943MultiToken
    function setFrozenTokens(address account, uint256 id, uint256 amount) external onlyOwner returns (bool) {
        _frozen[account][id] = amount;
        emit Frozen(account, id, amount);
        return true;
    }

    // ---------- ERC-7943 views (never revert, never write) ----------

    /// @inheritdoc IERC7943MultiToken
    function canSend(address account) public view returns (bool) {
        // forge-lint: disable-next-line(calls-loop) our own registry, a plain mapping read; batches carry few ids
        return registry.isEligible(account);
    }

    /// @inheritdoc IERC7943MultiToken
    function canReceive(address account) public view returns (bool) {
        // forge-lint: disable-next-line(calls-loop) our own registry, a plain mapping read; batches carry few ids
        return registry.isEligible(account);
    }

    /// @inheritdoc IERC7943MultiToken
    function getFrozenTokens(address account, uint256 id) external view returns (uint256) {
        return _frozen[account][id];
    }

    /// @inheritdoc IERC7943MultiToken
    /// @dev Same rules as a public transfer. A plain balance shortfall is left to ERC-1155 (ERC-7943 rule) unless
    ///      units are frozen.
    function canTransfer(address from, address to, uint256 id, uint256 amount) external view returns (bool) {
        return _movable(id) && canSend(from) && canReceive(to)
            && (_frozen[from][id] == 0 || amount <= _unfrozen(from, id)) && _fitsHolderCap(from, to, id, amount);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, IERC165) returns (bool) {
        return interfaceId == type(IERC7943MultiToken).interfaceId || super.supportsInterface(interfaceId);
    }

    function totalSupply(uint256 id) public view override(ERC1155Supply, IClaimToken) returns (uint256) {
        return super.totalSupply(id);
    }

    function balanceOf(address account, uint256 id) public view override(ERC1155, IClaimToken) returns (uint256) {
        return super.balanceOf(account, id);
    }

    // ---------- rules ----------

    /// @dev Mint: receiver eligible. Burn: never blocked, frozen lowered first. Transfer (per id): claim not frozen,
    ///      before `lockFrom`, both sides eligible, within the unfrozen balance. All paths: holder cap (in `_move`).
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        if (ids.length != values.length) revert ERC1155InvalidArrayLength(ids.length, values.length);
        if (from == address(0)) {
            if (!canReceive(to)) revert ERC7943CannotReceive(to);
        } else if (to == address(0)) {
            for (uint256 i; i < ids.length; ++i) {
                _lowerFrozen(from, ids[i], values[i]);
            }
        } else {
            for (uint256 i; i < ids.length; ++i) {
                _checkTransfer(from, to, ids[i], values[i]);
            }
        }
        _move(from, to, ids, values);
    }

    // forge-lint: disable-next-item(require-revert-in-loop) ERC-1155 batches are atomic: one bad id reverts them all
    function _checkTransfer(address from, address to, uint256 id, uint256 value) private view {
        if (!_movable(id)) revert ERC7943CannotTransfer(from, to, id, value);
        if (!canSend(from)) revert ERC7943CannotSend(from);
        if (!canReceive(to)) revert ERC7943CannotReceive(to);
        uint256 unfrozen = _unfrozen(from, id);
        // Above the whole balance, ERC-1155's own ERC1155InsufficientBalance is the more specific error.
        if (value > unfrozen && value <= balanceOf(from, id)) {
            revert ERC7943InsufficientUnfrozenBalance(from, id, value, unfrozen);
        }
    }

    /// @dev The one balance-moving path for `_update` and `forcedTransfer`, so holder tracking always runs.
    function _move(address from, address to, uint256[] memory ids, uint256[] memory values) private {
        super._update(from, to, ids, values);
        for (uint256 i; i < ids.length; ++i) {
            if (from != address(0) && balanceOf(from, ids[i]) == 0) _removeHolder(ids[i], from);
            if (to != address(0) && balanceOf(to, ids[i]) != 0) _addHolder(ids[i], to);
        }
    }

    /// @dev Burning or forcing more than the unfrozen balance unfreezes the difference first (ERC-7943).
    function _lowerFrozen(address account, uint256 id, uint256 amount) private {
        uint256 unfrozen = _unfrozen(account, id);
        if (amount <= unfrozen || amount > balanceOf(account, id)) return; // nothing to unfreeze, or ERC-1155 reverts
        uint256 left = _frozen[account][id] - (amount - unfrozen);
        _frozen[account][id] = left;
        emit Frozen(account, id, left);
    }

    function _addHolder(uint256 id, address account) private {
        address[] storage list = _holders[id];
        uint256 n = list.length;
        for (uint256 i; i < n; ++i) {
            if (list[i] == account) return;
        }
        // forge-lint: disable-next-line(require-revert-in-loop) the cap must hold for every id in a batch
        if (n == MAX_HOLDERS) revert TooManyHolders(id);
        list.push(account);
    }

    function _removeHolder(uint256 id, address account) private {
        address[] storage list = _holders[id];
        uint256 n = list.length;
        for (uint256 i; i < n; ++i) {
            if (list[i] == account) {
                list[i] = list[n - 1];
                list.pop();
                return;
            }
        }
    }

    function _movable(uint256 id) private view returns (bool) {
        ClaimState memory s = claimState[id];
        // forge-lint: disable-next-line(block-timestamp) the lock window is minutes to days; seconds don't matter
        return !s.frozen && (s.lockFrom == 0 || block.timestamp < s.lockFrom);
    }

    function _unfrozen(address account, uint256 id) private view returns (uint256) {
        uint256 balance = balanceOf(account, id);
        uint256 frozen = _frozen[account][id];
        return balance > frozen ? balance - frozen : 0;
    }

    /// @dev A transfer adds a holder only if `to` holds none, and frees a slot if `from` sends its whole balance.
    function _fitsHolderCap(address from, address to, uint256 id, uint256 amount) private view returns (bool) {
        return
            amount == 0 || balanceOf(to, id) != 0 || _holders[id].length < MAX_HOLDERS || amount == balanceOf(from, id);
    }
}
