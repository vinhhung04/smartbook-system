import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Alert, Text, View } from 'react-native';

import * as customerBorrowApi from '../../../../src/api/customerBorrow';
import { ApiError } from '../../../../src/auth/auth-context';
import { getDueState, getLoanStatusDisplay, getRenewalView } from '../../../../src/lib/loanStatus';
import { useSubmitLock } from '../../../../src/lib/submitLock';
import { Button, Card, ErrorState, InfoRow, InlineAlert, LoadingState, Screen, ScreenHeader, SectionHeader, StatusBadge, fontFamily, space, useTheme } from '../../../../src/design-system';
import type { Loan } from '../../../../src/types/borrow';

export default function CustomerLoanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, type } = useTheme();
  const [loan, setLoan] = useState<Loan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRenewing, setIsRenewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renewLock = useSubmitLock();

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await customerBorrowApi.getMyLoanById(id);
      setLoan(result.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được thông tin mượn sách');
    }
  }, [id]);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  async function handleRenewRequest() {
    await renewLock.run(async () => {
      setIsRenewing(true);
      try {
        const result = await customerBorrowApi.requestMyLoanRenewal(id);
        Alert.alert(
          'Đã gửi yêu cầu gia hạn',
          `Thư viện sẽ xem xét gia hạn thêm ${result.data.requested_extension_days} ngày.`,
        );
      } catch (err) {
        Alert.alert('Không gửi được yêu cầu', err instanceof ApiError ? err.message : 'Vui lòng thử lại sau.');
      } finally {
        // Either way, show the server's view: a request that did land (lost response)
        // turns the button into "đang chờ duyệt" instead of inviting a second one.
        await load();
        setIsRenewing(false);
      }
    });
  }

  const due = loan ? getDueState(loan.due_date, loan.status) : null;
  const renewal = loan ? getRenewalView(loan.status, loan.renewal) : null;

  const title = loan ? `Phiếu ${loan.loan_number}` : 'Chi tiết mượn sách';
  if (isLoading) {
    return (<><ScreenHeader title={title} /><Screen scroll={false}><LoadingState /></Screen></>);
  }
  if (error || !loan) {
    return (<><ScreenHeader title={title} /><Screen scroll={false}><ErrorState message={error ?? 'Không tìm thấy lượt mượn'} onRetry={() => { setIsLoading(true); void load().finally(() => setIsLoading(false)); }} /></Screen></>);
  }

  const status = getLoanStatusDisplay(loan.status);
  const daysText = due && due.kind !== 'closed' ? due.label : null;

  return (
    <>
      <ScreenHeader title={title} />
      <Screen
        onRefresh={() => void load()}
        footer={renewal?.canRequest ? (
          <Button label="Yêu cầu gia hạn" icon="refresh" loading={isRenewing} loadingLabel="Đang gửi yêu cầu…" onPress={handleRenewRequest} />
        ) : undefined}
      >
        {/* The date that matters, first and large; the rest follows. */}
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {status ? <StatusBadge tone={status.tone} label={status.label} /> : null}
            {due && (due.kind === 'overdue' || due.kind === 'soon') ? <StatusBadge tone={due.kind === 'overdue' ? 'danger' : 'warning'} label={due.label} icon="alarm" /> : null}
          </View>
          <Text style={type.caption}>Hạn trả</Text>
          <Text style={{ fontFamily: fontFamily.serif, fontSize: 34, lineHeight: 40, color: due?.kind === 'overdue' ? colors.danger : colors.textPrimary }}>
            {new Date(loan.due_date).toLocaleDateString('vi-VN')}
          </Text>
          {daysText && due?.kind !== 'overdue' ? <Text style={type.callout}>{daysText}</Text> : null}
        </View>

        {due?.kind === 'overdue' ? (
          <InlineAlert tone="danger" title="Sách đã quá hạn trả" message="Phí phạt trả trễ có thể phát sinh theo quy định của thư viện. Hãy trả sách hoặc gửi yêu cầu gia hạn." />
        ) : null}
        {renewal?.note ? <InlineAlert tone="info" message={renewal.note} /> : null}

        <Card>
          <InfoRow label="Ngày mượn" value={new Date(loan.borrow_date).toLocaleDateString('vi-VN')} />
          <InfoRow label="Hạn trả" value={new Date(loan.due_date).toLocaleDateString('vi-VN')} />
          <InfoRow label="Số đầu sách" value={String(loan.total_items)} />
          <InfoRow label="Mã phiếu" value={loan.loan_number} mono />
        </Card>

        {loan.loan_items && loan.loan_items.length > 0 ? (
          <View style={{ gap: space.md }}>
            <SectionHeader title="Sách trong lượt mượn" />
            <Card>
              {loan.loan_items.map((item, index) => {
                const itemStatus = getLoanStatusDisplay(item.status as Loan['status']);
                return (
                  <View key={item.id} style={{ gap: 4, paddingTop: index > 0 ? space.md : 0, borderTopWidth: index > 0 ? 1 : 0, borderTopColor: colors.border }}>
                    <Text style={{ fontFamily: fontFamily.serif, fontSize: 17, lineHeight: 22, color: colors.textPrimary }} numberOfLines={2}>{item.book_title ?? 'Sách chưa có tên'}</Text>
                    {item.book_author ? <Text style={type.caption}>{item.book_author}</Text> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
                      <Text selectable style={{ fontFamily: fontFamily.mono, fontSize: 13.5, color: colors.textSecondary }}>{item.item_barcode ?? item.id.slice(0, 8)}</Text>
                      {itemStatus ? <StatusBadge tone={itemStatus.tone} label={itemStatus.label} /> : <Text style={type.caption}>{item.status}</Text>}
                    </View>
                  </View>
                );
              })}
            </Card>
          </View>
        ) : null}
      </Screen>
    </>
  );
}
