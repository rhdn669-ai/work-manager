import { MAX_ANNUAL_LEAVE, BASE_ANNUAL_LEAVE, MONTHLY_LEAVE_MAX } from './constants';
import { getYearsOfService, getMonthsOfService } from './dateUtils';

/**
 * 한국 노동법 기준 연차 일수 계산
 * - 1년 미만: 매월 1일 (최대 11일)
 * - 1년 이상: 15일
 * - 3년차(근속 2년)부터 2년마다 +1일 (최대 25일)
 */
export function calculateAnnualLeave(joinDate, targetYear) {
  const joinD = new Date(joinDate);
  const targetYearStart = new Date(targetYear, 0, 1);
  const targetYearEnd = new Date(targetYear, 11, 31);

  const yearsAtYearStart = getYearsOfService(joinD, targetYearStart);

  // 입사년도인 경우
  if (joinD.getFullYear() === targetYear) {
    const months = getMonthsOfService(joinD, targetYearEnd);
    return Math.min(months, MONTHLY_LEAVE_MAX);
  }

  // 1년 미만 (입사 다음해이지만 아직 1년 안 됨)
  if (yearsAtYearStart < 1) {
    // 해당 연도 내에서 1년 도달 전까지의 월수
    const oneYearDate = new Date(joinD);
    oneYearDate.setFullYear(oneYearDate.getFullYear() + 1);

    if (oneYearDate > targetYearEnd) {
      // 해당 연도 내에 1년 미도달
      const months = getMonthsOfService(joinD, targetYearEnd);
      return Math.min(months, MONTHLY_LEAVE_MAX);
    }

    // 해당 연도 내에 1년 도달 → 15일 부여
    return BASE_ANNUAL_LEAVE;
  }

  // 1년 이상
  if (yearsAtYearStart < 2) {
    return BASE_ANNUAL_LEAVE;
  }

  // 3년차(근속 2년) 이상: 2년마다 1일 추가
  const additionalDays = Math.floor((yearsAtYearStart - 1) / 2);
  return Math.min(BASE_ANNUAL_LEAVE + additionalDays, MAX_ANNUAL_LEAVE);
}
