// SPDX-License-Identifier: GPL-3.0
// Ported from Uniswap/v2-core/contracts/UniswapV2Factory.sol for MetaSwap.
pragma solidity ^0.8.26;

import {IMetaSwapV2Factory} from "./interfaces/IMetaSwapV2Factory.sol";
import {MetaSwapV2Pair} from "./MetaSwapV2Pair.sol";

contract MetaSwapV2Factory is IMetaSwapV2Factory {
    address public feeTo;
    address public feeToSetter;

    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    constructor(address _feeToSetter) {
        feeToSetter = _feeToSetter;
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    /// @notice keccak256 of the pair creation code (informational; MetaSwap periphery uses getPair lookups instead)
    function pairCodeHash() external pure returns (bytes32) {
        return keccak256(type(MetaSwapV2Pair).creationCode);
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, "MetaSwapV2: IDENTICAL_ADDRESSES");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "MetaSwapV2: ZERO_ADDRESS");
        require(getPair[token0][token1] == address(0), "MetaSwapV2: PAIR_EXISTS"); // single check is sufficient
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        pair = address(new MetaSwapV2Pair{salt: salt}());
        MetaSwapV2Pair(pair).initialize(token0, token1);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair; // populate mapping in the reverse direction
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external {
        require(msg.sender == feeToSetter, "MetaSwapV2: FORBIDDEN");
        feeTo = _feeTo;
    }

    function setFeeToSetter(address _feeToSetter) external {
        require(msg.sender == feeToSetter, "MetaSwapV2: FORBIDDEN");
        feeToSetter = _feeToSetter;
    }
}
