// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {WETH9} from "@metaswap/amm/tokens/WETH9.sol";
import {TestERC20} from "@metaswap/amm/tokens/TestERC20.sol";
import {MetaSwapSavingsVault} from "@metaswap/x/earn/MetaSwapSavingsVault.sol";

contract SavingsVaultTest is Test {
    event RateUpdated(uint256 apyBps);
    event ReserveFunded(uint256 amount);

    WETH9 weth;
    TestERC20 usdt;
    MetaSwapSavingsVault usdtVault;
    MetaSwapSavingsVault ethVault;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        vm.warp(1_700_000_000);
        weth = new WETH9();
        usdt = new TestERC20("Meta Tether", "mUSDT", 6, 0);
        usdtVault =
            new MetaSwapSavingsVault(IERC20(address(usdt)), "MetaSwap Earn mUSDT", "meUSDT", 478, owner, address(weth));
        ethVault =
            new MetaSwapSavingsVault(IERC20(address(weth)), "MetaSwap Earn ETH", "meETH", 157, owner, address(weth));

        usdt.mint(owner, 1_000_000e6);
        vm.startPrank(owner);
        usdt.approve(address(usdtVault), type(uint256).max);
        usdtVault.fundReserve(1_000_000e6);
        vm.stopPrank();

        usdt.mint(alice, 100_000e6);
        usdt.mint(bob, 100_000e6);
        vm.prank(alice);
        usdt.approve(address(usdtVault), type(uint256).max);
        vm.prank(bob);
        usdt.approve(address(usdtVault), type(uint256).max);
        vm.deal(alice, 100 ether);
        vm.deal(owner, 100 ether);
    }

    function test_metadata() public view {
        assertEq(usdtVault.name(), "MetaSwap Earn mUSDT");
        assertEq(usdtVault.symbol(), "meUSDT");
        assertEq(usdtVault.decimals(), 6);
        assertEq(usdtVault.asset(), address(usdt));
        assertEq(usdtVault.apyBps(), 478);
        assertEq(usdtVault.index(), 1e27);
        assertEq(usdtVault.rewardReserve(), 1_000_000e6);
    }

    function test_rateMatchesApyAfterOneYear() public {
        vm.warp(block.timestamp + 365 days);
        // index grows by exactly the APY (ln/exp round trip), to ~1e-9
        assertApproxEqRel(usdtVault.index(), 1.0478e27, 1e9);
        vm.warp(block.timestamp + 365 days);
        assertApproxEqRel(usdtVault.index(), 1.0478e27 * 1.0478e18 / 1e18, 1e9);
    }

    function test_depositAccrueWithdraw() public {
        vm.prank(alice);
        uint256 shares = usdtVault.deposit(10_000e6, alice);
        assertEq(shares, 10_000e6);
        assertEq(usdtVault.totalAssets(), 10_000e6);

        vm.warp(block.timestamp + 182.5 days);
        uint256 expected = 10_000e6 * 10236210 / 10000000; // sqrt(1.0478) ≈ 1.0236210
        assertApproxEqRel(usdtVault.convertToAssets(shares), expected, 1e12);
        uint256 maxW = usdtVault.maxWithdraw(alice);
        assertEq(maxW, usdtVault.convertToAssets(shares));

        uint256 before = usdt.balanceOf(alice);
        vm.prank(alice);
        usdtVault.redeem(shares, alice, alice);
        uint256 got = usdt.balanceOf(alice) - before;
        assertApproxEqRel(got, expected, 1e12);
        assertEq(usdtVault.balanceOf(alice), 0);
        // the yield came out of the reserve
        assertApproxEqAbs(usdtVault.rewardReserve(), 1_000_000e6 - (got - 10_000e6), 1);
    }

    function test_laterDepositorGetsFewerShares() public {
        vm.prank(alice);
        usdtVault.deposit(10_000e6, alice);
        vm.warp(block.timestamp + 365 days);
        vm.prank(bob);
        uint256 bobShares = usdtVault.deposit(10_000e6, bob);
        assertApproxEqRel(bobShares, uint256(10_000e6) * 1e18 / 1.0478e18, 1e12);
        assertApproxEqAbs(usdtVault.convertToAssets(bobShares), 10_000e6, 1);
        assertApproxEqRel(usdtVault.maxWithdraw(alice), 10_478e6, 1e9);
    }

    function test_withdrawExactAssets() public {
        vm.prank(alice);
        usdtVault.deposit(10_000e6, alice);
        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        uint256 burned = usdtVault.withdraw(5_000e6, alice, alice);
        assertLt(burned, 5_000e6);
        assertEq(usdt.balanceOf(alice), 95_000e6);
    }

    function test_maxWithdrawCappedByBalance() public {
        // vault without a reserve
        MetaSwapSavingsVault v = new MetaSwapSavingsVault(IERC20(address(usdt)), "x", "x", 1000, owner, address(weth));
        vm.startPrank(alice);
        usdt.approve(address(v), type(uint256).max);
        uint256 shares = v.deposit(1_000e6, alice);
        vm.stopPrank();
        vm.warp(block.timestamp + 365 days);
        assertGt(v.convertToAssets(shares), 1_000e6);
        assertEq(v.maxWithdraw(alice), 1_000e6);
        assertLe(v.convertToAssets(v.maxRedeem(alice)), 1_000e6);
        vm.prank(alice);
        vm.expectRevert();
        v.withdraw(1_000e6 + 1, alice, alice);
        vm.prank(alice);
        v.withdraw(1_000e6, alice, alice);
        assertEq(usdt.balanceOf(address(v)), 0);
    }

    function test_setApyCheckpointsAndOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        usdtVault.setApy(1000);

        vm.warp(block.timestamp + 365 days);
        uint256 idx = usdtVault.index();
        vm.expectEmit(address(usdtVault));
        emit RateUpdated(0);
        vm.prank(owner);
        usdtVault.setApy(0);
        vm.warp(block.timestamp + 365 days);
        assertEq(usdtVault.index(), idx); // frozen at 0%, history kept

        vm.prank(owner);
        vm.expectRevert(MetaSwapSavingsVault.ApyTooHigh.selector);
        usdtVault.setApy(10_001);
    }

    function test_fundReserveEvent() public {
        usdt.mint(bob, 5e6);
        vm.expectEmit(address(usdtVault));
        emit ReserveFunded(5e6);
        vm.prank(bob);
        usdtVault.fundReserve(5e6);
        assertEq(usdtVault.rewardReserve(), 1_000_005e6);
    }

    function test_depositAndWithdrawETH() public {
        vm.startPrank(owner);
        weth.deposit{value: 10 ether}();
        weth.approve(address(ethVault), 10 ether);
        ethVault.fundReserve(10 ether);
        vm.stopPrank();

        vm.expectEmit(address(ethVault));
        emit IERC4626.Deposit(alice, alice, 5 ether, 5 ether);
        vm.prank(alice);
        uint256 shares = ethVault.depositETH{value: 5 ether}(alice);
        assertEq(shares, 5 ether);
        assertEq(weth.balanceOf(address(ethVault)), 15 ether);

        vm.warp(block.timestamp + 365 days);
        uint256 owed = ethVault.maxWithdraw(alice);
        assertApproxEqRel(owed, 5.0785 ether, 1e9);

        // a third party with allowance withdraws ETH for alice to bob
        vm.prank(alice);
        ethVault.approve(bob, type(uint256).max);
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        ethVault.withdrawETH(owed, bob, alice);
        assertEq(bob.balance - bobBefore, owed);
        assertLe(ethVault.balanceOf(alice), 1);
    }

    function test_withdrawETHRequiresAllowance() public {
        vm.prank(alice);
        ethVault.depositETH{value: 1 ether}(alice);
        vm.prank(bob);
        vm.expectRevert();
        ethVault.withdrawETH(0.5 ether, bob, alice);
    }

    function test_ethHelpersOnlyOnWethVault() public {
        vm.prank(alice);
        vm.expectRevert(MetaSwapSavingsVault.NotWethVault.selector);
        usdtVault.depositETH{value: 1 ether}(alice);
        vm.prank(alice);
        vm.expectRevert(MetaSwapSavingsVault.NotWethVault.selector);
        usdtVault.withdrawETH(1, alice, alice);
    }

    function test_rejectsStrayETH() public {
        vm.prank(alice);
        (bool ok,) = address(ethVault).call{value: 1 ether}("");
        assertFalse(ok);
    }
}
