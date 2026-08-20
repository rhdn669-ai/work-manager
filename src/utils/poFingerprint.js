// 발주서 「내용 지문」 — 이 업체 발주서가 실제로 달라졌는지 가리는 값.
//
// 미리 만들어 둔 PDF 를 다시 쓰려면 내용이 그대로인지 알아야 한다.
// 품목·수량·단가처럼 종이에 찍히는 것만 본다. 입고 여부나 발송 표시처럼
// 발주서에 나오지 않는 값은 넣지 않는다 — 넣으면 쓸데없이 다시 만들게 된다.
//
// 발주서 하단의 출력 시각도 같은 이유로 없앴다. 시각이 찍히면 내용이 같아도
// 파일이 매번 달라져, 미리 만들어 둔 것을 쓸 수가 없다.

const SEP = '|';
const ROW = '~';

export function poFingerprint(items, meta = {}) {
  const { supplierName, contact, note, title, subtitle, deliveryDue, poNum } = meta;
  const lines = (items || [])
    .filter((ln) => (ln?.name || '').trim() || ln?.itemId)
    .map((ln) =>
      [
        ln.itemId || '',
        ln.name || '',
        ln.spec || '',
        ln.unit || '',
        Number(ln.qty) || 0,
        Number(ln.unitPrice) || 0,
        ln.box || '',
        ln.note || '',
      ].join(SEP),
    );
  const head = [
    supplierName || '',
    contact || '',
    title || '',
    subtitle || '',
    deliveryDue || '',
    poNum || '',
    note || '',
  ];
  return head.join(SEP) + ROW + lines.join(ROW);
}
