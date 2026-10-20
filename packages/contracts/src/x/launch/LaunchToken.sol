// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title LaunchToken
/// @notice Fixed-supply ERC20 (+ EIP-2612 permit, 18 decimals) created by a MetaSwap launchpad.
///         The whole supply is minted once, to the token's LaunchAuction.
contract LaunchToken is ERC20Permit {
    /// @notice the launchpad that created this token
    address public immutable launchpad;
    /// @notice the auction that received the supply
    address public immutable auction;

    constructor(string memory name_, string memory symbol_, uint256 totalSupply_, address auction_)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        launchpad = msg.sender;
        auction = auction_;
        _mint(auction_, totalSupply_);
    }
}
