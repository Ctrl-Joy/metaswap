import { useParams } from 'react-router-dom'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { V3PositionDetail } from '@/features/positions/detail/V3PositionDetail'
import { V2PositionDetail } from '@/features/positions/detail/V2PositionDetail'
import { t } from '@/i18n'

export default function PositionDetailPage({ version }: { version: 'v2' | 'v3' }) {
  const { tokenId, pair } = useParams()
  useDocumentTitle(version === 'v3' ? t('Position #{id}', { id: tokenId ?? '' }) : t('V2 position'))
  return version === 'v3' ? <V3PositionDetail tokenIdParam={tokenId} /> : <V2PositionDetail pairParam={pair} />
}
