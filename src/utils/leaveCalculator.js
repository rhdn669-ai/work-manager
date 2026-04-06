import { MAX_ANNUAL_LEAVE, BASE_ANNUAL_LEAVE, MONTHLY_LEAVE_MAX } from './constants';
import { getYearsOfService, getMonthsOfService } from './dateUtils';

/**
 * 한국 노동법 기준 연차 일수 계산 (현재 시점 기준 실제 발생분)
 * - 1년 미만: 실제 근무 개월수만큼 (월 1일, 최대 11일)
 * - 1년 이상: 15일
 * - 3년차(근속 2년)부터 2년마다 +1일 (최대 25일)
 */
export function calculateAnnualLeave(joinDate, targetYear) {
  const joinD = new Date(joinDate);
  const now = new Date();
  const targetYearStart = new Date(targetYear, 0, 1);

  const yearsAtYearStart = getYearsOfService(joinD, targetYearStart);

  // 입사년도이거나 1년 미만
  if (yearsAtYearStart < 1) {
    // 현재까지 실제 근무한 개월수
    const months = getMonthsOfService(joinD, now);
    return Math.min(months, MONTHLY_LEAVE_MAX);
  }

  // 1년 이상 2년 미만
  if (yearsAtYearStart < 2) {
    return BASE_ANNUAL_LEAVE;
  }

  // 3년차(근속 2년) 이상: 2년마다 1일 추가
  const additionalDays = Math.floor((yearsAtYearStart - 1) / 2);
  return Math.min(BASE_ANNUAL_LEAVE + additionalDays, MAX_ANNUAL_LEAVE);
}
