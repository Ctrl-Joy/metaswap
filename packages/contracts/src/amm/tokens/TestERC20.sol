// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title TestERC20
/// @notice MetaSwap devnet test token: ERC20 + EIP-2612 permit, configurable decimals,
///         open `mint` (devnet faucet) and a rate-limited `faucet()`.
/// @dev Never deploy to a network with real value: anyone can mint.
contract TestERC20 is ERC20Permit {
    uint8 private immutable _decimals;

    /// @notice Amount (in base units) minted by each `faucet()` call.
    uint256 public immutable faucetAmount;
    /// @notice Minimum delay between two `faucet()` calls from the same address.
    uint256 public constant FAUCET_COOLDOWN = 1 hours;
    /// @notice Timestamp of the last faucet claim per address.
    mapping(address => uint256) public lastFaucetAt;

    event Faucet(address indexed to, uint256 amount);

    error FaucetCooldown(uint256 availableAt);

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 faucetAmount_)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        _decimals = decimals_;
        faucetAmount = faucetAmount_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Open mint for the devnet faucet / seed scripts.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Mints `faucetAmount` to the caller, at most once per `FAUCET_COOLDOWN` per address.
    function faucet() external {
        uint256 last = lastFaucetAt[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) revert FaucetCooldown(last + FAUCET_COOLDOWN);
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, faucetAmount);
        emit Faucet(msg.sender, faucetAmount);
    }

    /// @notice Seconds until `account` may call `faucet()` again (0 = available now).
    function faucetAvailableIn(address account) external view returns (uint256) {
        uint256 last = lastFaucetAt[account];
        if (last == 0 || block.timestamp >= last + FAUCET_COOLDOWN) return 0;
        return last + FAUCET_COOLDOWN - block.timestamp;
    }
}
