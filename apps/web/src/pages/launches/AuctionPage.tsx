import { useParams } from 'react-router-dom'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { t } from '@/i18n'
import { AuctionDetail } from '@/features/launches/AuctionDetail'

export default function AuctionPage() {
  const { auction } = useParams()
  useDocumentTitle(t('Auction'))
  return <AuctionDetail auctionParam={auction} />
}
