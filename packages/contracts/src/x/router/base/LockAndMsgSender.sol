// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;
// Ported from Uniswap/universal-router/contracts/base/LockAndMsgSender.sol for MetaSwap
// Uses EIP-1153 transient storage (cancun) for the lock, like UniversalRouter v2.

/// @title LockAndMsgSender
/// @notice Records the original caller of `execute` (used as the payer / MSG_SENDER recipient) and
///  prevents re-entrancy from external contracts.
abstract contract LockAndMsgSender {
    error ContractLocked();

    /// @dev uint256(keccak256("MetaSwapUniversalRouter.lockedBy")) - 1
    bytes32 private constant LOCKED_BY_SLOT = 0x6f0f6d3b1ea8f5c6e9a91c5a1e8ef4a8a1f53e6dc6a9b2f9d0a7a0c3b6f4e2a1;

    modifier isNotLocked() {
        // Apply a reentrancy lock for all external callers
        if (msg.sender != address(this)) {
            if (_getLocker() != address(0)) revert ContractLocked();
            _setLocker(msg.sender);
            _;
            _setLocker(address(0));
        } else {
            // The contract is allowed to reenter itself, so the lock is not checked (sub-plans)
            _;
        }
    }

    /// @notice return the current locker of the contract
    function _getLocker() internal view returns (address locker) {
        bytes32 slot = LOCKED_BY_SLOT;
        assembly {
            locker := tload(slot)
        }
    }

    function _setLocker(address locker) private {
        bytes32 slot = LOCKED_BY_SLOT;
        assembly {
            tstore(slot, locker)
        }
    }

    /// @notice the address that called `execute` (the payer for user-paid commands)
    function msgSender() internal view returns (address) {
        return _getLocker();
    }
}
