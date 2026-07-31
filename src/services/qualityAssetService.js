import { collection, doc, addDoc, updateDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { trashGeneric } from './trashService';
import { nextCalibrationDate } from '../domain/qualityForms';

// 품질 자산 — 계측기·지그·치공구를 한 컬렉션에서 assetType 으로 구분한다.
// 세 서식(QP-703A/706A/705A)의 스키마가 사실상 동일해 테이블을 나눌 이유가 없다.
const assetsRef = collection(db, 'qualityAssets');

// 실시간 구독 — 차기교정일을 계산해 붙여서 콜백 (저장하지 않고 파생)
export function subscribeAssets(cb) {
  return onSnapshot(assetsRef, (snap) => {
    const rows = snap.docs
      .map((d) => {
        const a = { id: d.id, ...d.data() };
        return { ...a, nextDate: a.nextDate || nextCalibrationDate(a.lastDate, a.cycleMonths) };
      })
      .sort((a, b) => (a.assetNo || '').localeCompare(b.assetNo || '', undefined, { numeric: true }));
    cb(rows);
  });
}

export async function addAsset(data) {
  const { id: _id, ...rest } = data;
  const ref = await addDoc(assetsRef, { ...rest, createdAt: serverTimestamp() });
  return { id: ref.id, ...rest };
}

export async function updateAsset(id, patch) {
  await updateDoc(doc(db, 'qualityAssets', id), { ...patch, updatedAt: serverTimestamp() });
}

// 삭제는 휴지통 경유 — 영구삭제는 관리자만 전역 휴지통에서
export async function trashAsset(asset, deletedByName = '') {
  return trashGeneric(
    'qualityAssets',
    asset.id,
    { title: `${asset.assetNo || ''} ${asset.name || ''}`.trim(), summary: asset.maker || '' },
    deletedByName,
  );
}
