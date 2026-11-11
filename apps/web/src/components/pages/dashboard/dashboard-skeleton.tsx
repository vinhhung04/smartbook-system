import { Bone, GroupHeading, Panel, PanelBody, PanelHeader } from './panel';

/**
 * First-load placeholder. Same grid, same panel frames and the real titles as the loaded
 * dashboard; only the figures are bones at their real height, so nothing shifts on arrival.
 */

function ListBones({ rows, pitch = 'h-[52px]' }: { rows: number; pitch?: string }) {
  return (
    <div>
      <Bone className="mb-1 h-4 w-32" />
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className={`flex items-center justify-between gap-4 border-b border-border/70 last:border-0 ${pitch}`}>
          <span className="min-w-0 flex-1 space-y-1.5">
            <Bone className="h-4 w-2/5" />
            <Bone className="h-3 w-3/5" />
          </span>
          <Bone className="h-4 w-12" />
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton({ canViewBorrow }: { canViewBorrow: boolean }) {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Đang tải bảng điều khiển">
      <div className="grid grid-cols-1 gap-5 @5xl:grid-cols-12">
        <Panel titleId="decision-center-title" className="@5xl:col-span-8">
          <PanelHeader id="decision-center-title" title="Việc cần xử lý" description={<Bone className="mt-1 h-4 w-44" />} />
          <ul className="mt-3 border-t border-border">
            {Array.from({ length: 5 }).map((_, index) => (
              <li key={index} className="flex h-[66px] items-center gap-4 border-t border-border px-5 first:border-t-0">
                <Bone className="hidden h-6 w-24 rounded-full sm:block" />
                <span className="min-w-0 flex-1 space-y-1.5">
                  <Bone className="h-4 w-1/3" />
                  <Bone className="h-3 w-1/2" />
                </span>
                <Bone className="h-5 w-12" />
              </li>
            ))}
          </ul>
        </Panel>
        <Panel titleId="snapshot-title" className="overflow-hidden @5xl:col-span-4">
          <PanelHeader id="snapshot-title" title={canViewBorrow ? 'Tình hình thư viện' : 'Tình hình kho'} />
          <div className="@container mt-3 flex flex-1 flex-col">
            <div className="grid flex-1 auto-rows-fr grid-cols-1 gap-px border-t border-border bg-border @2xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex items-center justify-between gap-4 bg-card px-5 py-3.5">
                  <span className="space-y-1.5"><Bone className="h-4 w-24" /><Bone className="h-3 w-32" /></span>
                  <Bone className="h-8 w-16" />
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 @5xl:grid-cols-12">
        <Panel titleId="stock-risk-title" className={canViewBorrow ? '@5xl:col-span-7' : '@5xl:col-span-12'}>
          <PanelHeader id="stock-risk-title" title="Rủi ro tồn kho theo kho" description={<Bone className="mt-1 h-4 w-56" />} />
          <PanelBody className="pt-2"><ListBones rows={6} /></PanelBody>
        </Panel>
        {canViewBorrow ? (
          <Panel titleId="overdue-title" className="@5xl:col-span-5">
            <PanelHeader id="overdue-title" title="Mượn quá hạn" description={<Bone className="mt-1 h-4 w-52" />} />
            <PanelBody className="pt-2"><ListBones rows={6} /></PanelBody>
          </Panel>
        ) : null}
      </div>

      {canViewBorrow ? (
        <section aria-labelledby="analytics-title" className="space-y-5">
          <GroupHeading id="analytics-title" title="Phân tích & xu hướng" description="Lịch sử mượn trả, đặt trước và tiền phạt" />
          <div className="grid grid-cols-1 gap-5 @5xl:grid-cols-12">
            <Panel titleId="trend-title" className="@5xl:col-span-8">
              <PanelHeader id="trend-title" level={3} title="Mượn, trả và đặt trước theo ngày" description={<Bone className="mt-1 h-4 w-48" />} />
              <PanelBody>
                <div className="flex gap-8">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <span key={index} className="space-y-1.5"><Bone className="h-3 w-14" /><Bone className="h-6 w-12" /></span>
                  ))}
                </div>
                <Bone className="mt-4 h-[240px] w-full" />
              </PanelBody>
            </Panel>
            <Panel titleId="reservation-title" className="@5xl:col-span-4">
              <PanelHeader id="reservation-title" level={3} title="Đặt trước" description={<Bone className="mt-1 h-4 w-40" />} />
              <PanelBody>
                <Bone className="h-2.5 w-full rounded-full" />
                <div className="mt-3 space-y-3">
                  {Array.from({ length: 3 }).map((_, index) => <Bone key={index} className="h-4 w-full" />)}
                </div>
                <Bone className="mt-6 h-[104px] w-full rounded-lg" />
              </PanelBody>
            </Panel>
          </div>
          <div className="grid grid-cols-1 gap-5 @5xl:grid-cols-12">
            <Panel titleId="top-books-title" className="@5xl:col-span-5">
              <PanelHeader id="top-books-title" level={3} title="Sách được mượn nhiều nhất" description="Xếp hạng theo tổng lượt mượn" />
              <PanelBody><ListBones rows={4} pitch="h-11" /></PanelBody>
            </Panel>
            <Panel titleId="fines-title" className="@5xl:col-span-7">
              <PanelHeader id="fines-title" level={3} title="Tiền phạt" description={<Bone className="mt-1 h-4 w-60" />} />
              <PanelBody>
                <Bone className="h-2.5 w-full rounded-full" />
                <div className="mt-3 grid grid-cols-3 gap-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <span key={index} className="space-y-1.5"><Bone className="h-3 w-16" /><Bone className="h-6 w-24" /></span>
                  ))}
                </div>
                <div className="mt-5"><ListBones rows={3} pitch="h-9" /></div>
              </PanelBody>
            </Panel>
          </div>
        </section>
      ) : null}
    </div>
  );
}
