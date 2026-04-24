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
export function buildHolidaySet(events) {
  const set = new Set();
  if (!Array.isArray(events)) return set;
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
  return set;
}

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
