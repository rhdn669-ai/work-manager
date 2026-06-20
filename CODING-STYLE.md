# 코딩 스타일 규칙 (work-manager)

> ESLint(flat config) + Prettier 로 강제. `eslint.config.js`, `.prettierrc.json` 가 실제 설정.
> 검사: `npm run lint` · 자동수정: `npm run lint:fix` · 포매팅: `npm run format`

## Prettier (포매팅)
- **작은따옴표**(`singleQuote`), JSX 속성은 큰따옴표(`jsxSingleQuote: false`)
- **세미콜론 필수**(`semi`)
- **2칸 들여쓰기**(`tabWidth: 2`)
- **trailing comma: all**(여러 줄이면 마지막에도 콤마)
- **printWidth 120**
- **arrow 괄호 항상**(`(x) => ...`)
- 줄바꿈 `endOfLine: auto`(윈도우 CRLF/맥 LF 모두 허용 — 줄끝 강제 변환 안 함)

## ESLint 규칙
- `no-unused-vars`: error (단, `^[A-Z_]` 패턴 변수는 허용 — 상수·컴포넌트)
- `prefer-const`: error
- `no-var`: error
- `eqeqeq`: warn(smart — `==`/`!=` 지양, `===` 사용)
- `no-console`: warn(단 `console.warn`/`console.error`는 허용)
- react-hooks / react-refresh 권장 규칙 적용
- Vite 전역 `__APP_VERSION__`, `__APP_BUILD_TIME__` 은 readonly 전역으로 등록

## 디자인/마크업 통일 (DESIGN-SYSTEM.md 참조)
- 기본색 = 네이비(`--primary`), 포인트 = 오렌지(`--accent`, 활성·선택·배지만)
- 입력칸·기본버튼 높이 44px / btn-sm 36 / btn-lg 52, 같은 줄 버튼은 같은 크기
- 휴지통 버튼 = `<Icon name="trash"/>휴지통`, 추가 = `<Icon name="plus"/>{라벨}`(글자 "+" 금지)
- 액션 버튼은 우측 끝 정렬, 입력 UI는 Modal, 네이티브 select 금지(통일 `<Select>`)
- 아이콘은 이모지 대신 선 SVG(`<Icon>`)
- **삭제 버튼**: 반드시 `btn btn-sm btn-danger` + `<Icon name="trash" className="btn-ic"/>` + "삭제" 텍스트. 아이콘 전용 금지.

## 표(Table) 컬럼 기준 (상세: DESIGN-SYSTEM.md §28)
- 기본 셀 패딩: `9px 10px` / 높이 `36px`
- 이름·내용: 좌정렬 `100%`. 날짜: `110px`. 상태배지: `80–140px`.
- 작업 컬럼: `className="col-action"` (우정렬, **140px PC / 88px ≤480px**, 패딩 16/12/10px).
- 인접 컬럼이 붙어 보이면 넓은 쪽 셀에 `paddingLeft: 24` 추가. margin 사용 금지.
- **가로 여백 처리**: 이름·내용 컬럼에 `width:100%` 부여 → 좌측부터 채우고 남는 공간은 우측으로. 2열 재배치 금지. 과도하게 넓으면 컨테이너 `maxWidth` 제한.

## 작업 원칙 (총괄)
- 지시 하나 받으면 같은 맥락 **전체 점검 후 일괄 적용**(부분 적용 금지).
- 답변/주석 한국어. 버전은 수정마다 +0.1.
