-- 디에이치 BOM 의 「BOX 미지정」 중복 217줄을 지운다.
-- 2026-09-22 대표님 「B ㄱㄱ」
--
-- 어쩌다 생겼나  09-22 04:23~04:26 에 「품목 불러오기」로 담은 줄에 BOX 가 안 붙어(v160.9 에서
--   고침) 화면에서 걸러져 안 보였고, 안 담긴 줄 알고 거듭 담아 217줄이 쌓였다.
-- 왜 지워도 되나  전부 이미 있는 품목의 중복이고(새 품목 0), 호기 체크가 하나도 걸려 있지 않다.
-- 안전  지우기 전에 «호기 체크 0» 을 다시 확인하고, 하나라도 걸려 있으면 통째로 멈춘다.
--       백업 → 삭제 → 전·후 대조 → 다르면 통째 롤백.
BEGIN;

DROP TABLE IF EXISTS wm.bom_backup_dupdel_20260922;
CREATE TABLE wm.bom_backup_dupdel_20260922 AS SELECT * FROM wm.bom;

CREATE TEMP TABLE dup AS
SELECT id FROM wm.bom
WHERE data->>'siteId' = 'DD6L7iqAgW9ENBmKUOEI' AND COALESCE(data->>'box','') = '';

-- 빗장 ① 호기 체크가 하나라도 걸려 있으면 멈춘다
DO $$
DECLARE used numeric;
BEGIN
  SELECT COALESCE(sum((e.value->>'qty')::numeric),0) INTO used
    FROM wm.panel_materials t, jsonb_each(t.data->'items') e
   WHERE e.key IN (SELECT id FROM dup);
  IF used > 0 THEN
    RAISE EXCEPTION '멈춤 — 지우려는 줄에 호기 체크 %개가 걸려 있습니다', used;
  END IF;
END $$;

-- 빗장 ② 개수가 예상(217)과 다르면 멈춘다
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM dup;
  IF n <> 217 THEN
    RAISE EXCEPTION '멈춤 — 지울 줄이 217개가 아니라 %개입니다', n;
  END IF;
  RAISE NOTICE '지울 줄 %개', n;
END $$;

DELETE FROM wm.bom WHERE id IN (SELECT id FROM dup);

-- 대조 ① 남은 줄 수가 메티스와 같아야 한다
DO $$
DECLARE dh int; ms int;
BEGIN
  SELECT count(*) INTO dh FROM wm.bom WHERE data->>'siteId' = 'DD6L7iqAgW9ENBmKUOEI';
  SELECT count(*) INTO ms FROM wm.bom WHERE data->>'siteId' = 'jlctOy26LwZWsYxsxwrA';
  IF dh <> ms THEN
    RAISE EXCEPTION '대조 실패 — 디에이치 %줄, 메티스 %줄', dh, ms;
  END IF;
  RAISE NOTICE '대조 통과 — 양쪽 %줄', dh;
END $$;

-- 대조 ② 메티스 줄은 하나도 건드리지 않았다
DO $$
DECLARE b int; a int;
BEGIN
  SELECT count(*) INTO b FROM wm.bom_backup_dupdel_20260922 WHERE data->>'siteId' = 'jlctOy26LwZWsYxsxwrA';
  SELECT count(*) INTO a FROM wm.bom WHERE data->>'siteId' = 'jlctOy26LwZWsYxsxwrA';
  IF b <> a THEN RAISE EXCEPTION '대조 실패 — 메티스가 % → % 로 바뀌었습니다', b, a; END IF;
END $$;

\echo '== 마무리 — 두 BOM 의 구분·수량 =='
SELECT CASE data->>'siteId' WHEN 'jlctOy26LwZWsYxsxwrA' THEN '메티스' ELSE '디에이치' END AS bom,
       count(*) AS "줄 수",
       sum(COALESCE(NULLIF(data->>'qty','')::numeric,0)) AS "수량 합",
       count(*) FILTER (WHERE COALESCE(data->>'supplyType','') = '') AS 도급,
       count(*) FILTER (WHERE data->>'supplyType' = 'free') AS 사급,
       count(*) FILTER (WHERE data->>'supplyType' = 'made') AS 판금
FROM wm.bom
WHERE data->>'siteId' IN ('jlctOy26LwZWsYxsxwrA','DD6L7iqAgW9ENBmKUOEI')
GROUP BY 1 ORDER BY 1;

COMMIT;
