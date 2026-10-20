// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {WETH9} from "@metaswap/amm/tokens/WETH9.sol";
import {TestERC20} from "@metaswap/amm/tokens/TestERC20.sol";
import {MetaSwapV2Factory} from "@metaswap/amm/v2/MetaSwapV2Factory.sol";
import {IMetaSwapV2Pair} from "@metaswap/amm/v2/interfaces/IMetaSwapV2Pair.sol";
import {MetaSwapV3Factory} from "@metaswap/amm/v3/MetaSwapV3Factory.sol";
import {IMetaSwapV3Pool} from "@metaswap/amm/v3/interfaces/IMetaSwapV3Pool.sol";
import {SwapRouter02} from "@metaswap/amm/v3/SwapRouter02.sol";

import {Permit2} from "@metaswap/x/permit2/Permit2.sol";
import {IAllowanceTransfer} from "@metaswap/x/permit2/interfaces/IAllowanceTransfer.sol";
import {ISignatureTransfer} from "@metaswap/x/permit2/interfaces/ISignatureTransfer.sol";
import {MetaSwapUniversalRouter} from "@metaswap/x/router/MetaSwapUniversalRouter.sol";

/// @notice Deploys the real MetaSwap AMM (C1) + Permit2 + UniversalRouter and seeds 1:1 pools.
abstract contract XFixture is Test {
    // Permit2 EIP-712 strings, written out independently of the contracts so tests double as a spec check.
    bytes32 internal constant PERMIT_DETAILS_TYPEHASH =
        keccak256("PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)");
    bytes32 internal constant PERMIT_SINGLE_TYPEHASH = keccak256(
        "PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
    );
    bytes32 internal constant TOKEN_PERMISSIONS_TYPEHASH = keccak256("TokenPermissions(address token,uint256 amount)");
    bytes32 internal constant PERMIT_TRANSFER_FROM_TYPEHASH = keccak256(
        "PermitTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline)TokenPermissions(address token,uint256 amount)"
    );
    string internal constant WITNESS_STUB =
        "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,";

    uint24 internal constant FEE = 3000;
    int24 internal constant MIN_TICK = -887220; // full range for tick spacing 60
    int24 internal constant MAX_TICK = 887220;
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    WETH9 internal weth;
    TestERC20 internal tokenA;
    TestERC20 internal tokenB;
    TestERC20 internal tokenC;
    MetaSwapV2Factory internal v2Factory;
    MetaSwapV3Factory internal v3Factory;
    SwapRouter02 internal swapRouter02;
    Permit2 internal permit2;
    MetaSwapUniversalRouter internal router;

    uint256 internal alicePk = 0xA11CE;
    address internal alice;

    function setUpAMM() internal {
        alice = vm.addr(alicePk);
        weth = new WETH9();
        tokenA = new TestERC20("Token A", "TKA", 18, 0);
        tokenB = new TestERC20("Token B", "TKB", 18, 0);
        tokenC = new TestERC20("Token C", "TKC", 18, 0);
        v2Factory = new MetaSwapV2Factory(address(this));
        v3Factory = new MetaSwapV3Factory();
        swapRouter02 = new SwapRouter02(address(v2Factory), address(v3Factory), address(0xdead), address(weth));
        permit2 = new Permit2();
        router = new MetaSwapUniversalRouter(address(permit2), address(weth), address(v2Factory), address(v3Factory));

        vm.deal(address(this), 1_000_000 ether);
        weth.deposit{value: 500_000 ether}();
        tokenA.mint(address(this), 10_000_000 ether);
        tokenB.mint(address(this), 10_000_000 ether);
        tokenC.mint(address(this), 10_000_000 ether);

        // V3 pools (1:1, full range): A/B, B/C, WETH/A
        _createV3Pool(address(tokenA), address(tokenB), 1_000_000 ether);
        _createV3Pool(address(tokenB), address(tokenC), 1_000_000 ether);
        _createV3Pool(address(weth), address(tokenA), 100_000 ether);

        // V2 pairs (1:1): A/B, B/C, WETH/B
        _createV2Pair(address(tokenA), address(tokenB), 1_000_000 ether);
        _createV2Pair(address(tokenB), address(tokenC), 1_000_000 ether);
        _createV2Pair(address(weth), address(tokenB), 100_000 ether);
    }

    function _createV3Pool(address t0, address t1, uint128 liquidity) internal returns (address pool) {
        pool = v3Factory.createPool(t0, t1, FEE);
        IMetaSwapV3Pool(pool).initialize(SQRT_PRICE_1_1);
        IMetaSwapV3Pool(pool).mint(address(this), MIN_TICK, MAX_TICK, liquidity, "");
    }

    function _createV2Pair(address t0, address t1, uint256 amount) internal returns (address pair) {
        pair = v2Factory.createPair(t0, t1);
        TestERC20(t0).transfer(pair, amount);
        TestERC20(t1).transfer(pair, amount);
        IMetaSwapV2Pair(pair).mint(address(this));
    }

    /// @dev V3 mint callback: pay the pool what it is owed
    function uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata) external {
        IMetaSwapV3Pool pool = IMetaSwapV3Pool(msg.sender);
        if (amount0Owed > 0) TestERC20(pool.token0()).transfer(msg.sender, amount0Owed);
        if (amount1Owed > 0) TestERC20(pool.token1()).transfer(msg.sender, amount1Owed);
    }

    // ------------------------------------------------------------------ Permit2 signing helpers

    function _permitSingleDigest(IAllowanceTransfer.PermitSingle memory p) internal view returns (bytes32) {
        bytes32 detailsHash = keccak256(abi.encode(PERMIT_DETAILS_TYPEHASH, p.details));
        bytes32 structHash = keccak256(abi.encode(PERMIT_SINGLE_TYPEHASH, detailsHash, p.spender, p.sigDeadline));
        return keccak256(abi.encodePacked("\x19\x01", permit2.DOMAIN_SEPARATOR(), structHash));
    }

    function _signPermitSingle(uint256 pk, IAllowanceTransfer.PermitSingle memory p)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _permitSingleDigest(p));
        return bytes.concat(r, s, bytes1(v));
    }

    function _permitSingle(address token, uint160 amount, uint48 nonce, address spender)
        internal
        view
        returns (IAllowanceTransfer.PermitSingle memory)
    {
        return IAllowanceTransfer.PermitSingle({
            details: IAllowanceTransfer.PermitDetails({
                token: token,
                amount: amount,
                expiration: uint48(block.timestamp + 30 days),
                nonce: nonce
            }),
            spender: spender,
            sigDeadline: block.timestamp + 30 minutes
        });
    }

    function _signTransferFrom(uint256 pk, ISignatureTransfer.PermitTransferFrom memory p, address spender)
        internal
        view
        returns (bytes memory)
    {
        bytes32 tokenPermissions = keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, p.permitted));
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TRANSFER_FROM_TYPEHASH, tokenPermissions, spender, p.nonce, p.deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", permit2.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return bytes.concat(r, s, bytes1(v));
    }

    function _signWitnessTransferFrom(
        uint256 pk,
        ISignatureTransfer.PermitTransferFrom memory p,
        address spender,
        bytes32 witness,
        string memory witnessTypeString
    ) internal view returns (bytes memory) {
        bytes32 typeHash = keccak256(abi.encodePacked(WITNESS_STUB, witnessTypeString));
        bytes32 tokenPermissions = keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, p.permitted));
        bytes32 structHash =
            keccak256(abi.encode(typeHash, tokenPermissions, spender, p.nonce, p.deadline, witness));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", permit2.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return bytes.concat(r, s, bytes1(v));
    }

    receive() external payable {}
}
