import { doc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

// 신규 사용자 프로필 생성 (회원가입 시)
export async function createUserProfile(uid, data) {
  await setDoc(doc(db, 'users', uid), {
    uid,
    email: data.email,
    name: data.name,
    role: data.role || 'employee',
    departmentId: data.departmentId || '',
    joinDate: data.joinDate || new Date().toISOString().split('T')[0],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}
