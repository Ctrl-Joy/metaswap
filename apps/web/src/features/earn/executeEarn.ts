import { readContract, writeContract } from 'wagmi/actions'
import { maxUint256, type Address } from 'viem'
import { wagmiConfig } from '@/wallet/wagmi'
import { erc20Abi, savingsVaultAbi } from '@/lib/abis'
import { trackTx } from '@/state/transactions'

export type EarnStep = 'approve' | 'deposit' | 'withdraw'

async function track(account: Address, hash: `0x${string}`, type: 'approve' | 'earn-deposit' | 'earn-withdraw', summary: string, toast = true) {
  const r = await trackTx(account, { hash, type, summary }, { toast })
  if (!r || r.status !== 'success') throw new Error(`${summary} reverted`)
  return r
}

/** ERC20 approve(vault) if needed → deposit(assets, me); or depositETH(me) with value for the ETH vault. */
export async function depositToVault(
  a: { account: Address; vault: Address; asset: Address; amount: bigint; native: boolean; label: string },
  onStep: (s: EarnStep, st: 'active' | 'done' | 'skipped') => void,
) {
  if (a.native) {
    onStep('approve', 'skipped')
    onStep('deposit', 'active')
    const hash = await writeContract(wagmiConfig, { address: a.vault, abi: savingsVaultAbi, functionName: 'depositETH', args: [a.account], value: a.amount })
    await track(a.account, hash, 'earn-deposit', `Deposited ${a.label}`)
    onStep('deposit', 'done')
    return hash
  }
  const allowance = await readContract(wagmiConfig, { address: a.asset, abi: erc20Abi, functionName: 'allowance', args: [a.account, a.vault] })
  if (allowance < a.amount) {
    onStep('approve', 'active')
    const h = await writeContract(wagmiConfig, { address: a.asset, abi: erc20Abi, functionName: 'approve', args: [a.vault, maxUint256] })
    await track(a.account, h, 'approve', 'Approved vault deposit', false)
    onStep('approve', 'done')
  } else onStep('approve', 'skipped')
  onStep('deposit', 'active')
  const hash = await writeContract(wagmiConfig, { address: a.vault, abi: savingsVaultAbi, functionName: 'deposit', args: [a.amount, a.account] })
  await track(a.account, hash, 'earn-deposit', `Deposited ${a.label}`)
  onStep('deposit', 'done')
  return hash
}

/**
 * Withdraw `amount` assets (withdraw / withdrawETH). With `all`, redeem every share instead so no
 * dust is left behind as the index keeps accruing (ETH vault: withdrawETH(maxWithdraw)).
 */
export async function withdrawFromVault(
  a: { account: Address; vault: Address; amount: bigint; all: boolean; shares: bigint; native: boolean; label: string },
  onStep: (s: EarnStep, st: 'active' | 'done' | 'skipped') => void,
) {
  onStep('withdraw', 'active')
  let hash: `0x${string}`
  if (a.native) {
    const amount = a.all ? await readContract(wagmiConfig, { address: a.vault, abi: savingsVaultAbi, functionName: 'maxWithdraw', args: [a.account] }) : a.amount
    hash = await writeContract(wagmiConfig, { address: a.vault, abi: savingsVaultAbi, functionName: 'withdrawETH', args: [amount, a.account, a.account] })
  } else if (a.all) {
    hash = await writeContract(wagmiConfig, { address: a.vault, abi: savingsVaultAbi, functionName: 'redeem', args: [a.shares, a.account, a.account] })
  } else {
    hash = await writeContract(wagmiConfig, { address: a.vault, abi: savingsVaultAbi, functionName: 'withdraw', args: [a.amount, a.account, a.account] })
  }
  await track(a.account, hash, 'earn-withdraw', `Withdrew ${a.label}`)
  onStep('withdraw', 'done')
  return hash
}
