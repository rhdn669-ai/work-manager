-- 디에이치 BOM 의 「구분」을 메티스 기준으로 맞춘다.
-- 2026-09-22 대표님 「판금으로 넣은게 전부 도급으로 들어갔네 옮겨서 맞춰」
--
-- 지금 상태 (품명+규격+BOX 묶음 기준, BOX 있는 줄만)
--   메티스 free → 디에이치 free   134 묶음  ✔ 맞음
--   메티스 도급 → 디에이치 free    66 묶음  ✘ 한 칸 밀림
--   메티스 판금 → 디에이치 도급    60 묶음  ✘ 한 칸 밀림
--
-- 짝 BOM 은 「구분」을 기본으로 함께 걸지 않아(PAIR_DEFAULT.supplyType=false)
-- 디에이치 쪽 값이 따로 놀았다.
--
-- 규칙  같은 «품명+규격+BOX» 줄의 구분을 메티스 값으로 덮는다.
--       BOX 가 비어 있는 줄(따로 정리할 217줄)은 건드리지 않는다.
--       메티스에 짝이 없는 줄도 건드리지 않는다.
-- 안전  백업 → 변경 → 전·후 대조(줄 수·수량 합이 그대로여야 한다) → 다르면 통째 롤백
BEGIN;

DROP TABLE IF EXISTS wm.bom_backup_kind_20260922;
CREATE TABLE wm.bom_backup_kind_20260922 AS SELECT * FROM wm.bom;

-- 메티스 줄의 «자리 → 구분» 표
CREATE TEMP TABLE m_kind AS
SELECT COALESCE(data->>'name','') || E'\t' || COALESCE(data->>'spec','') || E'\t' || COALESCE(data->>'box','') AS k,
       min(COALESCE(data->>'supplyType','')) AS kind,
       count(DISTINCT COALESCE(data->>'supplyType','')) AS kinds
FROM wm.bom
WHERE data->>'siteId' = 'jlctOy26LwZWsYxsxwrA' AND COALESCE(data->>'box','') <> ''
GROUP BY 1;

-- 한 자리에 구분이 섞여 있으면 손대지 않는다 (사람이 봐야 한다)
DELETE FROM m_kind WHERE kinds > 1;

UPDATE wm.bom b
SET data = b.data || jsonb_build_object('supplyType', m.kind, 'updatedAt', now()::text)
FROM m_kind m
WHERE b.data->>'siteId' = 'DD6L7iqAgW9ENBmKUOEI'
  AND COALESCE(b.data->>'box','') <> ''
  AND COALESCE(b.data->>'name','') || E'\t' || COALESCE(b.data->>'spec','') || E'\t' || COALESCE(b.data->>'box','') = m.k
  AND COALESCE(b.data->>'supplyType','') <> m.kind;

-- 대조 ① 줄 수·수량 합은 그대로여야 한다 (구분만 바꿨다)
DO $$
DECLARE b_n int; a_n int; b_q numeric; a_q numeric;
BEGIN
  SELECT count(*), COALESCE(sum(NULLIF(data->>'qty','')::numeric),0) INTO b_n, b_q
    FROM wm.bom_backup_kind_20260922 WHERE data->>'siteId' = 'DD6L7iqAgW9ENBmKUOEI';
  SELECT count(*), COALESCE(sum(NULLIF(data->>'qty','')::numeric),0) INTO a_n, a_q
    FROM wm.bom WHERE data->>'siteId' = 'DD6L7iqAgW9ENBmKUOEI';
  IF b_n <> a_n OR b_q <> a_q THEN
    RAISE EXCEPTION '대조 실패 — 줄 % → %, 수량 % → %', b_n, a_n, b_q, a_q;
  END IF;
  RAISE NOTICE '대조 통과 — 줄 %, 수량 %', a_n, a_q;
END $$;

-- 대조 ② BOX 있는 줄의 구분 분포가 메티스와 같아졌나
\echo '== 맞춘 뒤 — BOX 있는 줄의 구분 분포 =='
SELECT CASE data->>'siteId' WHEN 'jlctOy26LwZWsYxsxwrA' THEN '메티스' ELSE '디에이치' END AS bom,
       COALESCE(NULLIF(data->>'supplyType',''),'도급') AS 구분, count(*)
FROM wm.bom
WHERE data->>'siteId' IN ('jlctOy26LwZWsYxsxwrA','DD6L7iqAgW9ENBmKUOEI')
  AND COALESCE(data->>'box','') <> ''
GROUP BY 1,2 ORDER BY 2,1;

\echo '== 아직 다른 자리가 남았나 (0 이어야 한다) =='
WITH m AS (
  SELECT COALESCE(data->>'name','')||E'\t'||COALESCE(data->>'spec','')||E'\t'||COALESCE(data->>'box','') AS k,
         COALESCE(NULLIF(data->>'supplyType',''),'도급') AS kind
  FROM wm.bom WHERE data->>'siteId'='jlctOy26LwZWsYxsxwrA' AND COALESCE(data->>'box','')<>'' GROUP BY 1,2),
d AS (
  SELECT COALESCE(data->>'name','')||E'\t'||COALESCE(data->>'spec','')||E'\t'||COALESCE(data->>'box','') AS k,
         COALESCE(NULLIF(data->>'supplyType',''),'도급') AS kind
  FROM wm.bom WHERE data->>'siteId'='DD6L7iqAgW9ENBmKUOEI' AND COALESCE(data->>'box','')<>'' GROUP BY 1,2)
SELECT m.kind AS 메티스, d.kind AS 디에이치, count(*) AS 묶음
FROM m JOIN d ON d.k = m.k WHERE m.kind <> d.kind GROUP BY 1,2;

COMMIT;
