// 날짜를 "YYYY-MM-DD" 형식으로 변환
export function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 오늘 날짜 문자열
export function getToday() {
  return formatDate(new Date());
}

// 해당 날짜가 속한 주의 월요일 반환
export function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return formatDate(monday);
}

// 해당 날짜가 속한 주의 일요일 반환
export function getWeekEnd(date) {
  const d = new Date(getWeekStart(date));
  d.setDate(d.getDate() + 6);
  return formatDate(d);
}

// 해당 월의 첫날
export function getMonthStart(year, month) {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

// 해당 월의 마지막 날
export function getMonthEnd(year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

// 분 → "Xh Ym" 형식
export function formatMinutes(minutes) {
  if (minutes == null || minutes < 0) return '-';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

// 시간 포맷 "HH:MM"
export function formatTime(timestamp) {
  if (!timestamp) return '-';
  const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// 두 날짜 사이의 영업일 수 (주말 제외)
export function getBusinessDays(startDate, endDate) {
  let count = 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  const current = new Date(start);
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

// 두 날짜 사이의 영업일 수 — 주말 + 휴일(events collection type='holiday') 제외
// holidayDates: Set<'YYYY-MM-DD'> — 미리 모든 휴일 날짜를 펼쳐 넣어둔 집합
export function getBusinessDaysExcludingHolidays(startDate, endDate, holidayDates) {
  let count = 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  const current = new Date(start);
  while (current <= end) {
    const day = current.getDay();
    const iso = formatDate(current);
    const isWeekend = day === 0 || day === 6;
    const isHoliday = holidayDates && holidayDates.has && holidayDates.has(iso);
    if (!isWeekend && !isHoliday) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

// 이벤트 배열에서 type='holiday'인 항목의 모든 날짜를 Set으로 펼침
// + 한국 공휴일(작년/올해/내년) 자동 포함 → 연차 영업일 계산에서 자동 제외됨
export function buildHolidaySet(events) {
  const set = new Set();
  if (Array.isArray(events)) {
    events.forEach((e) => {
      if (!e || e.type !== 'holiday' || !e.startDate) return;
      const start = new Date(e.startDate);
      const end = new Date(e.endDate || e.startDate);
      const cur = new Date(start);
      while (cur <= end) {
        set.add(formatDate(cur));
        cur.setDate(cur.getDate() + 1);
      }
    });
  }
  // 한국 공휴일 자동 합산 — 동기화 회피용 dynamic import 대신 정적 import
  // (순환 참조 방지를 위해 require 대신 ES import 사용)
  const thisYear = new Date().getFullYear();
  KOREAN_HOLIDAY_YEARS.forEach((offset) => {
    const y = thisYear + offset;
    Object.keys(_getKoreanHolidaysMap(y)).forEach((d) => set.add(d));
  });
  return set;
}

// 한국 공휴일 자동 포함 범위 (작년/올해/내년)
const KOREAN_HOLIDAY_YEARS = [-1, 0, 1];

// dateUtils가 koreanHolidays를 import하면 빌드 의존성이 늘어나므로 inline 처리.
// 양력 고정 공휴일만 자동 계산. 음력/대체는 koreanHolidays.js에서 별도로
// HomeCalendar 등에서 직접 사용.
function _getKoreanHolidaysMap(year) {
  const fixed = {
    [`${year}-01-01`]: '신정',
    [`${year}-03-01`]: '삼일절',
    [`${year}-05-05`]: '어린이날',
    [`${year}-06-06`]: '현충일',
    [`${year}-08-15`]: '광복절',
    [`${year}-10-03`]: '개천절',
    [`${year}-10-09`]: '한글날',
    [`${year}-12-25`]: '성탄절',
  };
  const lunar = _LUNAR_AND_SUB[year] || {};
  return { ...fixed, ...lunar };
}

// 음력/임시공휴일/대체공휴일 (연차 계산용 — koreanHolidays.js와 중복 데이터)
// 매년 정부 발표 후 추가 필요
const _LUNAR_AND_SUB = {
  2024: {
    '2024-02-09': '설날 연휴',
    '2024-02-10': '설날',
    '2024-02-11': '설날 연휴',
    '2024-02-12': '대체공휴일(설)',
    '2024-05-06': '대체공휴일(어린이날)',
    '2024-05-15': '부처님오신날',
    '2024-09-16': '추석 연휴',
    '2024-09-17': '추석',
    '2024-09-18': '추석 연휴',
    '2024-10-01': '국군의 날',
  },
  2025: {
    '2025-01-27': '임시공휴일',
    '2025-01-28': '설날 연휴',
    '2025-01-29': '설날',
    '2025-01-30': '설날 연휴',
    '2025-03-03': '대체공휴일(삼일절)',
    '2025-05-06': '대체공휴일(어린이날·부처님오신날)',
    '2025-10-05': '추석 연휴',
    '2025-10-06': '추석',
    '2025-10-07': '추석 연휴',
    '2025-10-08': '대체공휴일(추석)',
  },
  2026: {
    '2026-02-16': '설날 연휴',
    '2026-02-17': '설날',
    '2026-02-18': '설날 연휴',
    '2026-03-02': '대체공휴일(삼일절)',
    '2026-05-24': '부처님오신날',
    '2026-05-25': '대체공휴일(부처님오신날)',
    '2026-09-24': '추석 연휴',
    '2026-09-25': '추석',
    '2026-09-26': '추석 연휴',
  },
  2027: {
    '2027-02-06': '설날 연휴',
    '2027-02-07': '설날',
    '2027-02-08': '설날 연휴',
    '2027-02-09': '대체공휴일(설)',
    '2027-05-13': '부처님오신날',
    '2027-09-14': '추석 연휴',
    '2027-09-15': '추석',
    '2027-09-16': '추석 연휴',
  },
};

// 근속 연수 계산
export function getYearsOfService(joinDate, targetDate) {
  const join = new Date(joinDate);
  const target = targetDate ? new Date(targetDate) : new Date();
  let years = target.getFullYear() - join.getFullYear();
  const monthDiff = target.getMonth() - join.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && target.getDate() < join.getDate())) {
    years--;
  }
  return Math.max(0, years);
}

// 근속 개월 수 계산
export function getMonthsOfService(joinDate, targetDate) {
  const join = new Date(joinDate);
  const target = targetDate ? new Date(targetDate) : new Date();
  let months = (target.getFullYear() - join.getFullYear()) * 12 + (target.getMonth() - join.getMonth());
  if (target.getDate() < join.getDate()) months--;
  return Math.max(0, months);
}

// 요일 한글 반환
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
export function getDayName(date) {
  return DAY_NAMES[new Date(date).getDay()];
}
