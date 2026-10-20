import type { Token } from '@metaswap/sdk'

export type Field = 'INPUT' | 'OUTPUT'

export interface SwapFormState {
  /** Which side the user typed: INPUT = exact-in, OUTPUT = exact-out. */
  independentField: Field
  typedValue: string
  inputToken?: Token
  outputToken?: Token
}

export type SwapAction =
  | { type: 'selectToken'; field: Field; token: Token }
  | { type: 'typeInput'; field: Field; value: string }
  | { type: 'flip'; /** Derived amount of the dependent side, keeps the visual amount when flipping. */ dependentValue?: string }
  | { type: 'setTokens'; input?: Token; output?: Token }
  | { type: 'clearAmount' }

const same = (a?: Token, b?: Token) => !!a && !!b && a.address.toLowerCase() === b.address.toLowerCase()

export function swapReducer(state: SwapFormState, action: SwapAction): SwapFormState {
  switch (action.type) {
    case 'selectToken': {
      const key = action.field === 'INPUT' ? 'inputToken' : 'outputToken'
      const otherKey = action.field === 'INPUT' ? 'outputToken' : 'inputToken'
      // Choosing the token already on the other side swaps the two sides (Uniswap behaviour).
      if (same(action.token, state[otherKey])) {
        return {
          ...state,
          [key]: action.token,
          [otherKey]: state[key],
          independentField: state.independentField === 'INPUT' ? 'OUTPUT' : 'INPUT',
        }
      }
      return { ...state, [key]: action.token }
    }
    case 'typeInput':
      return { ...state, independentField: action.field, typedValue: action.value }
    case 'flip':
      return {
        independentField: state.independentField === 'INPUT' ? 'OUTPUT' : 'INPUT',
        typedValue: state.typedValue,
        inputToken: state.outputToken,
        outputToken: state.inputToken,
      }
    case 'setTokens':
      return { ...state, inputToken: action.input, outputToken: same(action.input, action.output) ? undefined : action.output }
    case 'clearAmount':
      return { ...state, typedValue: '' }
    default:
      return state
  }
}

export type WrapType = 'wrap' | 'unwrap' | null

/** ETH→WETH = wrap, WETH→ETH = unwrap (done directly on WETH9, no router). */
export function getWrapType(input: Token | undefined, output: Token | undefined, wethAddress: string | undefined): WrapType {
  if (!input || !output || !wethAddress) return null
  const w = wethAddress.toLowerCase()
  if (input.isNative && output.address.toLowerCase() === w) return 'wrap'
  if (output.isNative && input.address.toLowerCase() === w) return 'unwrap'
  return null
}
