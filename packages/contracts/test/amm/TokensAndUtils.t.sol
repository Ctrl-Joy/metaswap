// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {WETH9} from "../../src/amm/tokens/WETH9.sol";
import {TestERC20} from "../../src/amm/tokens/TestERC20.sol";
import {Multicall3} from "../../src/amm/utils/Multicall3.sol";

contract TokensAndUtilsTest is Test {
    WETH9 internal weth;
    TestERC20 internal usdc;
    Multicall3 internal mc;
    address internal alice = makeAddr("alice");

    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    function setUp() public {
        vm.warp(1_700_000_000);
        weth = new WETH9();
        usdc = new TestERC20("Meta USD Coin", "mUSDC", 6, 10_000e6);
        mc = new Multicall3();
        vm.deal(alice, 100 ether);
    }

    // ------------------------------------------------------------ WETH9

    function test_weth_depositWithdrawReceive() public {
        vm.startPrank(alice);
        vm.expectEmit(true, false, false, true);
        emit Deposit(alice, 1 ether);
        weth.deposit{value: 1 ether}();
        (bool ok,) = address(weth).call{value: 2 ether}("");
        assertTrue(ok);
        assertEq(weth.balanceOf(alice), 3 ether);
        assertEq(weth.totalSupply(), 3 ether);
        vm.expectEmit(true, false, false, true);
        emit Withdrawal(alice, 1 ether);
        weth.withdraw(1 ether);
        assertEq(alice.balance, 98 ether);
        vm.expectRevert();
        weth.withdraw(10 ether);
        vm.stopPrank();
        assertEq(weth.name(), "Wrapped Ether");
        assertEq(weth.symbol(), "WETH");
        assertEq(weth.decimals(), 18);
    }

    function test_weth_allowances() public {
        vm.prank(alice);
        weth.deposit{value: 5 ether}();
        vm.prank(alice);
        weth.approve(address(this), 2 ether);
        weth.transferFrom(alice, address(this), 1 ether);
        assertEq(weth.allowance(alice, address(this)), 1 ether);
        vm.expectRevert();
        weth.transferFrom(alice, address(this), 2 ether);
        vm.prank(alice);
        weth.approve(address(this), type(uint256).max);
        weth.transferFrom(alice, address(this), 2 ether);
        assertEq(weth.allowance(alice, address(this)), type(uint256).max);
        // owner can transferFrom itself without allowance
        vm.prank(alice);
        weth.transferFrom(alice, address(this), 1 ether);
        assertEq(weth.balanceOf(address(this)), 4 ether);
    }

    // ------------------------------------------------------------ TestERC20

    function test_testERC20_metadataAndMint() public {
        assertEq(usdc.name(), "Meta USD Coin");
        assertEq(usdc.symbol(), "mUSDC");
        assertEq(usdc.decimals(), 6);
        vm.prank(alice);
        usdc.mint(alice, 123e6);
        assertEq(usdc.balanceOf(alice), 123e6);
    }

    function test_testERC20_faucetRateLimited() public {
        assertEq(usdc.faucetAvailableIn(alice), 0);
        vm.prank(alice);
        usdc.faucet();
        assertEq(usdc.balanceOf(alice), 10_000e6);
        assertEq(usdc.faucetAvailableIn(alice), 1 hours);
        vm.warp(block.timestamp + 30 minutes);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TestERC20.FaucetCooldown.selector, block.timestamp + 30 minutes));
        usdc.faucet();
        // other addresses are independent
        usdc.faucet();
        assertEq(usdc.balanceOf(address(this)), 10_000e6);
        vm.warp(block.timestamp + 30 minutes);
        vm.prank(alice);
        usdc.faucet();
        assertEq(usdc.balanceOf(alice), 20_000e6);
    }

    function test_testERC20_permit() public {
        (address owner, uint256 pk) = makeAddrAndKey("owner");
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                alice,
                500e6,
                usdc.nonces(owner),
                deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash)));
        usdc.permit(owner, alice, 500e6, deadline, v, r, s);
        assertEq(usdc.allowance(owner, alice), 500e6);
        assertEq(usdc.nonces(owner), 1);
        vm.expectRevert();
        usdc.permit(owner, alice, 500e6, deadline, v, r, s);
    }

    // ------------------------------------------------------------ Multicall3

    function test_multicall3_aggregate() public {
        Multicall3.Call[] memory calls = new Multicall3.Call[](3);
        calls[0] = Multicall3.Call(address(usdc), abi.encodeCall(usdc.mint, (alice, 1e6)));
        calls[1] = Multicall3.Call(address(usdc), abi.encodeCall(usdc.balanceOf, (alice)));
        calls[2] = Multicall3.Call(address(mc), abi.encodeCall(mc.getChainId, ()));
        (uint256 bn, bytes[] memory ret) = mc.aggregate(calls);
        assertEq(bn, block.number);
        assertEq(abi.decode(ret[1], (uint256)), 1e6);
        assertEq(abi.decode(ret[2], (uint256)), block.chainid);
    }

    function test_multicall3_aggregate3_allowFailure() public {
        Multicall3.Call3[] memory calls = new Multicall3.Call3[](2);
        calls[0] = Multicall3.Call3(address(weth), true, abi.encodeCall(weth.withdraw, (1 ether))); // fails
        calls[1] = Multicall3.Call3(address(weth), false, abi.encodeCall(weth.totalSupply, ()));
        Multicall3.Result[] memory res = mc.aggregate3(calls);
        assertFalse(res[0].success);
        assertTrue(res[1].success);
        calls[0].allowFailure = false;
        vm.expectRevert("Multicall3: call failed");
        mc.aggregate3(calls);
    }

    function test_multicall3_aggregate3Value() public {
        Multicall3.Call3Value[] memory calls = new Multicall3.Call3Value[](1);
        calls[0] = Multicall3.Call3Value(address(weth), false, 1 ether, abi.encodeCall(weth.deposit, ()));
        mc.aggregate3Value{value: 1 ether}(calls);
        assertEq(weth.balanceOf(address(mc)), 1 ether);
        vm.expectRevert("Multicall3: value mismatch");
        mc.aggregate3Value{value: 2 ether}(calls);
        assertEq(mc.getEthBalance(alice), 100 ether);
    }
}
