import { MAX_ANNUAL_LEAVE, BASE_ANNUAL_LEAVE, MONTHLY_LEAVE_MAX } from './constants';
import { getYearsOfService, getMonthsOfService } from './dateUtils';

/**
 * 입사일부터 asOf까지 누적 발생한 총 연월차
 * (미사용 이월 방침: 월차/연차 모두 소멸 없이 누적)
 * - 입사 1년 미만: 월 1일씩 (최대 11일)
 * - 근속 1년 완료마다 연차 발생
 *   - 1~2년차: 15일
 *   - 3년차부터 2년마다 +1일, 최대 25일
 */
export function calculateAccruedLeave(joinDate, asOf = new Date()) {
  const months = getMonthsOfService(joinDate, asOf);
  const years = getYearsOfService(joinDate, asOf);

  // 월차: 1년 미만 동안 월 1일씩, 최대 11일
  const monthlyLeave = years >= 1 ? MONTHLY_LEAVE_MAX : Math.min(months, MONTHLY_LEAVE_MAX);

  // 연차: 근속 1~years년 완료 시점마다 발생분 합산
  let annualLeave = 0;
  for (let n = 1; n <= years; n++) {
    annualLeave += Math.min(BASE_ANNUAL_LEAVE + Math.floor((n - 1) / 2), MAX_ANNUAL_LEAVE);
  }

  return monthlyLeave + annualLeave;
}
