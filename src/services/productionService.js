import { collection, doc, addDoc, updateDoc, onSnapshot, serverTimestamp, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../config/firebase';
import { trashGeneric } from './trashService';
import { recompute } from '../domain/production';
import { syncPanelNcr, removePanelNcr } from './qualityRecordService';

// 판넬 생산현황 — Firestore 실시간 (전 직원 조회 · 관리자 편집).
// NAS(Supabase) 이전 시 이 파일만 어댑터 교체하면 화면 무수정.
const panelsRef = collection(db, 'productionPanels');

// 실시간 구독 — recompute(진행률·종합상태) 적용해 콜백
export function subscribePanels(cb) {
  return onSnapshot(panelsRef, (snap) => {
    const rows = snap.docs
      .map((d) => recompute({ id: d.id, ...d.data() }))
      .sort(
        (a, b) =>
          (a.납기 || '9999').localeCompare(b.납기 || '9999') ||
          (a.호기 || '').localeCompare(b.호기 || '', undefined, { numeric: true }),
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

// 불량 사진 업로드 → 다운로드 URL 반환 (Firestore엔 URL만 저장 — 문서 1MB 제한 보호)
export async function uploadDefectPhoto(file) {
  const path = `productionDefects/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const snap = await uploadBytes(ref(storage, path), file, { contentType: file.type || 'image/jpeg' });
  return getDownloadURL(snap.ref);
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
