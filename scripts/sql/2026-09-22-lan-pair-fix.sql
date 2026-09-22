-- 디에이치 BOM 의 LAN 7곳을 메티스와 같게 맞춘다.
-- 2026-09-22 대표님 「일단 랜 정리부터 하자」
--
-- 왜 어긋났나  짝 BOM 이 「같은 줄」을 알아보는 열쇠가 «품목 × BOX × variantKeys» 뿐인데,
--   9/21 타입별 수량으로 옮기며 variantKeys 가 비어 열쇠가 사실상 «품목 × BOX» 가 됐다.
--   LAN 은 같은 규격이 한 BOX(준비작업)에 두 줄씩이라 열쇠가 겹치고, twinOf 가 find 로
--   앞의 하나만 집는다(bomService 130·322 행). 그래서 메티스에서 고친 것이 디에이치로
--   안 갔다 — 디에이치 order 276~280 줄이 use/use(기본값) 그대로 남았다.
--   ※ 구조 자체(A′)는 따로 고친다. 여기서는 어긋난 자료만 맞춘다.
--
-- 타입 열쇠  메티스 vT5391·vM7H  ↔  디에이치 vmtwa6ghk·vmtwa6plx (라벨로 대응)
-- 안전  백업 → 고침 → 대조(LAN 줄 수·수량이 양쪽 같아지는지) → 다르면 통째 롤백
BEGIN;

DROP TABLE IF EXISTS wm.bom_backup_lan_20260922;
CREATE TABLE wm.bom_backup_lan_20260922 AS SELECT * FROM wm.bom;

-- ① 방향만 어긋난 다섯 줄
UPDATE wm.bom SET data = data || jsonb_build_object('dirState', '{"정":"gray","역":"use"}'::jsonb, 'updatedAt', now()::text)
WHERE id IN ('tDRiAwOFQGDEhB1i10r9', 'T0akQsH8DbzejuSMaUqo', 'b95LlxSdgAN7BvSCZ9N2'); -- 1500·2250·2500MM

UPDATE wm.bom SET data = data || jsonb_build_object('dirState', '{"정":"none","역":"use"}'::jsonb, 'updatedAt', now()::text)
WHERE id = 'SAw1BDztxMOzCr1xEJM4'; -- 3500MM

UPDATE wm.bom SET data = data || jsonb_build_object('dirState', '{"정":"gray","역":"none"}'::jsonb, 'updatedAt', now()::text)
WHERE id = 'N9iJBMfj1AJOSvFaymp4'; -- 5000MM

-- ② 수량이 어긋난 한 줄 — 메티스 7 {vM7H:6} → 디에이치 7 {vmtwa6plx:6}
UPDATE wm.bom
SET data = data || jsonb_build_object('qty', '7', 'qtyByVariant', '{"vmtwa6plx":6}'::jsonb, 'updatedAt', now()::text)
WHERE id = 'CNPyTGjynOIFEnFCPzJV'; -- 200MM

-- ③ 디에이치에 아예 없는 줄 하나 — 메티스 2750MM [없음/셈] 을 그대로 옮겨 심는다
INSERT INTO wm.bom (id, data)
SELECT 'lanpair2750dh',
       jsonb_build_object(
         'siteId', 'DD6L7iqAgW9ENBmKUOEI',
         'itemId', COALESCE(m.data->>'itemId',''),
         'name', COALESCE(m.data->>'name',''),
         'spec', COALESCE(m.data->>'spec',''),
         'unit', COALESCE(m.data->>'unit',''),
         'drawingNo', COALESCE(m.data->>'drawingNo',''),
         'note', COALESCE(m.data->>'note',''),
         'box', COALESCE(m.data->>'box',''),
         'qty', COALESCE(m.data->>'qty','1'),
         'unitPrice', COALESCE(m.data->>'unitPrice','0'),
         -- 구분은 디에이치 쪽 성질을 따른다 — 두 BOM 은 구분을 따로 쓴다(짝 설정 supplyType:false)
         'supplyType', 'free',
         'variantKeys', '[]'::jsonb,
         'qtyByVariant', '{}'::jsonb,
         'dirs', '[]'::jsonb,
         'dirHide', false,
         'dirState', '{"정":"none","역":"use"}'::jsonb,
         'order', 281,
         'createdAt', now()::text,
         'updatedAt', now()::text)
FROM wm.bom m WHERE m.id = 'yn3MeA3kiFOVMPQ9Y6mP'
  AND NOT EXISTS (SELECT 1 FROM wm.bom d
                  WHERE d.data->>'siteId'='DD6L7iqAgW9ENBmKUOEI'
                    AND d.data->>'spec'='STD LAN-COMMUNICATION_2750MM');

-- 대조 — LAN 줄 수·수량이 양쪽 같아져야 한다
DO $$
DECLARE mn int; dn int; mq numeric; dq numeric;
BEGIN
  SELECT count(*), COALESCE(sum(NULLIF(data->>'qty','')::numeric),0) INTO mn, mq
    FROM wm.bom WHERE data->>'siteId'='jlctOy26LwZWsYxsxwrA' AND COALESCE(data->>'name','') LIKE '%LAN%';
  SELECT count(*), COALESCE(sum(NULLIF(data->>'qty','')::numeric),0) INTO dn, dq
    FROM wm.bom WHERE data->>'siteId'='DD6L7iqAgW9ENBmKUOEI' AND COALESCE(data->>'name','') LIKE '%LAN%';
  IF mn <> dn OR mq <> dq THEN
    RAISE EXCEPTION 'LAN 대조 실패 — 줄 % vs %, 수량 % vs %', mn, dn, mq, dq;
  END IF;
  RAISE NOTICE 'LAN 대조 통과 — 양쪽 %줄 · 수량 %', mn, mq;
END $$;

\echo '== 맞춘 뒤 — 두 BOM 전체 =='
SELECT CASE data->>'siteId' WHEN 'jlctOy26LwZWsYxsxwrA' THEN '메티스' ELSE '디에이치' END AS bom,
       count(*) AS 줄, sum(COALESCE(NULLIF(data->>'qty','')::numeric,0)) AS 수량합
FROM wm.bom WHERE data->>'siteId' IN ('jlctOy26LwZWsYxsxwrA','DD6L7iqAgW9ENBmKUOEI') GROUP BY 1 ORDER BY 1;

COMMIT;
