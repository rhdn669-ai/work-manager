import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  getDoc,
  writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../config/firebase';
import { trashGeneric } from './trashService';
import { shrinkImage } from '../utils/imageResize';
import { recompute, deriveBoxStatus } from '../domain/production';
import { syncPanelNcr, removePanelNcr } from './qualityRecordService';

// 판넬 생산현황 — Firestore 실시간 (전 직원 조회 · 관리자 편집).
// NAS(Supabase) 이전 시 이 파일만 어댑터 교체하면 화면 무수정.
const panelsRef = collection(db, 'productionPanels');

// 실시간 구독 — recompute(진행률·종합상태) 적용해 콜백
export function subscribePanels(cb) {
  return onSnapshot(panelsRef, (snap) => {
    // 납기 → 호기 순. 둘 다 비어 있으면(갓 추가한 판넬) 만든 순서대로 아래에 쌓이게 한다.
    // 이 기준이 없으면 새로 추가한 행이 목록 가운데로 끼어든다.
    const ms = (v) => (v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : 0);
    const rows = snap.docs
      .map((d) => recompute({ id: d.id, ...d.data() }))
      .sort(
        (a, b) =>
          (a.납기 || '9999').localeCompare(b.납기 || '9999') ||
          (a.호기 || '').localeCompare(b.호기 || '', undefined, { numeric: true }) ||
          ms(a.createdAt) - ms(b.createdAt),
      );
    cb(rows);
  });
}

export async function addPanel(data) {
  const { id: _id, ...rest } = data;
  const ref = await addDoc(panelsRef, { ...rest, createdAt: serverTimestamp() });
  return { id: ref.id, ...rest };
}

// 부적합 실적에 반영돼야 하는 변경 — 이 키가 섞였을 때만 연동을 돌려 불필요한 읽기·쓰기를 막는다
const NCR_SYNC_KEYS = ['검수', '회사', '프로젝트', '호기', '자재'];

export async function updatePanel(id, patch) {
  await updateDoc(doc(db, 'productionPanels', id), { ...patch, updatedAt: serverTimestamp() });
  if (!Object.keys(patch).some((k) => NCR_SYNC_KEYS.includes(k))) return 'noop';
  // 저장 경로가 여기 하나뿐이라, 판넬 전문을 다시 읽어 품질보증 부적합 실적과 맞춘다
  try {
    const snap = await getDoc(doc(db, 'productionPanels', id));
    return snap.exists() ? await syncPanelNcr({ id, ...snap.data() }) : 'noop';
  } catch (err) {
    // 판넬 저장은 이미 끝났다. 연동만 실패했음을 호출부가 구분할 수 있게 표시해 던진다.
    err.ncrSync = true;
    throw err;
  }
}

// 엑셀 붙여넣기처럼 여러 줄을 한꺼번에 쓸 때 — 한 번의 왕복으로 끝낸다.
// 줄마다 updatePanel 을 부르면 저장 왕복도 줄 수만큼이고, 그때마다 구독이 깨어나
// 74칸짜리 표가 통째로 다시 그려진다. 8줄이면 8번. 그래서 눈에 띄게 굼떴다.
//
// 새로 만드는 판넬은 id 를 미리 뽑아 같은 묶음에 넣는다 — 만들고 나서 다시 채우지 않는다.
export async function bulkWritePanels({ creates = [], updates = [] }) {
  if (creates.length === 0 && updates.length === 0) return [];
  const batch = writeBatch(db);
  const made = [];
  for (const data of creates) {
    const ref = doc(panelsRef);
    batch.set(ref, { ...data, createdAt: serverTimestamp() });
    made.push({ id: ref.id, ...data });
  }
  for (const { id, patch } of updates) {
    batch.update(doc(db, 'productionPanels', id), { ...patch, updatedAt: serverTimestamp() });
  }
  await batch.commit();
  return made;
}

// 불량 사진 업로드 → 다운로드 URL 반환 (Firestore엔 URL만 저장 — 문서 1MB 제한 보호)
export async function uploadDefectPhoto(file, onProgress) {
  // 원본 그대로 올리면 폰 사진 한 장이 3~8MB라 현장 회선에서 10~30초씩 걸린다.
  // 올리기 전에 긴 변 2400px·JPEG 90%로 줄여 1~1.5MB로 만든다(A4 200dpi — 확대해도 또렷).
  const small = await shrinkImage(file);
  const path = `productionDefects/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const task = uploadBytesResumable(ref(storage, path), small, { contentType: small.type || 'image/jpeg' });
  if (onProgress) {
    task.on('state_changed', (snap) => {
      const pct = snap.totalBytes ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0;
      onProgress(pct);
    });
  }
  await task;
  return getDownloadURL(task.snapshot.ref);
}

// 올라간 사진을 그 판넬의 불량 항목에 붙인다.
// 모달이 닫힌 뒤에 끝나도 안전하도록, 화면의 상태가 아니라 저장된 최신 문서를 읽어 고친다.
//   index == null 이면 불량 항목을 새로 만들고, 값이 있으면 그 항목의 kind 칸(사진/조치사진)에 넣는다.
export async function attachDefectPhoto(panelId, { part, round, index, kind, url, checkerName, today }) {
  const snap = await getDoc(doc(db, 'productionPanels', panelId));
  if (!snap.exists()) return;
  const panel = { id: panelId, ...snap.data() };
  const insp = structuredClone(panel.검수 || {});
  if (!insp[`차${round}`]) insp[`차${round}`] = { 공정비고: {} };
  if (!insp[`차${round}`].공정비고) insp[`차${round}`].공정비고 = {};
  if (!insp[`차${round}`].공정비고[part]) insp[`차${round}`].공정비고[part] = { 항목: [] };
  const sec = insp[`차${round}`].공정비고[part];
  if (index == null)
    sec.항목.push({ 내용: '', 유형: '', 완료: false, 사진: url, 검수자: checkerName || '', 일자: today });
  else if (sec.항목[index]) sec.항목[index][kind] = url;

  const st = deriveBoxStatus(panel, part, insp);
  await updatePanel(panelId, {
    검수: insp,
    부품상태: { ...(panel.부품상태 || {}), [part]: st },
    부품검수자: { ...(panel.부품검수자 || {}), [part]: st === '대기' ? '' : checkerName || '' },
  });
}

// 삭제 = 휴지통 경유 (영구삭제 금지 규칙)
export async function trashPanel(panel, deletedByName = '') {
  await trashGeneric(
    'productionPanels',
    panel.id,
    {
      title: `${panel.프로젝트 || '판넬'} · ${panel.호기 || '호기미정'}`,
      summary: `${panel.회사 || ''} ${panel.자재 || ''}`.trim(),
    },
    deletedByName,
  );
  // 이 판넬에서 자동으로 만들어진 부적합 실적도 같이 내린다.
  // 안 하면 품질 대장·통계·최근 등록에 지운 판넬의 불량이 계속 남는다.
  try {
    await removePanelNcr(panel.id, deletedByName || '자동');
  } catch (err) {
    err.ncrSync = true;
    throw err;
  }
}
