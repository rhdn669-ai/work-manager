import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/useAuth';
import { getWeeklySummary, getOvertimeSummaries, getOvertimeWarningLevel } from '../../services/overtimeService';
import { getWeekStart, formatMinutes, getDayName } from '../../utils/dateUtils';
import { WEEKLY_OVERTIME_LIMIT } from '../../utils/constants';
import Skeleton from '../../components/common/Skeleton';

export default function OvertimePage() {
  const { userProfile } = useAuth();
  const [currentWeek, setCurrentWeek] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userProfile) loadData();
  }, [userProfile]);

  async function loadData() {
    try {
      const weekly = await getWeeklySummary(userProfile.uid, new Date());
      setCurrentWeek(weekly);

      // 최근 8주 조회
      const now = new Date();
      const eightWeeksAgo = new Date(now);
      eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
      const summaries = await getOvertimeSummaries(userProfile.uid, getWeekStart(eightWeeksAgo), getWeekStart(now));
      setHistory(summaries);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <Skeleton.Rows count={6} />;

  const warningLevel = currentWeek ? getOvertimeWarningLevel(currentWeek.totalOvertimeMinutes) : 'safe';
  const percentage = currentWeek ? Math.min(100, (currentWeek.totalOvertimeMinutes / WEEKLY_OVERTIME_LIMIT) * 100) : 0;

  return (
    <div className="overtime-page">
      <h2>초과근무 현황</h2>

      {/* 이번 주 현황 */}
      <div className={`card card-${warningLevel}`}>
        <div className="card-header">이번 주 초과근무</div>
        <div className="card-body">
          {currentWeek ? (
            <>
              <div className="stat-big">
                {formatMinutes(currentWeek.totalOvertimeMinutes)}
                <span className="stat-sub"> / {formatMinutes(WEEKLY_OVERTIME_LIMIT)}</span>
              </div>
              <div className="overtime-bar">
                <div className={`overtime-fill overtime-${warningLevel}`} style={{ width: `${percentage}%` }} />
              </div>
              {warningLevel === 'danger' && (
                <div className="alert alert-error">주간 연장근로 한도(12시간)를 초과했습니다!</div>
              )}
              {warningLevel === 'warning' && (
                <div className="alert alert-warning">주간 연장근로 한도의 83%에 도달했습니다.</div>
              )}

              {/* 일별 상세 */}
              {currentWeek.dailyBreakdown && Object.keys(currentWeek.dailyBreakdown).length > 0 && (
                <div className="daily-breakdown">
                  <h4>일별 상세</h4>
                  {Object.entries(currentWeek.dailyBreakdown)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .filter(([, minutes]) => minutes > 0)
                    .map(([date, minutes]) => {
                      const shortDate = date.replace(/^\d{4}-/, '').replace(/^0/, '');
                      return (
                        <div key={date} className="stat-row" style={{ alignItems: 'baseline' }}>
                          <span style={{ fontSize: 12, lineHeight: 1.4, whiteSpace: 'nowrap' }} title={date}>
                            {shortDate} ({getDayName(date)})
                          </span>
                          <strong style={{ fontSize: 12, lineHeight: 1.4 }}>{formatMinutes(minutes)}</strong>
                        </div>
                      );
                    })}
                </div>
              )}
            </>
          ) : (
            <p className="text-muted">이번 주 초과근무 기록이 없습니다.</p>
          )}
        </div>
      </div>

      {/* 주간 이력 */}
      <div className="card">
        <div className="card-header">최근 8주 이력</div>
        <div className="card-body">
          {history.length === 0 ? (
            <p className="text-muted">이력이 없습니다.</p>
          ) : (
            <div className="table-scroll-x">
              <table className="table cards-sm">
                <thead>
                  <tr>
                    <th scope="col">주 시작일</th>
                    <th scope="col">초과근무</th>
                    <th scope="col">한도 대비</th>
                    <th scope="col">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((s) => {
                    const level = getOvertimeWarningLevel(s.totalOvertimeMinutes);
                    const pct = Math.round((s.totalOvertimeMinutes / WEEKLY_OVERTIME_LIMIT) * 100);
                    return (
                      <tr key={s.id}>
                        <td data-label="주 시작일">{s.weekStart}</td>
                        <td data-label="초과근무">{formatMinutes(s.totalOvertimeMinutes)}</td>
                        <td data-label="한도 대비">{pct}%</td>
                        <td data-label="상태">
                          <span className={`badge badge-${level}`}>
                            {level === 'danger'
                              ? '초과'
                              : level === 'warning'
                                ? '경고'
                                : level === 'caution'
                                  ? '주의'
                                  : '정상'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
