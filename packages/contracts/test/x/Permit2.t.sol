// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {XFixture} from "./utils/XFixture.sol";
import {TestERC20} from "@metaswap/amm/tokens/TestERC20.sol";
import {Permit2} from "@metaswap/x/permit2/Permit2.sol";
import {IAllowanceTransfer} from "@metaswap/x/permit2/interfaces/IAllowanceTransfer.sol";
import {ISignatureTransfer} from "@metaswap/x/permit2/interfaces/ISignatureTransfer.sol";
import {SignatureExpired, InvalidNonce} from "@metaswap/x/permit2/PermitErrors.sol";
import {SignatureVerification} from "@metaswap/x/permit2/libraries/SignatureVerification.sol";

contract Permit2Test is XFixture {
    TestERC20 token;
    address spender = makeAddr("spender");
    address bob = makeAddr("bob");

    string constant WITNESS_TYPE = "Note witness)Note(uint256 id,address beneficiary)TokenPermissions(address token,uint256 amount)";
    bytes32 constant NOTE_TYPEHASH = keccak256("Note(uint256 id,address beneficiary)");

    function setUp() public {
        alice = vm.addr(alicePk);
        permit2 = new Permit2();
        token = new TestERC20("Token", "TKN", 18, 0);
        token.mint(alice, 1000 ether);
        vm.prank(alice);
        token.approve(address(permit2), type(uint256).max);
        vm.warp(1_700_000_000);
    }

    function test_domainSeparator() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
                keccak256("Permit2"),
                block.chainid,
                address(permit2)
            )
        );
        assertEq(permit2.DOMAIN_SEPARATOR(), expected);
    }

    // ------------------------------------------------------------ SignatureTransfer

    function _transferPermit(uint256 nonce, uint256 amount) internal view returns (ISignatureTransfer.PermitTransferFrom memory) {
        return ISignatureTransfer.PermitTransferFrom({
            permitted: ISignatureTransfer.TokenPermissions({token: address(token), amount: amount}),
            nonce: nonce,
            deadline: block.timestamp + 100
        });
    }

    function test_signatureTransfer() public {
        ISignatureTransfer.PermitTransferFrom memory p = _transferPermit(0, 10 ether);
        bytes memory sig = _signTransferFrom(alicePk, p, spender);
        vm.prank(spender);
        permit2.permitTransferFrom(p, ISignatureTransfer.SignatureTransferDetails(bob, 7 ether), alice, sig);
        assertEq(token.balanceOf(bob), 7 ether);
        assertEq(permit2.nonceBitmap(alice, 0), 1);
    }

    function test_signatureTransfer_compactSignature() public {
        ISignatureTransfer.PermitTransferFrom memory p = _transferPermit(5, 1 ether);
        bytes memory sig65 = _signTransferFrom(alicePk, p, spender);
        bytes32 r;
        bytes32 s;
        assembly {
            r := mload(add(sig65, 0x20))
            s := mload(add(sig65, 0x40))
        }
        uint8 v = uint8(sig65[64]);
        bytes32 vs = bytes32(uint256(v - 27) << 255) | s;
        vm.prank(spender);
        permit2.permitTransferFrom(p, ISignatureTransfer.SignatureTransferDetails(bob, 1 ether), alice, bytes.concat(r, vs));
        assertEq(token.balanceOf(bob), 1 ether);
    }

    function test_signatureTransfer_wrongSpenderRejected() public {
        ISignatureTransfer.PermitTransferFrom memory p = _transferPermit(0, 10 ether);
        bytes memory sig = _signTransferFrom(alicePk, p, spender);
        vm.prank(bob); // signature commits to `spender`
        vm.expectRevert(SignatureVerification.InvalidSigner.selector);
        permit2.permitTransferFrom(p, ISignatureTransfer.SignatureTransferDetails(bob, 1 ether), alice, sig);
    }

    function test_signatureTransfer_amountTooHigh() public {
        ISignatureTransfer.PermitTransferFrom memory p = _transferPermit(0, 10 ether);
        bytes memory sig = _signTransferFrom(alicePk, p, spender);
        vm.prank(spender);
        vm.expectRevert(abi.encodeWithSelector(ISignatureTransfer.InvalidAmount.selector, 10 ether));
        permit2.permitTransferFrom(p, ISignatureTransfer.SignatureTransferDetails(bob, 11 ether), alice, sig);
    }

    function test_signatureTransfer_expired() public {
        ISignatureTransfer.PermitTransferFrom memory p = _transferPermit(0, 10 ether);
        bytes memory sig = _signTransferFrom(alicePk, p, spender);
        vm.warp(p.deadline + 1);
        vm.prank(spender);
        vm.expectRevert(abi.encodeWithSelector(SignatureExpired.selector, p.deadline));
        permit2.permitTransferFrom(p, ISignatureTransfer.SignatureTransferDetails(bob, 1 ether), alice, sig);
    }

    function test_signatureTransfer_nonceReuseRejected() public {
        ISignatureTransfer.PermitTransferFrom memory p = _transferPermit(42, 10 ether);
        bytes memory sig = _signTransferFrom(alicePk, p, spender);
        vm.prank(spender);
        permit2.permitTransferFrom(p, ISignatureTransfer.SignatureTransferDetails(bob, 1 ether), alice, sig);
        vm.prank(spender);
        vm.expectRevert(InvalidNonce.selector);
        permit2.permitTransferFrom(p, ISignatureTransfer.SignatureTransferDetails(bob, 1 ether), alice, sig);
    }

    function test_invalidateUnorderedNonces() public {
        uint256 nonce = (3 << 8) | 17; // word 3, bit 17
        ISignatureTransfer.PermitTransferFrom memory p = _transferPermit(nonce, 10 ether);
        bytes memory sig = _signTransferFrom(alicePk, p, spender);
        vm.prank(alice);
        permit2.invalidateUnorderedNonces(3, 1 << 17);
        assertEq(permit2.nonceBitmap(alice, 3), 1 << 17);
        vm.prank(spender);
        vm.expectRevert(InvalidNonce.selector);
        permit2.permitTransferFrom(p, ISignatureTransfer.SignatureTransferDetails(bob, 1 ether), alice, sig);
    }

    function test_witnessTransfer() public {
        ISignatureTransfer.PermitTransferFrom memory p = _transferPermit(1, 10 ether);
        bytes32 witness = keccak256(abi.encode(NOTE_TYPEHASH, uint256(7), bob));
        bytes memory sig = _signWitnessTransferFrom(alicePk, p, spender, witness, WITNESS_TYPE);
        vm.prank(spender);
        permit2.permitWitnessTransferFrom(
            p, ISignatureTransfer.SignatureTransferDetails(bob, 10 ether), alice, witness, WITNESS_TYPE, sig
        );
        assertEq(token.balanceOf(bob), 10 ether);
    }

    function test_witnessTransfer_tamperedWitnessRejected() public {
        ISignatureTransfer.PermitTransferFrom memory p = _transferPermit(1, 10 ether);
        bytes32 witness = keccak256(abi.encode(NOTE_TYPEHASH, uint256(7), bob));
        bytes memory sig = _signWitnessTransferFrom(alicePk, p, spender, witness, WITNESS_TYPE);
        bytes32 otherWitness = keccak256(abi.encode(NOTE_TYPEHASH, uint256(8), bob));
        vm.prank(spender);
        vm.expectRevert(SignatureVerification.InvalidSigner.selector);
        permit2.permitWitnessTransferFrom(
            p, ISignatureTransfer.SignatureTransferDetails(bob, 10 ether), alice, otherWitness, WITNESS_TYPE, sig
        );
    }

    function test_batchSignatureTransfer() public {
        TestERC20 token2 = new TestERC20("Token2", "TK2", 18, 0);
        token2.mint(alice, 100 ether);
        vm.prank(alice);
        token2.approve(address(permit2), type(uint256).max);

        ISignatureTransfer.TokenPermissions[] memory permitted = new ISignatureTransfer.TokenPermissions[](2);
        permitted[0] = ISignatureTransfer.TokenPermissions(address(token), 5 ether);
        permitted[1] = ISignatureTransfer.TokenPermissions(address(token2), 6 ether);
        ISignatureTransfer.PermitBatchTransferFrom memory p =
            ISignatureTransfer.PermitBatchTransferFrom(permitted, 9, block.timestamp + 100);

        bytes32[] memory hashes = new bytes32[](2);
        hashes[0] = keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, permitted[0]));
        hashes[1] = keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, permitted[1]));
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "PermitBatchTransferFrom(TokenPermissions[] permitted,address spender,uint256 nonce,uint256 deadline)TokenPermissions(address token,uint256 amount)"
                ),
                keccak256(abi.encodePacked(hashes)),
                spender,
                p.nonce,
                p.deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(alicePk, keccak256(abi.encodePacked("\x19\x01", permit2.DOMAIN_SEPARATOR(), structHash)));

        ISignatureTransfer.SignatureTransferDetails[] memory details = new ISignatureTransfer.SignatureTransferDetails[](2);
        details[0] = ISignatureTransfer.SignatureTransferDetails(bob, 5 ether);
        details[1] = ISignatureTransfer.SignatureTransferDetails(bob, 0); // skip
        vm.prank(spender);
        permit2.permitTransferFrom(p, details, alice, bytes.concat(r, s, bytes1(v)));
        assertEq(token.balanceOf(bob), 5 ether);
        assertEq(token2.balanceOf(bob), 0);
    }

    // ------------------------------------------------------------ AllowanceTransfer

    function test_allowancePermitAndTransfer() public {
        IAllowanceTransfer.PermitSingle memory p = _permitSingle(address(token), 50 ether, 0, spender);
        bytes memory sig = _signPermitSingle(alicePk, p);
        permit2.permit(alice, p, sig);

        (uint160 amount, uint48 expiration, uint48 nonce) = permit2.allowance(alice, address(token), spender);
        assertEq(amount, 50 ether);
        assertEq(expiration, p.details.expiration);
        assertEq(nonce, 1);

        vm.prank(spender);
        permit2.transferFrom(alice, bob, 20 ether, address(token));
        assertEq(token.balanceOf(bob), 20 ether);
        (amount,,) = permit2.allowance(alice, address(token), spender);
        assertEq(amount, 30 ether);

        vm.prank(spender);
        vm.expectRevert(abi.encodeWithSelector(IAllowanceTransfer.InsufficientAllowance.selector, 30 ether));
        permit2.transferFrom(alice, bob, 31 ether, address(token));
    }

    function test_allowancePermit_replayRejected() public {
        IAllowanceTransfer.PermitSingle memory p = _permitSingle(address(token), 50 ether, 0, spender);
        bytes memory sig = _signPermitSingle(alicePk, p);
        permit2.permit(alice, p, sig);
        vm.expectRevert(InvalidNonce.selector);
        permit2.permit(alice, p, sig);
    }

    function test_allowancePermit_sigDeadlineExpired() public {
        IAllowanceTransfer.PermitSingle memory p = _permitSingle(address(token), 50 ether, 0, spender);
        bytes memory sig = _signPermitSingle(alicePk, p);
        vm.warp(p.sigDeadline + 1);
        vm.expectRevert(abi.encodeWithSelector(SignatureExpired.selector, p.sigDeadline));
        permit2.permit(alice, p, sig);
    }

    function test_allowanceExpired() public {
        vm.prank(alice);
        permit2.approve(address(token), spender, 10 ether, uint48(block.timestamp + 60));
        vm.warp(block.timestamp + 61);
        vm.prank(spender);
        vm.expectRevert(abi.encodeWithSelector(IAllowanceTransfer.AllowanceExpired.selector, block.timestamp - 1));
        permit2.transferFrom(alice, bob, 1 ether, address(token));
    }

    function test_unlimitedAllowanceNotDecremented() public {
        vm.prank(alice);
        permit2.approve(address(token), spender, type(uint160).max, uint48(block.timestamp + 60));
        vm.prank(spender);
        permit2.transferFrom(alice, bob, 5 ether, address(token));
        (uint160 amount,,) = permit2.allowance(alice, address(token), spender);
        assertEq(amount, type(uint160).max);
    }

    function test_lockdown() public {
        vm.prank(alice);
        permit2.approve(address(token), spender, 10 ether, uint48(block.timestamp + 60));
        IAllowanceTransfer.TokenSpenderPair[] memory pairs = new IAllowanceTransfer.TokenSpenderPair[](1);
        pairs[0] = IAllowanceTransfer.TokenSpenderPair(address(token), spender);
        vm.prank(alice);
        permit2.lockdown(pairs);
        (uint160 amount,,) = permit2.allowance(alice, address(token), spender);
        assertEq(amount, 0);
        vm.prank(spender);
        vm.expectRevert(abi.encodeWithSelector(IAllowanceTransfer.InsufficientAllowance.selector, 0));
        permit2.transferFrom(alice, bob, 1, address(token));
    }

    function test_invalidateNonces() public {
        IAllowanceTransfer.PermitSingle memory p = _permitSingle(address(token), 50 ether, 0, spender);
        bytes memory sig = _signPermitSingle(alicePk, p);
        vm.prank(alice);
        permit2.invalidateNonces(address(token), spender, 1);
        vm.expectRevert(InvalidNonce.selector);
        permit2.permit(alice, p, sig);

        vm.prank(alice);
        vm.expectRevert(InvalidNonce.selector);
        permit2.invalidateNonces(address(token), spender, 1); // must strictly increase

        vm.prank(alice);
        vm.expectRevert(IAllowanceTransfer.ExcessiveInvalidation.selector);
        permit2.invalidateNonces(address(token), spender, uint48(2) + type(uint16).max);
    }

    function test_permitBatch() public {
        TestERC20 token2 = new TestERC20("Token2", "TK2", 18, 0);
        IAllowanceTransfer.PermitDetails[] memory details = new IAllowanceTransfer.PermitDetails[](2);
        details[0] = IAllowanceTransfer.PermitDetails(address(token), 1 ether, uint48(block.timestamp + 100), 0);
        details[1] = IAllowanceTransfer.PermitDetails(address(token2), 2 ether, uint48(block.timestamp + 100), 0);
        IAllowanceTransfer.PermitBatch memory p = IAllowanceTransfer.PermitBatch(details, spender, block.timestamp + 100);

        bytes32[] memory hashes = new bytes32[](2);
        hashes[0] = keccak256(abi.encode(PERMIT_DETAILS_TYPEHASH, details[0]));
        hashes[1] = keccak256(abi.encode(PERMIT_DETAILS_TYPEHASH, details[1]));
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "PermitBatch(PermitDetails[] details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
                ),
                keccak256(abi.encodePacked(hashes)),
                spender,
                p.sigDeadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(alicePk, keccak256(abi.encodePacked("\x19\x01", permit2.DOMAIN_SEPARATOR(), structHash)));
        permit2.permit(alice, p, bytes.concat(r, s, bytes1(v)));
        (uint160 a1,,) = permit2.allowance(alice, address(token), spender);
        (uint160 a2,,) = permit2.allowance(alice, address(token2), spender);
        assertEq(a1, 1 ether);
        assertEq(a2, 2 ether);
    }
}
