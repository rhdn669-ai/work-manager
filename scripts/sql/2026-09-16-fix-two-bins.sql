-- 야간 조사에서 찾은 통 두 개 맞춤 (2026-09-16)
-- ① 사급 ELCB EW32AAG-2P015B(15A) 메티스 — 재고 3인데 「당사」가 6.
--    9/15 04:18 「실물 맞춤 0」 때 당사 몫이 같이 안 내려가, 그 뒤 당사 3 입고가 얹혀 6이 됐다.
--    (v144.2 에서 setStockTo 가 당사 몫을 남음으로 자르게 고쳤지만 그 전에 생긴 값이다)
--    당사 몫은 남음을 넘을 수 없으므로 3 으로 맞춘다.
update wm.free_stock
   set data = jsonb_set(data, '{ours}', to_jsonb(least((data->>'ours')::numeric, (data->>'qty')::numeric)))
 where data->>'company' = '메티스'
   and data->>'spec' like 'EW32AAG-2P015B%'
   and (data->>'ours')::numeric > (data->>'qty')::numeric;

-- ② 도급 N/F WYNFS50T2M 메티스 — 수량 7, 로그 합 6 (9/15 저녁 연타 시험에서 한 번 어긋남).
--    실물이 7 이면 그대로 두고, 6 이면 아래 한 줄을 실행하세요. 기본은 «건드리지 않음».
-- update wm.paid_stock set data = jsonb_set(data, '{qty}', '6')
--  where data->>'company'='메티스' and data->>'spec'='WYNFS50T2M';

-- 확인 — 당사 몫이 남음을 넘는 줄이 남았는지
select data->>'company', data->>'name', data->>'spec', data->>'qty', data->>'ours'
  from wm.free_stock where (data->>'ours')::numeric > (data->>'qty')::numeric;
