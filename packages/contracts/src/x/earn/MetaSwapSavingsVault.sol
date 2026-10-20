// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IWETHLike {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @title MetaSwapSavingsVault
/// @notice ERC-4626 savings vault paying a fixed, owner-settable APY (MetaSwap Earn).
/// @dev Works like a savings-rate module: a per-second accumulator `index` (ray, 1e27) compounds at
///      `ratePerSecond = ln(1 + apy) / year`, so after one year the index has grown by exactly `apy`.
///      Share price = index: `totalAssets() = totalSupply * index / RAY`. Yield is paid out of a reward reserve
///      (plain asset balance on top of principal) that anyone (normally the owner) funds via `fundReserve`.
///      `maxWithdraw` / `maxRedeem` are capped by the vault's real asset balance.
contract MetaSwapSavingsVault is ERC4626, Ownable {
    using SafeERC20 for IERC20;

    uint256 internal constant RAY = 1e27;
    uint256 internal constant YEAR = 365 days;
    uint256 internal constant MAX_APY_BPS = 10_000; // 100%

    /// @notice WETH address (native ETH helpers only work when `asset() == weth`)
    address public immutable weth;

    /// @notice APY in basis points
    uint256 public apyBps;
    /// @notice continuous per-second rate (ray): ln(1 + apy) / year
    uint256 public ratePerSecond;
    /// @dev accumulator value at `lastUpdate` (ray)
    uint256 internal storedIndex;
    /// @notice timestamp of the last index checkpoint
    uint256 public lastUpdate;

    event RateUpdated(uint256 apyBps);
    event ReserveFunded(uint256 amount);

    error ApyTooHigh();
    error NotWethVault();
    error ETHTransferFailed();
    error InvalidETHSender();

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        uint256 apyBps_,
        address owner_,
        address weth_
    ) ERC20(name_, symbol_) ERC4626(asset_) Ownable(owner_) {
        weth = weth_;
        storedIndex = RAY;
        lastUpdate = block.timestamp;
        _setApy(apyBps_);
    }

    // ------------------------------------------------------------------ rate / index

    /// @notice Current accumulator (ray). Starts at 1e27.
    function index() public view returns (uint256) {
        uint256 dt = block.timestamp - lastUpdate;
        if (dt == 0 || ratePerSecond == 0) return storedIndex;
        return Math.mulDiv(storedIndex, _rpow(RAY + ratePerSecond, dt), RAY);
    }

    /// @notice Owner sets a new APY; accrued interest up to now is checkpointed at the old rate.
    function setApy(uint256 newApyBps) external onlyOwner {
        storedIndex = index();
        lastUpdate = block.timestamp;
        _setApy(newApyBps);
    }

    /// @notice Pulls `amount` of the asset from the caller into the reward reserve.
    function fundReserve(uint256 amount) external {
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
        emit ReserveFunded(amount);
    }

    /// @notice Asset balance above what depositors are owed (0 if under-reserved).
    function rewardReserve() external view returns (uint256) {
        uint256 bal = IERC20(asset()).balanceOf(address(this));
        uint256 owed = totalAssets();
        return bal > owed ? bal - owed : 0;
    }

    function _setApy(uint256 newApyBps) internal {
        if (newApyBps > MAX_APY_BPS) revert ApyTooHigh();
        apyBps = newApyBps;
        ratePerSecond = _ln1p(newApyBps * RAY / 10_000) / YEAR;
        emit RateUpdated(newApyBps);
    }

    /// @dev ln(1 + x) for x in ray, via ln(1+x) = 2·atanh(x / (2 + x)) (series in y^2 <= 1/9, converges fast)
    function _ln1p(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 y = Math.mulDiv(x, RAY, 2 * RAY + x);
        uint256 y2 = Math.mulDiv(y, y, RAY);
        uint256 term = y;
        uint256 sum = 0;
        for (uint256 k = 1; term != 0 && k < 200; k += 2) {
            sum += term / k;
            term = Math.mulDiv(term, y2, RAY);
        }
        return 2 * sum;
    }

    /// @dev x^n in ray (exponentiation by squaring, from MakerDAO's pot)
    function _rpow(uint256 x, uint256 n) internal pure returns (uint256 z) {
        z = n % 2 != 0 ? x : RAY;
        for (n /= 2; n != 0; n /= 2) {
            x = Math.mulDiv(x, x, RAY);
            if (n % 2 != 0) z = Math.mulDiv(z, x, RAY);
        }
    }

    // ------------------------------------------------------------------ ERC-4626 overrides

    /// @notice Assets owed to all depositors: shares × index.
    function totalAssets() public view override returns (uint256) {
        return Math.mulDiv(totalSupply(), index(), RAY);
    }

    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view override returns (uint256) {
        return Math.mulDiv(assets, RAY, index(), rounding);
    }

    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view override returns (uint256) {
        return Math.mulDiv(shares, index(), RAY, rounding);
    }

    /// @notice Capped by the vault's actual asset balance.
    function maxWithdraw(address owner) public view override returns (uint256) {
        uint256 owed = _convertToAssets(balanceOf(owner), Math.Rounding.Floor);
        uint256 bal = IERC20(asset()).balanceOf(address(this));
        return owed < bal ? owed : bal;
    }

    /// @notice Capped by the vault's actual asset balance.
    function maxRedeem(address owner) public view override returns (uint256) {
        uint256 shares = balanceOf(owner);
        uint256 bal = IERC20(asset()).balanceOf(address(this));
        uint256 sharesForBal = _convertToShares(bal, Math.Rounding.Floor);
        return shares < sharesForBal ? shares : sharesForBal;
    }

    // ------------------------------------------------------------------ native ETH helpers (WETH vault)

    /// @notice Deposit native ETH (wrapped to WETH) and mint shares to `receiver`.
    function depositETH(address receiver) external payable returns (uint256 shares) {
        if (asset() != weth) revert NotWethVault();
        uint256 assets = msg.value;
        uint256 maxAssets = maxDeposit(receiver);
        if (assets > maxAssets) revert ERC4626ExceededMaxDeposit(receiver, assets, maxAssets);
        shares = previewDeposit(assets);
        IWETHLike(weth).deposit{value: assets}();
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /// @notice Withdraw `assets` as native ETH to `receiver`, burning `owner`'s shares.
    function withdrawETH(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        if (asset() != weth) revert NotWethVault();
        uint256 maxAssets = maxWithdraw(owner);
        if (assets > maxAssets) revert ERC4626ExceededMaxWithdraw(owner, assets, maxAssets);
        shares = previewWithdraw(assets);
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        IWETHLike(weth).withdraw(assets);
        (bool ok,) = receiver.call{value: assets}("");
        if (!ok) revert ETHTransferFailed();
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    receive() external payable {
        if (msg.sender != weth) revert InvalidETHSender();
    }
}
