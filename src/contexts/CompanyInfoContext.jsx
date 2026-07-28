import { useState, useEffect, useCallback } from 'react';
import { CompanyInfoContext } from './useCompanyInfo';
import { getCompanyInfo, DEFAULT_COMPANY_INFO } from '../services/companyInfoService';

// 앱 전역에서 1회 로드 — 견적서·발주서·BOM 출력물이 같은 발행처 정보를 공유한다.
export function CompanyInfoProvider({ children }) {
  const [info, setInfo] = useState(DEFAULT_COMPANY_INFO);

  const refresh = useCallback(() => {
    getCompanyInfo()
      .then(setInfo)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <CompanyInfoContext.Provider value={{ info, refresh }}>{children}</CompanyInfoContext.Provider>;
}
