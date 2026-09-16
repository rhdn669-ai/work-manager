// 사급 재고 — 고객사가 준 물건을 호기 정하기 전에 모아 두는 곳. (2026-09-10 대표님)
//
// 셈은 stockService(세 갈래 공용)에 있다. 여기는 «사급» 이름으로 부르던 자리를 그대로 두는
// 얇은 껍데기다 — 화면 코드가 갈래를 모른 채 부르던 이름을 한꺼번에 바꾸지 않으려고.
// (2026-09-15 설계 「재고를 통 실값 하나로」 3단계)
import { subscribeStock, getStockSplit, receiveStock, setStockTo } from './stockService';

export const subscribeFreeStock = (company, cb) => subscribeStock('free', company, cb);
export const getFreeStockSplit = (company, itemId) => getStockSplit('free', company, itemId);
export const receiveFreeStock = (company, item, n, opts) => receiveStock('free', company, item, n, opts);
export const setFreeStockQty = (company, item, to, opts) => setStockTo('free', company, item, to, opts);
