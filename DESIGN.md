---
name: IOPN Work Manager
description: 제조 중소기업의 근태·구매/발주·생산현황을 한 앱에 담은 ERP+MES 사내 운영 시스템
colors:
  navy-primary: "#002050"
  navy-hover: "#001840"
  navy-press: "#001230"
  navy-soft: "#e7ebf2"
  safety-orange: "#f05819"
  orange-hover: "#d94810"
  orange-press: "#a83409"
  accent-soft: "#feefe7"
  accent-tint: "#fbddd0"
  success-green: "#15803d"
  warning-amber: "#d97706"
  danger-red: "#dc2626"
  ink: "#19222f"
  slate: "#4e5968"
  muted: "#8b95a1"
  surface: "#ffffff"
  canvas: "#f2f4f6"
  border: "#e5e8eb"
  btn-navy-bg: "#e7eefb"
  btn-navy-fg: "#1e3f86"
  btn-danger-bg: "#fde7e7"
  btn-danger-fg: "#c53030"
  chart-1: "#3b82f6"
  chart-2: "#8b5cf6"
  chart-3: "#06b6d4"
typography:
  display:
    fontFamily: "Pretendard Variable, Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.022em"
  headline:
    fontFamily: "Pretendard Variable, Pretendard, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "Pretendard Variable, Pretendard, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Pretendard Variable, Pretendard, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Pretendard Variable, Pretendard, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.01em"
rounded:
  sm: "11px"
  md: "13px"
  lg: "15px"
  xl: "20px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "11px"
  "4": "14px"
  "5": "17px"
  "6": "20px"
  "8": "27px"
components:
  button-primary:
    backgroundColor: "{colors.btn-navy-bg}"
    textColor: "{colors.btn-navy-fg}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "#d7e3f8"
    textColor: "{colors.btn-navy-fg}"
  button-danger:
    backgroundColor: "{colors.btn-danger-bg}"
    textColor: "{colors.btn-danger-fg}"
    rounded: "{rounded.md}"
    height: "36px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "20px"
  tab-active:
    textColor: "{colors.safety-orange}"
    backgroundColor: "{colors.accent-soft}"
  badge-accent:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.orange-press}"
    rounded: "{rounded.sm}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "44px"
---

# Design System: IOPN Work Manager

## Overview

**Creative North Star: "현장의 관제탑 (The Control Tower)"**

제조 현장을 한눈에 관제하는 도구다. 발주·구매·생산현황·근태가 각자 흩어지지 않고 한 콘솔에서 신뢰감 있게 정렬된다. 기반은 차분한 **네이비**(#002050) — 사이드바와 제목을 잡아주는 무게중심 — 이고, 시선을 끄는 **오렌지**(#f05819)는 지금 처리해야 할 것에만 켜진다.

관제탑이라고 딱딱하지 않다. 서체는 둥근 **Pretendard**, 카드는 부드러운 그림자로 살짝 떠 있고, 모서리는 넉넉히(13–15px) 굴려 **따뜻하고 친근한** 인상을 준다. 신뢰(네이비)와 친근함(둥근 폼·warm accent)이 함께 간다. 밀도는 실무 도구답게 정보가 촘촘하되, 회색 캔버스 위에 흰 카드가 떠 보이게 해 숨 쉴 틈을 준다.

토스(Toss)류 금융앱의 명료함이 참조점이다. 화려한 히어로·과한 장식·짙은 테두리 상자는 배격한다.

**Key Characteristics:**
- 네이비 기반 + 오렌지는 희소하게(활성·핵심 액션·금액)
- 회색 캔버스 위 흰 카드, 부드러운 그림자
- 넉넉한 라운드(13–15px)와 둥근 Pretendard = 따뜻한 관제탑
- 의미색(성공·경고·위험)은 정해진 자리에만
- PC·모바일 4종(아이폰·갤럭시·폴더블·PC) 동등 대응

## Colors

차분한 네이비 골격에 오렌지를 점점이 얹고, 상태는 의미색으로만 말하는 절제된 팔레트.

### Primary
- **Deep Sea Navy** (#002050): 브랜드 중심. 사이드바 배경, 페이지 제목(h2/h3), 활성 지표·강조 텍스트. 누름/호버는 더 어둡게(#001840 → #001230).

### Secondary
- **Safety Orange** (#f05819): 액센트. 활성 탭, 핵심 CTA 강조선, 금액, 긴급/경고 포인트. 텍스트로 쓸 땐 대비 확보용 press 톤(#a83409). 옅은 배경은 accent-soft(#feefe7)·accent-tint(#fbddd0).

### Tertiary (의미색 — 역할 고정)
- **Success Green** (#15803d): '완료' 상태 배지 전용.
- **Warning Amber** (#d97706): 경고·주의.
- **Danger Red** (#dc2626): 음수·초과·삭제·오류 전용.

### Chart (계열 구분 전용 — 2026-07-31 추가)
품질 모듈의 도넛·다계열 그래프에서 **범주를 구분하기 위해서만** 쓴다. 의미색(초록·빨강·주황)은 판정을 뜻하므로 계열 구분에 쓰면 안 되고, 그래서 별도 계열색이 필요하다.
- **Chart Blue** (#3b82f6) / **Chart Violet** (#8b5cf6) / **Chart Teal** (#06b6d4)
- 단일 계열 추이 그래프의 주선은 계열색이 아니라 오렌지(accent)를 쓴다.
- UI 요소(버튼·배지·텍스트)에는 절대 쓰지 않는다. 차트 내부 전용.

### Neutral
- **Ink** (#19222f): 기본 본문 — 네이비 기운 도는 진회색(로고와 조화).
- **Slate** (#4e5968): 보조 텍스트·라벨.
- **Muted** (#8b95a1): 힌트·비활성·캡션.
- **Surface** (#ffffff): 카드·입력칸 배경.
- **Canvas** (#f2f4f6): 페이지 배경 — 카드가 떠 보이게 하는 회색.
- **Border** (#e5e8eb): 카드·구분선. 강한 경계는 #d1d6db.

### Named Rules
**The One Voice Rule.** 오렌지(safety-orange)는 한 화면의 10% 이하로만. 활성 탭·핵심 액션·금액·긴급에만 켜고, 그 희소함이 곧 주목이다. 오렌지를 남발하면 관제탑이 경보음으로 가득 찬다.

**The Semantic-Only Rule.** 초록은 '완료 배지'에만, 빨강은 '음수·초과·삭제·오류'에만. 장식 목적의 의미색 사용 금지.

## Typography

**Display / Body / Label Font:** Pretendard Variable (fallback: Apple SD Gothic Neo, Noto Sans KR, system sans). 단일 패밀리로 전 화면 통일.

**Character:** 한글 가독성에 최적화된 둥글고 균형 잡힌 산세리프. 무게(400·600·700)와 크기로만 위계를 만들어, 서체 자체는 조용하고 신뢰감 있게 물러난다.

### Hierarchy
- **Display** (700, 24px, lh 1.12, ls −0.022em): 페이지·대시보드 제목(h2).
- **Headline** (700, 20px, lh 1.2): 섹션 제목.
- **Title** (700, 16px, lh 1.3): 카드·패널 제목.
- **Body** (400/600, 14px, lh 1.5): 기본 본문·표. 강조는 600.
- **Label** (600–700, 12px / 11px, ls +0.01em): 타일 제목·캡션·배지·표 헤더. 한글이라 대문자화는 쓰지 않음.

### Named Rules
**The Tabular-Number Rule.** 금액·수량·시간 등 숫자 열은 `font-variant-numeric: tabular-nums`로 자릿수를 정렬한다.

## Layout

- **셸**: 좌측 고정 네이비 사이드바(164px) + 상단 흰 헤더(60px) + 회색 캔버스 콘텐츠. 모바일에선 사이드바가 햄버거로 접힘.
- **간격 리듬**: 4·8·11·14·17·20·27px 스케일. 카드 내부 여백은 대체로 16–24px.
- **표준 상단 탭**: 페이지 제목 위에 텍스트 탭 + 활성 오렌지 언더라인(전 앱 통일). 흰 띠 위에서 하단 헤어라인으로 구분.
- **반응형**: 아이폰·갤럭시·폴더블·PC 4종을 항상 검증. 표는 좁은 화면에서 카드로 전환, 작업 버튼은 우측 정렬 유지.

## Elevation & Depth

평평(flat)이 기본, **카드만 부드러운 그림자로 살짝 떠 있다.** 짙은 그림자·강한 테두리 상자는 쓰지 않는다. 깊이는 그림자보다 **회색 캔버스 vs 흰 카드**의 명도 대비로 만든다.

### Shadow Vocabulary
- **Rest** (`box-shadow: 0 1px 3px rgba(0,23,51,0.04)`): 카드 기본 — 거의 안 보일 만큼 은은.
- **Lift** (`box-shadow: 0 8px 28px rgba(0,23,51,0.12), 0 2px 6px rgba(0,23,51,0.06)`): hover·활성 카드.
- **Soft-panel** (`box-shadow: 0 4px 20px rgba(0,32,80,0.05)`): 캘린더 등 큰 패널(스티치 시안 톤).

### Named Rules
**The Flat-By-Default Rule.** 표면은 정지 상태에서 평평하다. 그림자는 상태(hover·활성·포커스)의 반응으로만 강해진다.

## Shapes

넉넉하게 굴린 모서리로 따뜻함을 만든다. 라운드 스케일: sm 11 · md 13 · lg 15 · xl 20px. 카드·패널은 lg(15) 이상, 버튼·입력칸은 md(13), 배지·칩은 sm(11). 테두리는 얇은 헤어라인(1px #e5e8eb)만; 굵은 상자 테두리는 금지. 오렌지 활성 언더라인은 상단만 살짝 둥근 3px 바.

## Components

### Buttons
- **Shape:** 넉넉한 라운드(13px), 높이 체계 36/44/52px(터치 안전, 입력칸 44와 정렬).
- **Primary:** 솔리드 네이비가 아니라 **옅은 네이비 톤 버튼** — 배경 #e7eefb, 글자 #1e3f86. hover 시 배경 #d7e3f8. (토스식 소프트 CTA)
- **Danger:** 옅은 빨강 — 배경 #fde7e7, 글자 #c53030.
- **Outline/Ghost:** 흰 배경 + 헤어라인 테두리, 보조 액션.
- **Icon 규칙:** Icon 컴포넌트는 width 미지정 시 SVG가 부풀므로 항상 크기 고정(1em 폴백).

### Tabs (상단 탭 — 시그니처)
- 텍스트 탭 + 활성만 강조: 오렌지 글자(700) + 옅은 오렌지 배경(#feefe7) + 3px 오렌지 언더라인(#ffa46b, 컨테이너 하단선 위). 비활성은 slate. 흰 띠 위, 하단 헤어라인 구분.
- **위치 규칙:** 탭은 항상 페이지 제목 **위**.

### Cards / Containers
- **Corner:** lg(15px). **Background:** 흰색. **Shadow:** Rest 기본, hover Lift. **Border:** 헤어라인 1px. **Padding:** 16–24px.

### Inputs / Fields
- 흰 배경 + 헤어라인 테두리 + md(13) 라운드, 높이 44px. 포커스는 네이비 링(`0 0 0 3px rgba(0,32,80,0.2)`). **네이티브 prompt 금지 → 입력은 Modal로.**

### Badges / Status
- 상태 배지는 옅은 배경 + 진한 글자: 대기(회색)·진행(옅은 파랑 #e8f2fe)·완료(옅은 초록 #e7f4ec)·취소/오류(옅은 빨강). 액션 배지·칩은 sm 라운드.

### Sidebar (시그니처)
- 네이비(#002050) 배경, 밝은 글자(#eaf0fa), 활성 항목만 오렌지 포인트. 폭 164px.

## Do's and Don'ts

### Do:
- **Do** 회색 캔버스(#f2f4f6) 위에 흰 카드(lg 라운드 + Rest 그림자)로 정보를 띄운다.
- **Do** 오렌지는 활성·핵심 액션·금액·긴급에만 (One Voice Rule).
- **Do** 상태는 의미색으로만: 완료=초록, 음수·초과·삭제=빨강.
- **Do** 숫자 열은 tabular-nums로 정렬, 액션 버튼은 행 우측 끝 정렬.
- **Do** 같은 맥락(버튼·간격·박스·색)은 앱 전체에서 일괄 통일 — 부분 적용 금지.
- **Do** 4종 디바이스(아이폰·갤럭시·폴더블·PC) 검증 후 완료.

### Don't:
- **Don't** 솔리드 네이비 버튼을 남발하지 마라 — Primary는 옅은 네이비 톤이 기본.
- **Don't** 짙은 그림자·굵은 상자 테두리로 카드를 무겁게 만들지 마라(Flat-By-Default).
- **Don't** 오렌지를 장식으로 넓게 깔지 마라(10% 상한).
- **Don't** 의미색을 장식 목적으로 쓰지 마라.
- **Don't** 네이티브 prompt/alert/confirm을 쓰지 마라 — Modal로 통일.
- **Don't** 라벨을 대문자화하지 마라(한글).
