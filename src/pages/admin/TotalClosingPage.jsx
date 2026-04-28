import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getAllSites, getFinanceItems, getClosingItems } from '../../services/siteService';
import { getFixedExpenses, saveFixedExpenses } from '../../services/fixedExpenseService';
import FixedExpensePanel from '../../components/admin/FixedExpensePanel';

const isOvertimeItem = (f) => {
  const d = (f.description || '').trim();
  return d === '잔업' || d.startsWith('잔업 -') || d.startsWith('잔업-');
};

export default function TotalClosingPage() {
  const { isAdmin, canViewSalary } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
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
        const [allSites, fixed] = await Promise.all([
          getAllSites(),
          getFixedExpenses(year, month),
        ]);
        if (cancelled) return;
        setSites(allSites);
        setFixedItems(fixed);
        const out = {};
        await Promise.all(allSites.map(async (s) => {
          const [fins, items] = await Promise.all([
            getFinanceItems(s.id, year, month),
            getClosingItems(s.id, year, month),
          ]);
          const revenue = fins.filter((f) => f.type === 'revenue').reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
          const expense = fins.filter((f) => f.type === 'expense' && !isOvertimeItem(f)).reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
          const overtime = fins.filter((f) => f.type === 'expense' && isOvertimeItem(f)).reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
          const labor = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
          out[s.id] = { revenue, expense, overtime, labor };
        }));
        if (!cancelled) setStats(out);
      } catch (err) { console.error(err); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [year, month]);

  const handleFixedChange = async (next) => {
    setFixedItems(next);
    setFixedSaving(true);
    try {
      await saveFixedExpenses(year, month, next);
    } catch (err) {
      console.error(err);
      alert('저장 중 오류가 발생했습니다.');
    } finally {
      setFixedSaving(false);
    }
  };

  const totals = useMemo(() => {
    let revenue = 0, expense = 0, overtime = 0, labor = 0;
    let revenueAll = 0; // hideRevenue 무시한 전체 매출 (참고용)
    sites.forEach((s) => {
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
  }, [sites, stats, fixedItems]);

  // 프로젝트별 정렬: 매출 큰 순
  const sortedSites = useMemo(() => {
    return [...sites].sort((a, b) => {
      const sa = stats[a.id] || {};
      const sb = stats[b.id] || {};
      return (Number(sb.revenue) || 0) - (Number(sa.revenue) || 0);
    });
  }, [sites, stats]);

  if (!isAdmin && !canViewSalary) {
    return <div className="card"><div className="card-body empty-state">접근 권한이 없습니다.</div></div>;
  }

  return (
    <div className="total-closing-page">
      <div className="page-header">
        <h2>총 마감</h2>
      </div>

      <div className="filters">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => <option key={m} value={m}>{m}월</option>)}
        </select>
      </div>

      {loading ? (
        <div className="loading">집계 중...</div>
      ) : (
        <>
          <div className="closing-summary">
            <div className="closing-summary-item">
              <span className="label">프로젝트</span>
              <strong>{sites.length}개</strong>
            </div>
            <div className="closing-summary-item">
              <span className="label">매출</span>
              <strong style={{ color: 'var(--success, #16a34a)' }}>{totals.revenue.toLocaleString()}원</strong>
            </div>
            <div className="closing-summary-item">
              <span className="label">지출</span>
              <strong style={{ color: 'var(--danger, #dc2626)' }}>{(totals.expense + totals.overtime).toLocaleString()}원</strong>
            </div>
            <div className="closing-summary-item closing-summary-total">
              <span className="label">인건비</span>
              <strong>{totals.labor.toLocaleString()}원</strong>
            </div>
            <div className="closing-summary-item closing-summary-total">
              <span className="label">잔업</span>
              <strong>{totals.overtime.toLocaleString()}원</strong>
            </div>
            {isAdmin && (
              <div className="closing-summary-item closing-summary-total">
                <span className="label">고정지출</span>
                <strong>{totals.fixed.toLocaleString()}원</strong>
              </div>
            )}
            <div className="closing-summary-item closing-summary-net">
              <span className="label">합계</span>
              <strong style={{ color: totals.balance >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {totals.balance >= 0 ? '+' : ''}{totals.balance.toLocaleString()}원
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
              <table className="table">
                <thead>
                  <tr>
                    <th>프로젝트</th>
                    <th style={{ textAlign: 'right' }}>매출</th>
                    <th style={{ textAlign: 'right' }}>지출</th>
                    <th style={{ textAlign: 'right' }}>인건비</th>
                    <th style={{ textAlign: 'right' }}>잔업</th>
                    <th style={{ textAlign: 'right' }}>합계</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSites.length === 0 && (
                    <tr><td colSpan={6} className="empty-state">표시할 프로젝트가 없습니다.</td></tr>
                  )}
                  {sortedSites.map((s) => {
                    const v = stats[s.id] || { revenue: 0, expense: 0, overtime: 0, labor: 0 };
                    const rev = s.hideRevenue ? 0 : (v.revenue || 0);
                    const totalExp = (v.expense || 0) + (v.overtime || 0) + (v.labor || 0);
                    const bal = rev - totalExp;
                    return (
                      <tr key={s.id}>
                        <td>
                          <Link to={`/sites/${s.id}/${year}/${month}`} style={{ color: 'inherit', textDecoration: 'none', fontWeight: 600 }}>
                            {s.name}
                          </Link>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {s.hideRevenue ? <span className="text-muted">-</span> : `${rev.toLocaleString()}원`}
                        </td>
                        <td style={{ textAlign: 'right' }}>{(v.expense || 0).toLocaleString()}원</td>
                        <td style={{ textAlign: 'right' }}>{(v.labor || 0).toLocaleString()}원</td>
                        <td style={{ textAlign: 'right' }}>{(v.overtime || 0).toLocaleString()}원</td>
                        <td style={{ textAlign: 'right', color: bal >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>
                          {bal >= 0 ? '+' : ''}{bal.toLocaleString()}원
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
