import { useParams } from 'react-router-dom'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { AuctionDetail } from '@/features/launches/AuctionDetail'

export default function AuctionPage() {
  const { auction } = useParams()
  useDocumentTitle('Auction')
  return <AuctionDetail auctionParam={auction} />
}
