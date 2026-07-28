import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

// 견적서·발주서·BOM 3종 출력물이 공용으로 쓰는 발행처 정보.
// 기본값은 코드에 두고, 관리자가 "견적서 관리 → 양식 설정"에서 수정하면
// Firestore appConfig/companyInfo에 저장되어 3종에 동시 반영된다.
export const DEFAULT_COMPANY_INFO = {
  companyAndCeo: '(주)아이오피엔 / 이종현',
  businessNumber: '222-81-36621',
  address: '충남 천안시 서북구 성환읍 율금1길 8-15',
  telFax: '041-415-0766 / 041-415-0767',
  email: 'iopn2024@naver.com',
  contact: '손성욱 / 010-7704-0331',
};

const infoDoc = doc(db, 'appConfig', 'companyInfo');

export async function getCompanyInfo() {
  const snap = await getDoc(infoDoc);
  return snap.exists() ? { ...DEFAULT_COMPANY_INFO, ...snap.data() } : { ...DEFAULT_COMPANY_INFO };
}

export async function saveCompanyInfo(data) {
  await setDoc(infoDoc, data, { merge: true });
}
