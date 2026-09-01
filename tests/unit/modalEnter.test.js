// 모달에서 Enter 를 쳤을 때 무엇이 눌리는가 — 되돌릴 수 없는 일이 손가락 한 번에
// 벌어지면 안 된다 (2026-09-01 「마감내역 요청」 오발송).
//
// Modal.jsx 의 두 규칙을 그대로 옮겨 검증한다. 컴포넌트는 DOM 이 있어야 돌아가는데
// 이 프로젝트에는 렌더 테스트 환경이 없어, 규칙 자체를 문자열로 읽어 확인한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../../src/components/common/Modal.jsx'), 'utf8');

describe('모달 Enter — 되돌릴 수 없는 일은 막는다', () => {
  it('주버튼을 고를 때 data-no-enter 를 뺀다', () => {
    // 이 선택자가 무너지면 메일 발송 버튼이 다시 Enter 로 눌린다
    expect(src).toContain(".btn-primary:not([disabled]):not([data-no-enter])");
  });

  it('읽기 전용 칸에는 첫 포커스를 주지 않는다', () => {
    // 「받는 곳」(readOnly)에 커서가 놓인 채 Enter 를 치면 그대로 발송됐다
    expect(src).toMatch(/!el\.classList\.contains\('modal-close'\) && !el\.readOnly/);
  });

  it('textarea·버튼·셀렉트는 여전히 제외한다 — 본문 줄바꿈이 발송이 되면 안 된다', () => {
    expect(src).toContain("t.tagName === 'TEXTAREA'");
    expect(src).toContain("t.tagName === 'BUTTON'");
    expect(src).toContain("t.tagName === 'SELECT'");
  });

  it('한글 입력 조합 중에는 반응하지 않는다', () => {
    expect(src).toContain('e.isComposing');
  });
});

describe('되돌릴 수 없는 버튼에 표시가 붙어 있다', () => {
  const read = (p) => readFileSync(join(here, '../../src/pages/admin/', p), 'utf8');

  it('마감내역 요청 — 보내기', () => {
    expect(read('MarginClosingPage.jsx')).toContain('data-no-enter onClick={sendStatementRequest}');
  });

  it('메일 발송 — 여러 업체에 발송', () => {
    expect(read('MailSendPage.jsx')).toContain('data-no-enter onClick={confirmSend}');
  });

  it('발주서 — 메일 보내기', () => {
    expect(read('PurchaseDetailPage.jsx')).toContain('data-no-enter onClick={confirmSendMail}');
  });
});

describe('금액 고치기 — Enter 로 두 번 저장되지 않는다', () => {
  it('이벤트를 모달까지 올려보내지 않는다', () => {
    const s = readFileSync(join(here, '../../src/pages/admin/MarginClosingPage.jsx'), 'utf8');
    // stopPropagation 이 없으면 내 처리 + 모달 처리로 두 번 저장된다
    // 이유 입력칸의 onKeyDown 안에 있어야 한다 — 그 칸 근처만 본다
    const i = s.indexOf('placeholder="예) 단가 인하 반영');
    expect(i).toBeGreaterThan(0);
    expect(s.slice(i, i + 400)).toContain('e.stopPropagation()');
  });
});
