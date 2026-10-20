import { erc20Abi, parseAbi } from 'viem'

// Minimal, hand-written ABIs for the calls the web app makes directly. They use the
// Uniswap-compatible function names documented in docs/analysis/protocol.md, so the app
// does not depend on packages/sdk/src/generated/abis.ts being synced.

export { erc20Abi }

export const weth9Abi = parseAbi([
  'function deposit() payable',
  'function withdraw(uint256 wad)',
  'function balanceOf(address) view returns (uint256)',
])

export const testErc20Abi = parseAbi([
  'function faucet()',
  'function faucetAmount() view returns (uint256)',
  'function faucetAvailableIn(address account) view returns (uint256)',
  'function mint(address to, uint256 amount)',
])

export const permit2Abi = parseAbi([
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function nonceBitmap(address owner, uint256 wordPos) view returns (uint256)',
  'function invalidateUnorderedNonces(uint256 wordPos, uint256 mask)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
])

/** Custom errors we map to friendly messages (router, Permit2, reactor). */
export const knownErrorsAbi = parseAbi([
  'error V2TooLittleReceived()',
  'error V2TooMuchRequested()',
  'error V3TooLittleReceived()',
  'error V3TooMuchRequested()',
  'error TransactionDeadlinePassed()',
  'error InsufficientToken()',
  'error InsufficientETH()',
  'error BalanceTooLow()',
  'error V2InvalidReserves()',
  'error V3InvalidSwap()',
  'error V3PoolNotFound()',
  'error V2PairNotFound()',
  'error SignatureExpired(uint256 signatureDeadline)',
  'error InvalidNonce()',
  'error AllowanceExpired(uint256 deadline)',
  'error InsufficientAllowance(uint256 amount)',
  'error InvalidAmount(uint256 maxAmount)',
  'error ExecutionFailed(uint256 commandIndex, bytes message)',
  'error DeadlineBeforeEndTime()',
  'error InputAndOutputDecay()',
])

/** ERC-4626 + MetaSwapSavingsVault extras (docs/specs/STAGE5.md §1a). */
export const savingsVaultAbi = parseAbi([
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function convertToShares(uint256 assets) view returns (uint256)',
  'function maxWithdraw(address owner) view returns (uint256)',
  'function maxRedeem(address owner) view returns (uint256)',
  'function previewDeposit(uint256 assets) view returns (uint256)',
  'function previewRedeem(uint256 shares) view returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)',
  'function depositETH(address receiver) payable returns (uint256 shares)',
  'function withdrawETH(uint256 assets, address receiver, address owner) returns (uint256 shares)',
  'function apyBps() view returns (uint256)',
])
