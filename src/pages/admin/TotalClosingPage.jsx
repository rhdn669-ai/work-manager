import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import { getAllSites, getFinanceItems, getClosingItems } from '../../services/siteService';
import { getFixedExpenses, saveFixedExpenses } from '../../services/fixedExpenseService';
import FixedExpensePanel from '../../components/admin/FixedExpensePanel';
import Select from '../../components/common/Select';
import Skeleton from '../../components/common/Skeleton';
import { useDialog } from '../../components/common/useDialog';

const isOvertimeItem = (f) => {
  const d = (f.description || '').trim();
  return d === '잔업' || d.startsWith('잔업 -') || d.startsWith('잔업-');
};

export default function TotalClosingPage() {
  const { isAdmin, canViewSalary } = useAuth();
  const { toast } = useDialog();
  const navigate = useNavigate();
  const now = new Date();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlY = Number(searchParams.get('y'));
  const urlM = Number(searchParams.get('m'));
  const year = urlY >= 2024 && urlY <= 2030 ? urlY : now.getFullYear();
  const month = urlM >= 1 && urlM <= 12 ? urlM : now.getMonth() + 1;
  const setYear = (v) => {
    const next = new URLSearchParams(searchParams);
    next.set('y', String(v));
    setSearchParams(next, { replace: false });
  };
  const setMonth = (v) => {
    const next = new URLSearchParams(searchParams);
    next.set('m', String(v));
    setSearchParams(next, { replace: false });
  };
  const [sites, setSites] = useState([]);
  const [stats, setStats] = useState({}); // { siteId: { revenue, expense, overtime, labor } }
  const [loading, setLoading] = useState(true);
  const [fixedItems, setFixedItems] = useState([]);
  const [fixedSaving, setFixedSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [allSites, fixed] = await Promise.all([getAllSites(), getFixedExpenses(year, month)]);
        if (cancelled) return;
        setSites(allSites);
        setFixedItems(fixed);
        const out = {};
        await Promise.all(
          allSites.map(async (s) => {
            const [fins, items] = await Promise.all([
              getFinanceItems(s.id, year, month),
              getClosingItems(s.id, year, month),
            ]);
            const revenue = fins
              .filter((f) => f.type === 'revenue')
              .reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
            const expense = fins
              .filter((f) => f.type === 'expense' && !isOvertimeItem(f))
              .reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
            const overtime = fins
              .filter((f) => f.type === 'expense' && isOvertimeItem(f))
              .reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
            const labor = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
            out[s.id] = { revenue, expense, overtime, labor };
          }),
        );
        if (!cancelled) setStats(out);
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year, month]);

  const handleFixedChange = async (next) => {
    setFixedItems(next);
    setFixedSaving(true);
    try {
      await saveFixedExpenses(year, month, next);
    } catch (err) {
      console.error(err);
      toast('저장 중 오류가 발생했습니다', 'error');
    } finally {
      setFixedSaving(false);
    }
  };

  // 마감(완료)된 프로젝트가 종료월 이후 월에 노출되는 것을 방지.
  // 단, 해당 월에 정산 데이터(매출/지출/잔업/인건비)가 한 푼이라도 잡혀있으면 표시 — 잔여 정산 누락 방지.
  const visibleSites = useMemo(() => {
    const curIdx = year * 12 + month;
    return sites.filter((s) => {
      const v = stats[s.id] || {};
      const hasData =
        (Number(v.revenue) || 0) + (Number(v.expense) || 0) + (Number(v.overtime) || 0) + (Number(v.labor) || 0) > 0;
      if (hasData) return true;
      if (s.status !== 'completed') return true;
      const ey = Number(s.endYear) || 0;
      const em = Number(s.endMonth) || 0;
      const endIdx = ey && em ? ey * 12 + em : 0;
      // 단발성(once): 마감되면 끝 — 종료월 이후 또는 종료월 미설정이면 숨김 (이번 달 데이터 없을 때)
      if ((s.projectType || 'recurring') === 'once') {
        return endIdx ? endIdx >= curIdx : false;
      }
      // 양산형(recurring): 종료월 미설정이면 계속 표시, 설정 시 종료월 이후 숨김
      if (!endIdx) return true;
      return endIdx >= curIdx;
    });
  }, [sites, stats, year, month]);

  const totals = useMemo(() => {
    let revenue = 0,
      expense = 0,
      overtime = 0,
      labor = 0;
    let revenueAll = 0; // hideRevenue 무시한 전체 매출 (참고용)
    visibleSites.forEach((s) => {
      const v = stats[s.id] || {};
      const r = Number(v.revenue) || 0;
      const e = Number(v.expense) || 0;
      const o = Number(v.overtime) || 0;
      const l = Number(v.labor) || 0;
      revenueAll += r;
      if (!s.hideRevenue) revenue += r;
      expense += e;
      overtime += o;
      labor += l;
    });
    const fixed = fixedItems.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
    const totalExpense = expense + overtime + labor + fixed;
    const balance = revenue - totalExpense;
    return { revenue, revenueAll, expense, overtime, labor, fixed, totalExpense, balance };
  }, [visibleSites, stats, fixedItems]);

  // 프로젝트별 정렬: 매출 큰 순
  const sortedSites = useMemo(() => {
    return [...visibleSites].sort((a, b) => {
      const sa = stats[a.id] || {};
      const sb = stats[b.id] || {};
      return (Number(sb.revenue) || 0) - (Number(sa.revenue) || 0);
    });
  }, [visibleSites, stats]);

  if (!isAdmin && !canViewSalary) {
    return (
      <div className="card">
        <div className="card-body empty-state">접근 권한이 없습니다.</div>
      </div>
    );
  }

  return (
    <div className="total-closing-page">
      <div className="page-header">
        <h2>총 마감</h2>
      </div>

      <div className="filters">
        <Select
          value={year}
          onChange={(v) => setYear(Number(v))}
          options={[2024, 2025, 2026, 2027, 2028].map((y) => ({ value: y, label: `${y}년` }))}
          ariaLabel="연도 선택"
        />
        <Select
          value={month}
          onChange={(v) => setMonth(Number(v))}
          options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({ value: m, label: `${m}월` }))}
          ariaLabel="월 선택"
        />
      </div>

      {loading ? (
        <Skeleton.Rows count={6} />
      ) : (
        <>
          <div className="closing-summary">
            <div className="closing-summary-item">
              <span className="label">프로젝트</span>
              <strong>{visibleSites.length}개</strong>
            </div>
            <div className="closing-summary-item">
              <span className="label">매출</span>
              <strong style={{ color: 'var(--primary, #002050)', fontVariantNumeric: 'tabular-nums' }}>
                {totals.revenue.toLocaleString()}원
              </strong>
            </div>
            <div className="closing-summary-item">
              <span className="label">지출</span>
              <strong style={{ color: 'var(--primary, #002050)', fontVariantNumeric: 'tabular-nums' }}>
                {(totals.expense + totals.overtime).toLocaleString()}원
              </strong>
            </div>
            <div className="closing-summary-item closing-summary-total">
              <span className="label">인건비</span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{totals.labor.toLocaleString()}원</strong>
            </div>
            <div className="closing-summary-item closing-summary-total">
              <span className="label">잔업</span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{totals.overtime.toLocaleString()}원</strong>
            </div>
            {isAdmin && (
              <div className="closing-summary-item closing-summary-total">
                <span className="label">고정지출</span>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{totals.fixed.toLocaleString()}원</strong>
              </div>
            )}
            <div
              className="closing-summary-item closing-summary-net"
              style={{ border: '2px solid var(--primary, #002050)', background: 'var(--primary-soft, #e6ecf5)' }}
            >
              <span className="label">합계</span>
              <strong
                style={{
                  color: totals.balance >= 0 ? 'var(--success)' : 'var(--danger)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {totals.balance >= 0 ? '+' : ''}
                {totals.balance.toLocaleString()}원
              </strong>
            </div>
          </div>

          {isAdmin && (
            <FixedExpensePanel
              year={year}
              month={month}
              items={fixedItems}
              onChange={handleFixedChange}
              saving={fixedSaving}
            />
          )}

          <div className="card">
            <div className="card-body" style={{ padding: 0 }}>
              <div className="table-scroll-x">
                <table className="table cards-sm">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 80 }}>프로젝트</th>
                      <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }} title="매출">
                        매출
                      </th>
                      <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }} title="지출">
                        지출
                      </th>
                      <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }} title="인건비">
                        인건비
                      </th>
                      <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }} title="잔업">
                        잔업
                      </th>
                      <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }} title="합계">
                        합계
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSites.length === 0 && (
                      <tr>
                        <td colSpan={6}>
                          <div className="empty-state">표시할 프로젝트가 없습니다.</div>
                        </td>
                      </tr>
                    )}
                    {sortedSites.map((s) => {
                      const v = stats[s.id] || { revenue: 0, expense: 0, overtime: 0, labor: 0 };
                      const rev = s.hideRevenue ? 0 : v.revenue || 0;
                      const totalExp = (v.expense || 0) + (v.overtime || 0) + (v.labor || 0);
                      const bal = rev - totalExp;
                      return (
                        <tr
                          key={s.id}
                          onClick={() => navigate(`/sites/${s.id}/${year}/${month}`)}
                          className="table-clickable-row"
                          style={{ cursor: 'pointer' }}
                        >
                          <td data-label="프로젝트" title={s.name} style={{ fontWeight: 600, wordBreak: 'break-word' }}>
                            {s.name}
                          </td>
                          <td data-label="매출" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {s.hideRevenue ? <span className="text-muted">-</span> : `${rev.toLocaleString()}원`}
                          </td>
                          <td data-label="지출" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {(v.expense || 0).toLocaleString()}원
                          </td>
                          <td data-label="인건비" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {(v.labor || 0).toLocaleString()}원
                          </td>
                          <td data-label="잔업" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {(v.overtime || 0).toLocaleString()}원
                          </td>
                          <td
                            data-label="합계"
                            style={{
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              color: bal >= 0 ? 'var(--success)' : 'var(--danger)',
                              fontWeight: 700,
                            }}
                          >
                            {bal >= 0 ? '+' : ''}
                            {bal.toLocaleString()}원
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
