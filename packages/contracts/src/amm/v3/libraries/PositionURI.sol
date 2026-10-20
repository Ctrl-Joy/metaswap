// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.26;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

interface IERC20SymbolView {
    function symbol() external view returns (string memory);
}

/// @title PositionURI
/// @notice Original MetaSwap on-chain metadata for V3 position NFTs: a data:application/json URI whose `image`
///         is a small data:image/svg+xml card showing the pair, fee tier, tick range and in-range status.
library PositionURI {
    using Strings for uint256;
    using Strings for address;

    struct Params {
        uint256 tokenId;
        address pool;
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        int24 tickCurrent;
        uint128 liquidity;
    }

    function tokenURI(Params memory p) internal view returns (string memory) {
        string memory sym0 = _escape(_symbol(p.token0));
        string memory sym1 = _escape(_symbol(p.token1));
        string memory feeStr = feeToString(p.fee);
        bool inRange = p.tickCurrent >= p.tickLower && p.tickCurrent < p.tickUpper;
        string memory pairName = string.concat(sym0, "/", sym1);

        string memory image = Base64.encode(bytes(_svg(p, pairName, feeStr, inRange)));
        string memory json = string.concat(
            '{"name":"MetaSwap V3 - ',
            feeStr,
            " - ",
            pairName,
            '","description":"This NFT represents a liquidity position in the MetaSwap V3 ',
            pairName,
            " pool (",
            feeStr,
            " fee tier). The owner of this NFT can modify or redeem the position.\\n\\nPool: ",
            p.pool.toHexString(),
            '","attributes":[',
            _attributes(p, pairName, feeStr, inRange),
            '],"image":"data:image/svg+xml;base64,',
            image,
            '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @notice Formats a fee in hundredths of a bip as a percentage, e.g. 3000 -> "0.3%", 100 -> "0.01%"
    function feeToString(uint24 fee) internal pure returns (string memory) {
        // fee / 10000 percent
        uint256 whole = fee / 10000;
        uint256 frac = fee % 10000;
        if (frac == 0) return string.concat(whole.toString(), "%");
        // 4 fractional digits, trim trailing zeros
        bytes memory digits = new bytes(4);
        for (uint256 i = 4; i > 0; i--) {
            digits[i - 1] = bytes1(uint8(48 + (frac % 10)));
            frac /= 10;
        }
        uint256 len = 4;
        while (len > 0 && digits[len - 1] == "0") len--;
        bytes memory trimmed = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            trimmed[i] = digits[i];
        }
        return string.concat(whole.toString(), ".", string(trimmed), "%");
    }

    function _svg(Params memory p, string memory pairName, string memory feeStr, bool inRange)
        private
        pure
        returns (string memory)
    {
        string memory status = inRange ? "In range" : "Out of range";
        string memory statusColor = inRange ? "#3ee08f" : "#ffb347";
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="290" height="500" viewBox="0 0 290 500">',
            '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
            '<stop offset="0" stop-color="#5b2bff"/><stop offset="1" stop-color="#00c2a8"/></linearGradient></defs>',
            '<rect width="290" height="500" rx="24" fill="#0d0b1a"/>',
            '<rect x="12" y="12" width="266" height="476" rx="18" fill="none" stroke="url(#g)" stroke-width="3"/>',
            '<text x="28" y="56" font-family="monospace" font-size="14" fill="#b9b3d9">MetaSwap V3 #',
            p.tokenId.toString(),
            "</text>",
            '<text x="28" y="100" font-family="sans-serif" font-weight="700" font-size="28" fill="#fff">',
            pairName,
            "</text>",
            '<text x="28" y="130" font-family="sans-serif" font-size="18" fill="#9f8cff">',
            feeStr,
            " fee</text>",
            _rangeBlock(p),
            '<circle cx="36" cy="430" r="6" fill="',
            statusColor,
            '"/><text x="50" y="435" font-family="sans-serif" font-size="14" fill="#fff">',
            status,
            "</text></svg>"
        );
    }

    function _rangeBlock(Params memory p) private pure returns (string memory) {
        return string.concat(
            '<text x="28" y="300" font-family="monospace" font-size="13" fill="#b9b3d9">Min tick: ',
            Strings.toStringSigned(int256(p.tickLower)),
            '</text><text x="28" y="324" font-family="monospace" font-size="13" fill="#b9b3d9">Max tick: ',
            Strings.toStringSigned(int256(p.tickUpper)),
            '</text><text x="28" y="348" font-family="monospace" font-size="13" fill="#b9b3d9">Current tick: ',
            Strings.toStringSigned(int256(p.tickCurrent)),
            "</text>"
        );
    }

    function _attributes(Params memory p, string memory pairName, string memory feeStr, bool inRange)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            _attr("Pair", pairName),
            ",",
            _attr("Fee Tier", feeStr),
            ",",
            _attr("Tick Lower", Strings.toStringSigned(int256(p.tickLower))),
            ",",
            _attr("Tick Upper", Strings.toStringSigned(int256(p.tickUpper))),
            ",",
            _attr("In Range", inRange ? "Yes" : "No")
        );
    }

    function _attr(string memory key, string memory value) private pure returns (string memory) {
        return string.concat('{"trait_type":"', key, '","value":"', value, '"}');
    }

    function _symbol(address token) private view returns (string memory) {
        try IERC20SymbolView(token).symbol() returns (string memory s) {
            if (bytes(s).length > 0 && bytes(s).length <= 32) return s;
        } catch {}
        return token.toHexString();
    }

    /// @dev Keeps only characters that are safe inside both JSON strings and SVG text.
    function _escape(string memory s) private pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(b.length);
        uint256 n;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (
                (c >= "0" && c <= "9") || (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c == "-" || c == "_"
                    || c == "." || c == " "
            ) {
                out[n++] = c;
            }
        }
        assembly {
            mstore(out, n)
        }
        return string(out);
    }
}
