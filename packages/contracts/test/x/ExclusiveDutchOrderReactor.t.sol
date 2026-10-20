// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {XFixture} from "./utils/XFixture.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {IV3SwapRouter} from "@metaswap/amm/v3/interfaces/IV3SwapRouter.sol";
import {IV2SwapRouter} from "@metaswap/amm/v3/interfaces/IV2SwapRouter.sol";
import {ISwapRouter02} from "@metaswap/amm/v3/interfaces/ISwapRouter02.sol";
import {ISignatureTransfer} from "@metaswap/x/permit2/interfaces/ISignatureTransfer.sol";
import {IPermit2} from "@metaswap/x/permit2/interfaces/IPermit2.sol";
import {InvalidNonce} from "@metaswap/x/permit2/PermitErrors.sol";
import {SignatureVerification} from "@metaswap/x/permit2/libraries/SignatureVerification.sol";
import {ExclusiveDutchOrderReactor} from "@metaswap/x/metaswapx/reactors/ExclusiveDutchOrderReactor.sol";
import {SwapRouter02Executor} from "@metaswap/x/metaswapx/sample-executors/SwapRouter02Executor.sol";
import {
    ExclusiveDutchOrderLib,
    ExclusiveDutchOrder,
    DutchInput,
    DutchOutput
} from "@metaswap/x/metaswapx/lib/ExclusiveDutchOrderLib.sol";
import {ExclusivityLib} from "@metaswap/x/metaswapx/lib/ExclusivityLib.sol";
import {ResolvedOrderLib} from "@metaswap/x/metaswapx/lib/ResolvedOrderLib.sol";
import {DutchDecayLib} from "@metaswap/x/metaswapx/lib/DutchDecayLib.sol";
import {OrderInfo, SignedOrder, ResolvedOrder, OutputToken} from "@metaswap/x/metaswapx/base/ReactorStructs.sol";
import {IReactor} from "@metaswap/x/metaswapx/interfaces/IReactor.sol";
import {IValidationCallback} from "@metaswap/x/metaswapx/interfaces/IValidationCallback.sol";
import {IProtocolFeeController} from "@metaswap/x/metaswapx/interfaces/IProtocolFeeController.sol";
import {ReactorEvents} from "@metaswap/x/metaswapx/base/ReactorEvents.sol";

contract FlatFeeController is IProtocolFeeController {
    address immutable recipient;

    constructor(address _recipient) {
        recipient = _recipient;
    }

    /// 5 bps of the first output
    function getFeeOutputs(ResolvedOrder memory order) external view returns (OutputToken[] memory fees) {
        fees = new OutputToken[](1);
        fees[0] = OutputToken(order.outputs[0].token, (order.outputs[0].amount * 5) / 10_000, recipient);
    }
}

contract ExclusiveDutchOrderReactorTest is XFixture, ReactorEvents {
    // EIP-712 type strings written out independently of the contracts (the API / web must use exactly these)
    string constant ORDER_INFO_TYPE =
        "OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)";
    string constant DUTCH_OUTPUT_TYPE = "DutchOutput(address token,uint256 startAmount,uint256 endAmount,address recipient)";
    string constant EXCLUSIVE_DUTCH_ORDER_TYPE =
        "ExclusiveDutchOrder(OrderInfo info,uint256 decayStartTime,uint256 decayEndTime,address exclusiveFiller,uint256 exclusivityOverrideBps,address inputToken,uint256 inputStartAmount,uint256 inputEndAmount,DutchOutput[] outputs)";
    string constant TOKEN_PERMISSIONS_TYPE = "TokenPermissions(address token,uint256 amount)";

    ExclusiveDutchOrderReactor reactor;
    SwapRouter02Executor executor;
    address owner = makeAddr("owner");
    address filler = makeAddr("filler");
    address filler2 = makeAddr("filler2");

    function setUp() public {
        vm.warp(1_700_000_000);
        setUpAMM();
        reactor = new ExclusiveDutchOrderReactor(IPermit2(address(permit2)), owner);
        executor = new SwapRouter02Executor(filler, IReactor(address(reactor)), owner, ISwapRouter02(address(swapRouter02)));

        tokenA.transfer(alice, 1_000 ether);
        vm.prank(alice);
        tokenA.approve(address(permit2), type(uint256).max);

        tokenB.transfer(filler, 1_000 ether);
        tokenB.transfer(filler2, 1_000 ether);
        vm.prank(filler);
        tokenB.approve(address(reactor), type(uint256).max);
        vm.prank(filler2);
        tokenB.approve(address(reactor), type(uint256).max);
        vm.deal(filler, 10 ether);
    }

    // ------------------------------------------------------------ order helpers

    function _order(uint256 nonce, uint256 inAmount, uint256 outStart, uint256 outEnd)
        internal
        view
        returns (ExclusiveDutchOrder memory order)
    {
        DutchOutput[] memory outputs = new DutchOutput[](1);
        outputs[0] = DutchOutput(address(tokenB), outStart, outEnd, alice);
        order = ExclusiveDutchOrder({
            info: OrderInfo({
                reactor: IReactor(address(reactor)),
                swapper: alice,
                nonce: nonce,
                deadline: block.timestamp + 200,
                additionalValidationContract: IValidationCallback(address(0)),
                additionalValidationData: ""
            }),
            decayStartTime: block.timestamp,
            decayEndTime: block.timestamp + 100,
            exclusiveFiller: address(0),
            exclusivityOverrideBps: 0,
            input: DutchInput(ERC20(address(tokenA)), inAmount, inAmount),
            outputs: outputs
        });
    }

    function _hashOrder(ExclusiveDutchOrder memory o) internal pure returns (bytes32) {
        bytes32 infoHash = keccak256(
            abi.encode(
                keccak256(bytes(ORDER_INFO_TYPE)),
                o.info.reactor,
                o.info.swapper,
                o.info.nonce,
                o.info.deadline,
                o.info.additionalValidationContract,
                keccak256(o.info.additionalValidationData)
            )
        );
        bytes32[] memory outHashes = new bytes32[](o.outputs.length);
        for (uint256 i; i < o.outputs.length; i++) {
            outHashes[i] = keccak256(
                abi.encode(
                    keccak256(bytes(DUTCH_OUTPUT_TYPE)),
                    o.outputs[i].token,
                    o.outputs[i].startAmount,
                    o.outputs[i].endAmount,
                    o.outputs[i].recipient
                )
            );
        }
        bytes32 orderTypeHash =
            keccak256(abi.encodePacked(EXCLUSIVE_DUTCH_ORDER_TYPE, DUTCH_OUTPUT_TYPE, ORDER_INFO_TYPE));
        return keccak256(
            abi.encode(
                orderTypeHash,
                infoHash,
                o.decayStartTime,
                o.decayEndTime,
                o.exclusiveFiller,
                o.exclusivityOverrideBps,
                o.input.token,
                o.input.startAmount,
                o.input.endAmount,
                keccak256(abi.encodePacked(outHashes))
            )
        );
    }

    function _witnessTypeString() internal pure returns (string memory) {
        // referenced structs in alphabetical order, as every EIP-712 implementation encodes them
        return string(
            abi.encodePacked(
                "ExclusiveDutchOrder witness)",
                DUTCH_OUTPUT_TYPE,
                EXCLUSIVE_DUTCH_ORDER_TYPE,
                ORDER_INFO_TYPE,
                TOKEN_PERMISSIONS_TYPE
            )
        );
    }

    function _sign(ExclusiveDutchOrder memory o) internal view returns (SignedOrder memory) {
        return _signWith(alicePk, o);
    }

    function _signWith(uint256 pk, ExclusiveDutchOrder memory o) internal view returns (SignedOrder memory) {
        ISignatureTransfer.PermitTransferFrom memory permit = ISignatureTransfer.PermitTransferFrom({
            permitted: ISignatureTransfer.TokenPermissions(address(o.input.token), o.input.endAmount),
            nonce: o.info.nonce,
            deadline: o.info.deadline
        });
        bytes memory sig =
            _signWitnessTransferFrom(pk, permit, address(reactor), _hashOrder(o), _witnessTypeString());
        return SignedOrder(abi.encode(o), sig);
    }

    function _fillDirect(address who, SignedOrder memory s) internal {
        vm.prank(who);
        reactor.execute(s);
    }

    // ------------------------------------------------------------ type strings

    function test_witnessTypeStringMatchesEip712Canonical() public pure {
        assertEq(ExclusiveDutchOrderLib.PERMIT2_ORDER_TYPE, _witnessTypeString());
        // forge's EIP-712 canonicaliser (sorts referenced types) agrees with the full Permit2 type
        string memory full = string(
            abi.encodePacked(
                "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,",
                ExclusiveDutchOrderLib.PERMIT2_ORDER_TYPE
            )
        );
        assertEq(vm.eip712HashType(full), keccak256(bytes(full)));
        assertEq(
            vm.eip712HashType(string(abi.encodePacked(EXCLUSIVE_DUTCH_ORDER_TYPE, DUTCH_OUTPUT_TYPE, ORDER_INFO_TYPE))),
            ExclusiveDutchOrderLib.ORDER_TYPE_HASH
        );
    }

    // ------------------------------------------------------------ decay

    function _fillAt(uint256 t, uint256 nonce) internal returns (uint256 received) {
        ExclusiveDutchOrder memory o = _order(nonce, 10 ether, 10 ether, 9 ether);
        SignedOrder memory s = _sign(o);
        vm.warp(t == 0 ? o.decayStartTime : t == 1 ? o.decayStartTime + 50 : o.decayEndTime + 1);
        uint256 before = tokenB.balanceOf(alice);
        _fillDirect(filler, s);
        received = tokenB.balanceOf(alice) - before;
    }

    function test_decayAtStart() public {
        uint256 aBefore = tokenA.balanceOf(filler);
        assertEq(_fillAt(0, 1), 10 ether);
        assertEq(tokenA.balanceOf(filler) - aBefore, 10 ether);
    }

    function test_decayAtMiddle() public {
        assertEq(_fillAt(1, 2), 9.5 ether);
    }

    function test_decayAtEnd() public {
        assertEq(_fillAt(2, 3), 9 ether);
    }

    function test_inputDecay() public {
        ExclusiveDutchOrder memory o = _order(4, 10 ether, 9 ether, 9 ether);
        o.input.endAmount = 11 ether; // input grows from 10 to 11
        SignedOrder memory s = _sign(o);
        vm.warp(o.decayStartTime + 25);
        uint256 aBefore = tokenA.balanceOf(alice);
        _fillDirect(filler, s);
        assertEq(aBefore - tokenA.balanceOf(alice), 10.25 ether);
    }

    function test_inputAndOutputDecayRejected() public {
        ExclusiveDutchOrder memory o = _order(5, 10 ether, 10 ether, 9 ether);
        o.input.endAmount = 11 ether;
        SignedOrder memory s = _sign(o);
        vm.prank(filler);
        vm.expectRevert(ExclusiveDutchOrderReactor.InputAndOutputDecay.selector);
        reactor.execute(s);
    }

    function test_fillEmitsEvent() public {
        ExclusiveDutchOrder memory o = _order(6, 10 ether, 10 ether, 9 ether);
        SignedOrder memory s = _sign(o);
        vm.expectEmit(true, true, true, true, address(reactor));
        emit Fill(_hashOrder(o), filler, alice, 6);
        _fillDirect(filler, s);
    }

    // ------------------------------------------------------------ exclusivity

    function test_exclusiveFillerCanFill() public {
        ExclusiveDutchOrder memory o = _order(10, 10 ether, 10 ether, 9 ether);
        o.exclusiveFiller = filler;
        o.decayStartTime = block.timestamp + 50;
        o.decayEndTime = block.timestamp + 150;
        SignedOrder memory s = _sign(o);
        _fillDirect(filler, s);
        assertEq(tokenB.balanceOf(alice), 10 ether);
    }

    function test_nonExclusiveFillerBlockedWhenStrict() public {
        ExclusiveDutchOrder memory o = _order(11, 10 ether, 10 ether, 9 ether);
        o.exclusiveFiller = filler;
        o.decayStartTime = block.timestamp + 50;
        o.decayEndTime = block.timestamp + 150;
        SignedOrder memory s = _sign(o);
        vm.prank(filler2);
        vm.expectRevert(ExclusivityLib.NoExclusiveOverride.selector);
        reactor.execute(s);
        // after the exclusivity window (== decayStartTime) anyone can fill
        vm.warp(o.decayStartTime + 1);
        _fillDirect(filler2, s);
        assertEq(tokenB.balanceOf(alice), 9.99 ether);
    }

    function test_nonExclusiveFillerPaysOverride() public {
        ExclusiveDutchOrder memory o = _order(12, 10 ether, 10 ether, 9 ether);
        o.exclusiveFiller = filler;
        o.exclusivityOverrideBps = 100; // 1%
        o.decayStartTime = block.timestamp + 50;
        o.decayEndTime = block.timestamp + 150;
        SignedOrder memory s = _sign(o);
        _fillDirect(filler2, s);
        assertEq(tokenB.balanceOf(alice), 10.1 ether);
    }

    // ------------------------------------------------------------ validation failures

    function test_expiredOrderRejected() public {
        ExclusiveDutchOrder memory o = _order(20, 10 ether, 10 ether, 9 ether);
        SignedOrder memory s = _sign(o);
        vm.warp(o.info.deadline + 1);
        vm.prank(filler);
        vm.expectRevert(ResolvedOrderLib.DeadlinePassed.selector);
        reactor.execute(s);
    }

    function test_deadlineBeforeEndTimeRejected() public {
        ExclusiveDutchOrder memory o = _order(21, 10 ether, 10 ether, 9 ether);
        o.info.deadline = o.decayEndTime - 1;
        SignedOrder memory s = _sign(o);
        vm.prank(filler);
        vm.expectRevert(ExclusiveDutchOrderReactor.DeadlineBeforeEndTime.selector);
        reactor.execute(s);
    }

    function test_cancelViaInvalidateUnorderedNonces() public {
        uint256 nonce = (7 << 8) | 3;
        ExclusiveDutchOrder memory o = _order(nonce, 10 ether, 10 ether, 9 ether);
        SignedOrder memory s = _sign(o);
        vm.prank(alice);
        permit2.invalidateUnorderedNonces(7, 1 << 3);
        vm.prank(filler);
        vm.expectRevert(InvalidNonce.selector);
        reactor.execute(s);
    }

    function test_replayRejected() public {
        ExclusiveDutchOrder memory o = _order(22, 10 ether, 10 ether, 9 ether);
        SignedOrder memory s = _sign(o);
        _fillDirect(filler, s);
        vm.prank(filler);
        vm.expectRevert(InvalidNonce.selector);
        reactor.execute(s);
    }

    function test_wrongReactorRejected() public {
        ExclusiveDutchOrder memory o = _order(23, 10 ether, 10 ether, 9 ether);
        o.info.reactor = IReactor(makeAddr("otherReactor"));
        SignedOrder memory s = _sign(o);
        vm.prank(filler);
        vm.expectRevert(ResolvedOrderLib.InvalidReactor.selector);
        reactor.execute(s);
    }

    function test_tamperedOrderRejected() public {
        ExclusiveDutchOrder memory o = _order(24, 10 ether, 10 ether, 9 ether);
        SignedOrder memory s = _sign(o);
        o.outputs[0].endAmount = 1 ether; // filler tries to lower the minimum
        s.order = abi.encode(o);
        vm.warp(o.decayEndTime);
        vm.prank(filler);
        vm.expectRevert(SignatureVerification.InvalidSigner.selector);
        reactor.execute(s);
    }

    function test_insufficientOutputReverts() public {
        ExclusiveDutchOrder memory o = _order(25, 10 ether, 2_000 ether, 2_000 ether); // filler only has 1000
        SignedOrder memory s = _sign(o);
        vm.prank(filler);
        vm.expectRevert();
        reactor.execute(s);
        assertEq(tokenA.balanceOf(alice), 1_000 ether);
    }

    // ------------------------------------------------------------ native output + fees

    function test_nativeOutput() public {
        DutchOutput[] memory outputs = new DutchOutput[](1);
        outputs[0] = DutchOutput(address(0), 1 ether, 1 ether, alice);
        ExclusiveDutchOrder memory o = _order(30, 10 ether, 0, 0);
        o.outputs = outputs;
        SignedOrder memory s = _sign(o);
        uint256 before = alice.balance;
        vm.prank(filler);
        reactor.execute{value: 1.5 ether}(s);
        assertEq(alice.balance - before, 1 ether);
        assertEq(filler.balance, 9 ether); // 0.5 refunded
    }

    function test_protocolFeeOffByDefaultAndOwnerSettable() public {
        assertEq(address(reactor.feeController()), address(0));
        address feeRecipient = makeAddr("protocolFee");
        FlatFeeController controller = new FlatFeeController(feeRecipient);
        vm.expectRevert("UNAUTHORIZED");
        reactor.setProtocolFeeController(address(controller));
        vm.prank(owner);
        reactor.setProtocolFeeController(address(controller));

        ExclusiveDutchOrder memory o = _order(31, 10 ether, 10 ether, 10 ether);
        _fillDirect(filler, _sign(o));
        assertEq(tokenB.balanceOf(alice), 10 ether);
        assertEq(tokenB.balanceOf(feeRecipient), 0.005 ether);
    }

    // ------------------------------------------------------------ SwapRouter02Executor (real C1 pools)

    function _v3CallbackData(uint256 amountIn) internal view returns (bytes memory) {
        address[] memory approveRouter = new address[](1);
        approveRouter[0] = address(tokenA);
        address[] memory approveReactor = new address[](1);
        approveReactor[0] = address(tokenB);
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(
            IV3SwapRouter.exactInputSingle,
            (
                IV3SwapRouter.ExactInputSingleParams({
                    tokenIn: address(tokenA),
                    tokenOut: address(tokenB),
                    fee: FEE,
                    recipient: address(executor),
                    amountIn: amountIn,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            )
        );
        return abi.encode(approveRouter, approveReactor, calls);
    }

    function test_executorFillViaV3() public {
        ExclusiveDutchOrder memory o = _order(40, 10 ether, 9.95 ether, 9.5 ether);
        SignedOrder memory s = _sign(o);
        vm.prank(filler);
        executor.execute(s, _v3CallbackData(10 ether));
        assertEq(tokenB.balanceOf(alice), 9.95 ether);
        assertEq(tokenA.balanceOf(alice), 990 ether);
        // filler's profit stays in the executor
        uint256 profit = tokenB.balanceOf(address(executor));
        assertGt(profit, 0);
        vm.prank(owner);
        executor.withdrawERC20(ERC20(address(tokenB)), owner);
        assertEq(tokenB.balanceOf(owner), profit);
    }

    function test_executorFillViaV2() public {
        ExclusiveDutchOrder memory o = _order(41, 10 ether, 9.95 ether, 9.5 ether);
        SignedOrder memory s = _sign(o);
        address[] memory approveRouter = new address[](1);
        approveRouter[0] = address(tokenA);
        address[] memory approveReactor = new address[](1);
        approveReactor[0] = address(tokenB);
        address[] memory path = new address[](2);
        (path[0], path[1]) = (address(tokenA), address(tokenB));
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(IV2SwapRouter.swapExactTokensForTokens, (10 ether, 0, path, address(executor)));
        vm.prank(filler);
        executor.execute(s, abi.encode(approveRouter, approveReactor, calls));
        assertEq(tokenB.balanceOf(alice), 9.95 ether);
    }

    function test_executorUnprofitableFillReverts() public {
        ExclusiveDutchOrder memory o = _order(42, 10 ether, 10 ether, 10 ether); // pool only gives ~9.97
        SignedOrder memory s = _sign(o);
        vm.prank(filler);
        vm.expectRevert();
        executor.execute(s, _v3CallbackData(10 ether));
    }

    function test_executorOnlyWhitelistedCaller() public {
        SignedOrder memory s = _sign(_order(43, 10 ether, 9.9 ether, 9.9 ether));
        vm.prank(filler2);
        vm.expectRevert(SwapRouter02Executor.CallerNotWhitelisted.selector);
        executor.execute(s, _v3CallbackData(10 ether));
    }

    function test_executorCallbackOnlyReactor() public {
        ResolvedOrder[] memory none = new ResolvedOrder[](0);
        vm.prank(filler);
        vm.expectRevert(SwapRouter02Executor.MsgSenderNotReactor.selector);
        executor.reactorCallback(none, _v3CallbackData(1 ether));
    }

    function test_executorOwnerWithdrawals() public {
        vm.deal(address(executor), 1 ether);
        vm.prank(filler);
        vm.expectRevert("UNAUTHORIZED");
        executor.withdrawETH(filler);
        vm.prank(owner);
        executor.withdrawETH(owner);
        assertEq(owner.balance, 1 ether);
    }

    function test_executorBatchFill() public {
        uint256 bobPk = 0xB0B;
        address bob = vm.addr(bobPk);
        tokenA.transfer(bob, 100 ether);
        vm.prank(bob);
        tokenA.approve(address(permit2), type(uint256).max);

        ExclusiveDutchOrder memory o1 = _order(50, 10 ether, 9.9 ether, 9.5 ether);
        ExclusiveDutchOrder memory o2 = _order(51, 5 ether, 4.9 ether, 4.5 ether);
        o2.info.swapper = bob;
        o2.outputs[0].recipient = bob;
        SignedOrder[] memory orders = new SignedOrder[](2);
        orders[0] = _sign(o1);
        orders[1] = _signWith(bobPk, o2);

        vm.prank(filler);
        executor.executeBatch(orders, _v3CallbackData(15 ether));
        assertEq(tokenB.balanceOf(alice), 9.9 ether);
        assertEq(tokenB.balanceOf(bob), 4.9 ether);
        assertEq(tokenA.balanceOf(bob), 95 ether);
    }

    function test_directBatchFill() public {
        ExclusiveDutchOrder memory o1 = _order(60, 1 ether, 1 ether, 1 ether);
        ExclusiveDutchOrder memory o2 = _order(61, 2 ether, 2 ether, 2 ether);
        SignedOrder[] memory orders = new SignedOrder[](2);
        orders[0] = _sign(o1);
        orders[1] = _sign(o2);
        vm.prank(filler);
        reactor.executeBatch(orders);
        assertEq(tokenB.balanceOf(alice), 3 ether);
        assertEq(tokenA.balanceOf(filler), 3 ether);
    }
}
