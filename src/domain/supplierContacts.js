// 구매처 담당자(이메일) 목록.
//
// 한 업체 안에서도 취급 제품에 따라 받는 사람이 다르다 —
// 예) 텔콤 아이피씨: COSEL 담당 / 델타 담당.
// 그래서 구매처에 이메일을 여러 줄 두고, 품목마다 어느 담당자에게 보낼지 박아 둔다.
//
// 기존 데이터(email 한 칸)를 그대로 살린다. emails 가 없으면 email 을 대표 한 줄로 본다 —
// 구매처 30곳을 다시 손보지 않아도 어제와 똑같이 동작한다.

export function contactsOf(supplier) {
  const list = Array.isArray(supplier?.emails) ? supplier.emails : [];
  const clean = list
    .map((c) => ({ name: String(c?.name ?? '').trim(), email: String(c?.email ?? '').trim() }))
    .filter((c) => c.email);
  if (clean.length) return clean;
  const one = String(supplier?.email ?? '').trim();
  return one ? [{ name: '', email: one }] : [];
}

// 대표(첫 줄) — 담당자를 고르지 않은 품목은 여기로 간다
export function primaryEmail(supplier) {
  return contactsOf(supplier)[0]?.email || '';
}

// 참조(CC) — 담당이 누구든 늘 함께 받아야 하는 사람들.
// 업체 한 곳에 한 칸으로 두고 쉼표·세미콜론·줄바꿈 아무거나로 나눠 적을 수 있게 한다.
export function ccOf(supplier) {
  return String(supplier?.ccEmails ?? '')
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
}

// 발주서를 보낼 주소 한 줄 — 담당자 + 참조. 같은 주소가 두 번 들어가지 않게 거른다.
// (지금은 메일 함수가 참조 칸을 따로 받지 않아 받는 사람에 함께 넣는다 — 2026-08-21 대표님)
export function mailToLine(primary, supplier) {
  const seen = new Set();
  return [String(primary ?? '').trim(), ...ccOf(supplier)]
    .filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))
    .join(', ');
}

// 고를 거리가 있을 때만 품목에 담당자 칸을 띄운다
export function hasChoice(supplier) {
  return contactsOf(supplier).length >= 2;
}

// 품목에 박아 둔 담당자 메일이 아직 살아 있는지 확인해 돌려준다.
// 구매처에서 그 줄을 지웠다면 대표로 돌아간다 — 품목을 일일이 고치지 않아도 된다.
export function resolveEmail(supplier, wanted) {
  const list = contactsOf(supplier);
  const want = String(wanted ?? '').trim();
  if (want && list.some((c) => c.email === want)) return want;
  return list[0]?.email || '';
}

// 화면에 적을 이름 — 「김과장 <a@b.c>」, 이름이 없으면 메일만
export function contactLabel(c) {
  if (!c?.email) return '';
  return c.name ? `${c.name} · ${c.email}` : c.email;
}

// 발송·회신·결제 표시를 저장할 때 쓰는 키.
// 담당자가 갈린 업체는 담당까지 넣어야 COSEL 에 보낸 것이 델타 줄에도 「완료」로 뜨지 않는다.
// Firestore 필드 이름에는 「.」을 쓸 수 없어(경로 구분자) 「@」와 함께 밑줄로 바꾼다.
export function supplierKey(name, contact) {
  const base = String(name ?? '').replace(/\./g, '_');
  const who = String(contact ?? '').trim();
  return who ? `${base}__${who.replace(/[.@]/g, '_')}` : base;
}
