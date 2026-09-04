import { FineItem } from './fine-item';

interface FineCardProps {
  fine: any;
}

export function FineCard({ fine }: FineCardProps) {
  return <FineItem fine={fine} />;
}
