import { BUPMOK, JAIP, MP_SUBS, COMPANIES, GIGU_MAKERS } from './production';
import { FORM_FIELDS } from './qualityFormFields';
import { DEFECT_TYPE_LABELS } from './defectTypes';
import { factorsOf } from './changeFactors';

// 구조 확인용 가상 데이터 — 생산현황·품질보증을 빈 칸 없이 채운다.
//
// ※ 전부 지어낸 값입니다. 실제 업무 데이터가 아닙니다.
//   모든 문서에 demo: true 가 박혀 있어 「샘플 데이터 지우기」로 한 번에 사라집니다.
//   데모는 업무 기록이 아니므로 휴지통을 거치지 않고 바로 완전 삭제합니다
//   (휴지통이 가상 데이터로 차면 진짜 삭제 기록을 못 찾습니다).

export const DEMO_FLAG = 'demo';

const 사람 = ['김신혜', '하수연', '권순우', '김하늬', '이승빈', '조현금', '이수경', '김진아'];
const 프로젝트 = ['YS-TEPS0925374', 'YS-PROB0431128', 'DH-LOAD0812255', 'DH-TEMP0619043'];
const 업체 = ['(주)천음테크', '(주)신진전기', '대성FA', '한울시스템'];
const 품명 = ['POWER BOX', 'DRIVE BOX', 'TEMP BOX 상·하', 'MP 판넬', 'LOADER BOX'];

const pick = (arr, i) => arr[i % arr.length];
// 오늘 기준 상대일 — 화면에서 '임박/초과'가 실제로 보이도록 날짜를 흩뿌린다
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

/* ── 생산현황 판넬 4대 (메티스 2 · 디에이치 2) ───────────────────── */
export function demoPanels() {
  return [0, 1, 2, 3].map((i) => {
    const company = COMPANIES[i < 2 ? 0 : 1];
    const 작업자 = Object.fromEntries(BUPMOK.map((b, n) => [b, pick(사람, i + n)]));
    // 판넬마다 불량 수를 다르게 — 불량률 추이·작업자별 분포가 눈에 보이게
    const 불량수 = [3, 1, 2, 0][i];
    const mk = (n) => ({
      내용: `${pick(['단자 조임 불량', '배선 정리 미흡', '라벨 누락', '도어 간섭'], i + n)} 발견`,
      유형: pick(DEFECT_TYPE_LABELS, i + n),
      완료: n === 0, // 첫 건만 조치 완료 — 미조치가 남아야 현황이 보인다
      검수자: pick(사람, i),
      일자: day(-7 + n),
    });
    const 공정비고 = {};
    BUPMOK.slice(0, 불량수).forEach((b, n) => {
      공정비고[b] = { 항목: [mk(n)] };
    });

    return {
      회사: company,
      프로젝트: pick(프로젝트, i),
      호기: `${i + 1}호기`,
      정역: i % 2 ? '역' : '정',
      자재: pick(['SUS', 'SPCC', 'AL'], i),
      기구제작: GIGU_MAKERS[company][i % 2],
      납기: day(10 + i * 7),
      턴온: day(20 + i * 7),
      비고: '구조 확인용 샘플',
      현장메모: '샘플 데이터입니다',
      자재입고일: Object.fromEntries(JAIP.map((k, n) => [k, day(-20 + n)])),
      부품상태: Object.fromEntries(BUPMOK.map((b, n) => [b, n < 불량수 ? '문제' : n < 5 ? '완료' : '대기'])),
      mp하위상태: Object.fromEntries(MP_SUBS.map((k, n) => [k, n < 6 ? '완료' : '대기'])),
      검수완료: i === 1,
      출고완료: false,
      insp2done: false,
      검수: { 공정작업자: 작업자, 차1: { 공정비고 }, 차2: { 공정비고: {} } },
      부품검수자: Object.fromEntries(BUPMOK.map((b) => [b, pick(사람, i)])),
      [DEMO_FLAG]: true,
    };
  });
}

/* ── 품질 자산 (계측기·지그·치공구·툴) ──────────────────────────── */
export function demoAssets() {
  const 기기 = {
    gauge: ['버니어 캘리퍼스', '마이크로미터', '절연저항계'],
    jig: ['P/W BOX 조립지그', 'H/T 검사지그'],
    tool: ['토크 드라이버', '압착공구', '탈피공구'],
    handtool: ['전동 드라이버', '멀티미터'],
  };
  const out = [];
  Object.entries(기기).forEach(([type, names]) => {
    names.forEach((name, i) => {
      const cycle = [12, 6, 24][i % 3];
      const last = day(-330 + i * 120); // 정상·임박·초과가 골고루 나오게
      const next = (() => {
        const d = new Date(last);
        d.setMonth(d.getMonth() + cycle);
        return d.toISOString().slice(0, 10);
      })();
      out.push({
        assetType: type,
        assetNo: `${type.toUpperCase().slice(0, 3)}-${String(i + 1).padStart(3, '0')}`,
        category: pick(['계측기', '게이지', '측정공구', '검사장비'], i),
        name,
        target: '대상',
        registerDate: day(-700),
        maker: pick(['미쓰토요', '플루크', '보쉬', '하이오스'], i),
        model: `M-${100 + i * 7}`,
        certNo: `CERT-2026-${String(i + 1).padStart(4, '0')}`,
        cycleMonths: cycle,
        lastDate: last,
        nextDate: next,
        agency: pick(['한국계측기술', 'KOLAS 인증기관'], i),
        inspectEquip: '표준 게이지 세트',
        location: pick(['품질실', '조립장', '검사대'], i),
        dept: pick(['품질팀', '현장팀', '지원팀'], i),
        owner: pick(사람, i),
        note: '구조 확인용 샘플',
        [DEMO_FLAG]: true,
      });
    });
  });
  return out;
}

/* ── 품질 기록 — 서식 정의를 훑어 모든 칸을 채운다 ───────────────── */
// 필드 타입·이름으로 그럴듯한 값을 만든다. 빈 칸을 남기지 않는 것이 목적이다.
function valueFor(f, i) {
  if (f.calc) return undefined; // 자동계산 칸은 저장 때 계산된다
  if (f.type === 'select') return f.options?.[i % f.options.length] ?? '';
  if (f.type === 'date') return day(-30 + i * 3);
  if (f.type === 'num') {
    if (/rate|율/.test(f.key)) return 95;
    if (/target|목표/.test(f.key)) return 7;
    if (/year|연도/.test(f.key)) return new Date().getFullYear();
    if (/score|점수|영향|가능성/.test(f.key)) return (i % 5) + 1;
    if (/defect|불량/.test(f.key)) return i % 3;
    return (i % 9) + 1;
  }
  const k = f.key;
  if (/supplier|vendor|업체|공급/.test(k)) return pick(업체, i);
  if (/itemName|품명/.test(k)) return pick(품명, i);
  if (/projectNo|프로젝트|project/.test(k)) return pick(프로젝트, i);
  if (/inspector|검사자|auditor|심사원|trainer|강사|owner|담당|By$|Name$|name/i.test(k)) return pick(사람, i);
  if (/customerName/.test(k)) return COMPANIES[i % COMPANIES.length];
  if (/dept|부서/.test(k)) return '품질팀';
  if (/phone|연락처/.test(k)) return '051-000-0000';
  if (/bizNo|사업자/.test(k)) return '123-45-67890';
  if (/address|소재지/.test(k)) return '부산광역시 강서구';
  if (/No$|번호|no$/i.test(k)) return `${(f.label || '').slice(0, 3)}-${String(i + 1).padStart(4, '0')}`;
  return `${f.label} 샘플값 ${i + 1}`;
}

export function demoRecords() {
  const out = [];
  Object.entries(FORM_FIELDS).forEach(([formKey, def]) => {
    if (def.asset) return; // 자산은 위에서 따로 만든다
    const 건수 = def.paper ? 2 : 3;
    for (let i = 0; i < 건수; i++) {
      const rec = { formKey, recordNo: `${def.numberPrefix || 'REC'}-2026-${String(i + 1).padStart(4, '0')}` };
      def.fields.forEach((f) => {
        const v = valueFor(f, i);
        if (v !== undefined) rec[f.key] = v;
      });
      // 라인아이템(검사항목·배점·참석자)도 비우지 않는다
      if (def.lines) {
        rec.lines = [0, 1].map((n) =>
          Object.fromEntries(
            def.lines.columns.map((c) => [
              c.key,
              c.calc
                ? undefined
                : c.type === 'select'
                  ? c.options[(i + n) % c.options.length]
                  : c.type === 'num'
                    ? (n + 1) * 10
                    : `${c.label} ${n + 1}`,
            ]),
          ),
        );
        if (def.lines.rowCalc) rec.lines = rec.lines.map(def.lines.rowCalc);
      }
      // 동적 선택지(세부 변경요인)는 앞 칸 값에 딸려 있어 뒤에 채운다
      def.fields
        .filter((f) => f.optionsOf === 'factor')
        .forEach((f) => {
          const opts = factorsOf(rec.changeCategory);
          if (opts.length) rec[f.key] = opts[i % opts.length];
        });
      rec[DEMO_FLAG] = true;
      out.push(rec);
    }
  });
  return out;
}
