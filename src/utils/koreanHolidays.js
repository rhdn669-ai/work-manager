// 한국 공휴일 정적 데이터 (정부 인사혁신처 공식 발표 기준)
//
// 양력 고정 공휴일은 자동 생성, 음력/대체공휴일은 연도별 수동 등록.
// 매년 1월에 발표되는 신규 임시공휴일/대체공휴일은 LUNAR_HOLIDAYS에 추가하거나
// 관리자 페이지(이벤트·공지)에서 type='holiday'로 등록.

function buildFixedHolidays(year) {
  return [
    { date: `${year}-01-01`, name: '신정' },
    { date: `${year}-03-01`, name: '삼일절' },
    { date: `${year}-05-05`, name: '어린이날' },
    { date: `${year}-06-06`, name: '현충일' },
    { date: `${year}-08-15`, name: '광복절' },
    { date: `${year}-10-03`, name: '개천절' },
    { date: `${year}-10-09`, name: '한글날' },
    { date: `${year}-12-25`, name: '성탄절' },
  ];
}

// 음력/임시공휴일/대체공휴일 (연도별)
const LUNAR_AND_SUBSTITUTE = {
  2024: [
    { date: '2024-02-09', name: '설날 연휴' },
    { date: '2024-02-10', name: '설날' },
    { date: '2024-02-11', name: '설날 연휴' },
    { date: '2024-02-12', name: '대체공휴일(설)' },
    { date: '2024-05-06', name: '대체공휴일(어린이날)' },
    { date: '2024-05-15', name: '부처님오신날' },
    { date: '2024-09-16', name: '추석 연휴' },
    { date: '2024-09-17', name: '추석' },
    { date: '2024-09-18', name: '추석 연휴' },
    { date: '2024-10-01', name: '국군의 날' },
  ],
  2025: [
    { date: '2025-01-27', name: '임시공휴일' },
    { date: '2025-01-28', name: '설날 연휴' },
    { date: '2025-01-29', name: '설날' },
    { date: '2025-01-30', name: '설날 연휴' },
    { date: '2025-03-03', name: '대체공휴일(삼일절)' },
    { date: '2025-05-06', name: '대체공휴일(어린이날·부처님오신날)' },
    { date: '2025-10-05', name: '추석 연휴' },
    { date: '2025-10-06', name: '추석' },
    { date: '2025-10-07', name: '추석 연휴' },
    { date: '2025-10-08', name: '대체공휴일(추석)' },
  ],
  2026: [
    { date: '2026-02-16', name: '설날 연휴' },
    { date: '2026-02-17', name: '설날' },
    { date: '2026-02-18', name: '설날 연휴' },
    { date: '2026-03-02', name: '대체공휴일(삼일절)' },
    { date: '2026-05-24', name: '부처님오신날' },
    { date: '2026-05-25', name: '대체공휴일(부처님오신날)' },
    { date: '2026-09-24', name: '추석 연휴' },
    { date: '2026-09-25', name: '추석' },
    { date: '2026-09-26', name: '추석 연휴' },
  ],
  2027: [
    { date: '2027-02-06', name: '설날 연휴' },
    { date: '2027-02-07', name: '설날' },
    { date: '2027-02-08', name: '설날 연휴' },
    { date: '2027-02-09', name: '대체공휴일(설)' },
    { date: '2027-05-13', name: '부처님오신날' },
    { date: '2027-09-14', name: '추석 연휴' },
    { date: '2027-09-15', name: '추석' },
    { date: '2027-09-16', name: '추석 연휴' },
  ],
};

// 단일 연도 공휴일 맵 { 'YYYY-MM-DD': '명칭' }
export function getKoreanHolidaysMap(year) {
  const map = {};
  buildFixedHolidays(year).forEach((h) => { map[h.date] = h.name; });
  (LUNAR_AND_SUBSTITUTE[year] || []).forEach((h) => { map[h.date] = h.name; });
  return map;
}

// 여러 연도의 모든 공휴일 날짜 Set
export function getKoreanHolidayDates(...years) {
  const set = new Set();
  years.forEach((y) => {
    Object.keys(getKoreanHolidaysMap(y)).forEach((d) => set.add(d));
  });
  return set;
}

// 캘린더에 표시할 이벤트 형태 배열 (HomeCalendar의 events 형식과 호환)
export function getKoreanHolidaysAsEvents(year) {
  const map = getKoreanHolidaysMap(year);
  return Object.entries(map).map(([date, name]) => ({
    id: `kh-${date}`,
    type: 'holiday',
    title: name,
    startDate: date,
    endDate: date,
    _korean: true,
  }));
}
