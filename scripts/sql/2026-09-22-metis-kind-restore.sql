-- 짝 BOM 의 「구분」 동기화를 도로 끄고, 딸려 돌아간 메티스 66줄을 되돌린다.
-- 2026-09-22 대표님 「구분까지 통일하면 어떻게함? 디에이치꺼 전부 도급품 사급으로 돌리다가
--                     메티스꺼도 같이 돌아갔다 다시원복해줘」
--
-- 앞서 짝 설정에 구분을 켰더니, 디에이치에서 도급 66줄을 사급으로 돌릴 때 메티스도 같이 돌았다.
-- 두 BOM 은 구분을 «따로» 쓴다 — 켠 것을 도로 끈다. (기본값을 켜자는 제안도 함께 접는다)
--
-- 되돌릴 것  메티스만. 디에이치는 대표님이 뜻한 대로 사급으로 둔다.
-- 기준       wm.bom_backup_dupdel_20260922 (구분을 맞춘 직후, 대표님이 돌리기 전)
-- 안전       백업 → 되돌림 → 대조(줄 수·수량 그대로, 디에이치는 한 줄도 안 바뀜) → 다르면 롤백
BEGIN;

DROP TABLE IF EXISTS wm.bom_backup_restore_20260922;
CREATE TABLE wm.bom_backup_restore_20260922 AS SELECT * FROM wm.bom;

-- ① 짝 설정에서 구분 동기화를 끈다
UPDATE wm.bom_projects
SET data = jsonb_set(data, '{pair,sync,supplyType}', 'false'::jsonb)
WHERE id IN ('jlctOy26LwZWsYxsxwrA','DD6L7iqAgW9ENBmKUOEI')
  AND data->'pair'->'sync' IS NOT NULL;

-- ② 메티스 줄의 구분을 «돌리기 전» 값으로 되돌린다
UPDATE wm.bom b
SET data = b.data || jsonb_build_object('supplyType', COALESCE(k.data->>'supplyType',''), 'updatedAt', now()::text)
FROM wm.bom_backup_dupdel_20260922 k
WHERE k.id = b.id
  AND b.data->>'siteId' = 'jlctOy26LwZWsYxsxwrA'
  AND COALESCE(b.data->>'supplyType','') <> COALESCE(k.data->>'supplyType','');

-- 대조 ① 줄 수·수량은 그대로 (구분만 되돌렸다)
DO $$
DECLARE b_n int; a_n int; b_q numeric; a_q numeric;
BEGIN
  SELECT count(*), COALESCE(sum(NULLIF(data->>'qty','')::numeric),0) INTO b_n, b_q
    FROM wm.bom_backup_restore_20260922 WHERE data->>'siteId' = 'jlctOy26LwZWsYxsxwrA';
  SELECT count(*), COALESCE(sum(NULLIF(data->>'qty','')::numeric),0) INTO a_n, a_q
    FROM wm.bom WHERE data->>'siteId' = 'jlctOy26LwZWsYxsxwrA';
  IF b_n <> a_n OR b_q <> a_q THEN
    RAISE EXCEPTION '대조 실패 — 줄 % → %, 수량 % → %', b_n, a_n, b_q, a_q;
  END IF;
END $$;

-- 대조 ② 디에이치는 한 줄도 안 바뀌었다
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM wm.bom b JOIN wm.bom_backup_restore_20260922 k ON k.id = b.id
   WHERE b.data->>'siteId' = 'DD6L7iqAgW9ENBmKUOEI'
     AND COALESCE(b.data->>'supplyType','') <> COALESCE(k.data->>'supplyType','');
  IF n > 0 THEN RAISE EXCEPTION '대조 실패 — 디에이치 %줄이 바뀌었습니다', n; END IF;
  RAISE NOTICE '디에이치는 그대로';
END $$;

\echo '== 되돌린 뒤 =='
SELECT CASE data->>'siteId' WHEN 'jlctOy26LwZWsYxsxwrA' THEN '메티스' ELSE '디에이치' END AS bom,
       count(*) AS 줄,
       count(*) FILTER (WHERE COALESCE(data->>'supplyType','') = '') AS 도급,
       count(*) FILTER (WHERE data->>'supplyType' = 'free') AS 사급,
       count(*) FILTER (WHERE data->>'supplyType' = 'made') AS 판금
FROM wm.bom WHERE data->>'siteId' IN ('jlctOy26LwZWsYxsxwrA','DD6L7iqAgW9ENBmKUOEI')
GROUP BY 1 ORDER BY 1;

\echo '== 짝 설정 =='
SELECT data->>'name' AS 이름, data->'pair'->'sync' AS 짝설정
FROM wm.bom_projects WHERE id IN ('jlctOy26LwZWsYxsxwrA','DD6L7iqAgW9ENBmKUOEI');

COMMIT;
