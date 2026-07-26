import { createContext, useContext } from 'react';

// Context 객체는 훅 파일에 둔다(코드베이스 패턴: useUndo/useAuth). Provider는 UploadContext.jsx.
export const UploadContext = createContext(null);

export function useUploads() {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUploads must be used within UploadProvider');
  return ctx;
}
