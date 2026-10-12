const moneyFormat = new Intl.NumberFormat('vi-VN');

/** "12 tháng" for whole years, otherwise days. */
export function validityLabel(days: number) {
  return days % 365 === 0 ? `${(days / 365) * 12} tháng` : `${days} ngày`;
}

/** Plan fee; 0 means the plan is free. */
export function priceLabel(price: number) {
  return price > 0 ? `${moneyFormat.format(price)} đ` : 'Miễn phí';
}
