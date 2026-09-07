import { doc, setDoc } from '../config/data';
import { db } from '../config/data';
import { getToday } from '../utils/dateUtils';

// 신규 사용자 프로필 생성 (회원가입 시)
export async function createUserProfile(uid, data) {
  await setDoc(doc(db, 'users', uid), {
    uid,
    email: data.email,
    name: data.name,
    role: data.role || 'employee',
    departmentId: data.departmentId || '',
    joinDate: data.joinDate || getToday(),
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}
