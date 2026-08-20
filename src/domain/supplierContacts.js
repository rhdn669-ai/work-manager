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
