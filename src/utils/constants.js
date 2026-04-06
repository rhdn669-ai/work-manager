// 법정 근로시간 (분)
export const DAILY_WORK_MINUTES = 480; // 8시간
export const WEEKLY_WORK_MINUTES = 2400; // 40시간
export const WEEKLY_OVERTIME_LIMIT = 720; // 12시간
export const LUNCH_BREAK_MINUTES = 60; // 점심시간
export const LUNCH_BREAK_THRESHOLD = 360; // 6시간 이상 근무 시 점심 차감

// 연차 관련
export const MAX_ANNUAL_LEAVE = 25;
export const BASE_ANNUAL_LEAVE = 15;
export const MONTHLY_LEAVE_MAX = 11; // 1년 미만 최대

// 역할
export const ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
};

// 출퇴근 상태
export const ATTENDANCE_STATUS = {
  WORKING: 'working',
  COMPLETED: 'completed',
  ABSENT: 'absent',
  LEAVE: 'leave',
};

// 연차 종류
export const LEAVE_TYPES = {
  ANNUAL: 'annual',
  HALF_AM: 'half_am',
  HALF_PM: 'half_pm',
  SICK: 'sick',
  SPECIAL: 'special',
};

export const LEAVE_TYPE_LABELS = {
  annual: '연차',
  half_am: '오전 반차',
  half_pm: '오후 반차',
  sick: '병가',
  special: '특별휴가',
};

// 연차 신청 상태
export const LEAVE_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
};

export const LEAVE_STATUS_LABELS = {
  pending: '대기',
  approved: '승인',
  rejected: '거절',
  cancelled: '취소',
};
