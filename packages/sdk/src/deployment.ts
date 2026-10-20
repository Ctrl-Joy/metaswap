import type { Address } from 'viem'
import deploymentJson from './generated/deployment.json'

export type ContractName =
  | 'WETH9'
  | 'Multicall3'
  | 'V2Factory'
  | 'V2Router02'
  | 'V3Factory'
  | 'NonfungiblePositionManager'
  | 'SwapRouter02'
  | 'QuoterV2'
  | 'TickLens'
  | 'Permit2'
  | 'UniversalRouter'
  | 'ExclusiveDutchOrderReactor'
  | 'SwapRouter02Executor'

export interface DeployedToken {
  symbol: string
  name: string
  decimals: number
  address: Address
  seedPriceUsd: number
}

export interface DeployedV2Pool {
  address: Address
  token0: Address
  token1: Address
}

export interface DeployedV3Pool extends DeployedV2Pool {
  fee: number
}

export interface Deployment {
  chainId: number
  blockNumber: number
  contracts: Record<ContractName, Address>
  tokens: DeployedToken[]
  pools: { v2: DeployedV2Pool[]; v3: DeployedV3Pool[] }
}

export const deployment = deploymentJson as unknown as Deployment

export function contractAddress(name: ContractName): Address {
  const address = deployment.contracts[name]
  if (!address) throw new Error(`Contract ${name} is not in the deployment file; re-run the deploy scripts and sdk sync`)
  return address
}
