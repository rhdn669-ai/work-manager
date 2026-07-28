import { createContext, useContext } from 'react';

export const CompanyInfoContext = createContext(null);

// { info, refresh } — info: 견적서·발주서·BOM 공용 발행처 정보(회사명·사업자번호·주소 등)
export function useCompanyInfo() {
  const context = useContext(CompanyInfoContext);
  if (!context) {
    throw new Error('useCompanyInfo는 CompanyInfoProvider 안에서 사용해야 합니다');
  }
  return context;
}
