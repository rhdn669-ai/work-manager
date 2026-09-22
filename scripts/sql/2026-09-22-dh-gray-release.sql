-- 디에이치 BOM 의 정방향 「안셈」을 「셈」으로 푼다.
-- 2026-09-22 대표님 「디에이치는 정방향도 전부 우리 자재라서」
--
-- 왜 이렇게 됐나  방향(셈/안셈/없음)이 짝 BOM 에서 «늘 같이 가는 칸»이라, 메티스의
--   「정방향 안셈」(그쪽은 고객사가 넣는 자재)이 디에이치로 끌려갔다. 구분(도급/사급)은
--   끌 수 있게 해 뒀으면서 같은 성격인 「안셈」을 묶어 둔 것이 설계 실수였다.
--   v162.3 에서 «「없음」만 옮기고 「안셈」은 각자» 로 고쳤다 — 여기서는 이미 끌려간 자료를 푼다.
--
-- 푸는 것  디에이치의 정방향 「안셈」 → 「셈」 (71줄)
-- 그대로 두는 것  「없음」(설계 사실이라 양쪽 같다) · 역방향 · 메티스 전부
-- 안전  백업 → 풀기 → 대조(디에이치에 정방향 안셈 0 · 「없음」 수 그대로 · 메티스 무변동)
BEGIN;

DROP TABLE IF EXISTS wm.bom_backup_dhgray_20260922;
CREATE TABLE wm.bom_backup_dhgray_20260922 AS SELECT * FROM wm.bom;

-- 지금 방향을 읽어(새 칸 우선, 없으면 옛 칸) 정방향이 「안셈」인 줄만 고른다
CREATE TEMP TABLE tgt AS
SELECT id,
       CASE WHEN data->'dirState' IS NOT NULL AND data->>'dirState' <> '{}' THEN COALESCE(data->'dirState'->>'역','use')
            WHEN data->>'dirs'='["정"]' THEN (CASE WHEN data->>'dirHide'='true' THEN 'none' ELSE 'gray' END)
            WHEN data->>'dirs'='["역"]' THEN 'use'
            ELSE 'use' END AS v
FROM wm.bom
WHERE data->>'siteId'='DD6L7iqAgW9ENBmKUOEI'
  AND (CASE WHEN data->'dirState' IS NOT NULL AND data->>'dirState' <> '{}' THEN COALESCE(data->'dirState'->>'정','use')
            WHEN data->>'dirs'='["정"]' THEN 'use'
            WHEN data->>'dirs'='["역"]' THEN (CASE WHEN data->>'dirHide'='true' THEN 'none' ELSE 'gray' END)
            WHEN data->>'skipForward'='true' THEN 'gray'
            ELSE 'use' END) = 'gray';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM tgt;
  IF n <> 71 THEN RAISE EXCEPTION '멈춤 — 풀 줄이 %개입니다 (예상 71)', n; END IF;
  RAISE NOTICE '풀 줄 %개', n;
END $$;

UPDATE wm.bom b
SET data = b.data || jsonb_build_object(
      'dirState', jsonb_build_object('정', 'use', '역', t.v),
      'updatedAt', now()::text)
FROM tgt t WHERE t.id = b.id;

-- 대조 ① 디에이치에 정방향 「안셈」이 남으면 안 된다
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM wm.bom
   WHERE data->>'siteId'='DD6L7iqAgW9ENBmKUOEI' AND data->'dirState'->>'정' = 'gray';
  IF n > 0 THEN RAISE EXCEPTION '대조 실패 — 정방향 안셈 %줄 남음', n; END IF;
END $$;

-- 대조 ② 「없음」은 하나도 안 줄어야 한다
DO $$
DECLARE b int; a int;
BEGIN
  SELECT count(*) INTO b FROM wm.bom_backup_dhgray_20260922
   WHERE data->>'siteId'='DD6L7iqAgW9ENBmKUOEI'
     AND (data->'dirState'->>'정'='none' OR data->'dirState'->>'역'='none'
          OR (data->>'dirHide'='true' AND data ? 'dirs'));
  SELECT count(*) INTO a FROM wm.bom
   WHERE data->>'siteId'='DD6L7iqAgW9ENBmKUOEI'
     AND (data->'dirState'->>'정'='none' OR data->'dirState'->>'역'='none'
          OR (data->>'dirHide'='true' AND data ? 'dirs'));
  IF a < b THEN RAISE EXCEPTION '대조 실패 — 「없음」이 % → % 로 줄었습니다', b, a; END IF;
END $$;

-- 대조 ③ 메티스는 한 줄도 안 바뀐다
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM wm.bom b JOIN wm.bom_backup_dhgray_20260922 k ON k.id=b.id
   WHERE b.data->>'siteId'='jlctOy26LwZWsYxsxwrA' AND b.data::text <> k.data::text;
  IF n > 0 THEN RAISE EXCEPTION '대조 실패 — 메티스 %줄이 바뀌었습니다', n; END IF;
  RAISE NOTICE '메티스는 그대로';
END $$;

\echo '== 푼 뒤 — 두 BOM 의 방향 =='
SELECT CASE data->>'siteId' WHEN 'jlctOy26LwZWsYxsxwrA' THEN '메티스' ELSE '디에이치' END AS bom,
       CASE WHEN data->'dirState' IS NOT NULL AND data->>'dirState' <> '{}' THEN COALESCE(data->'dirState'->>'정','use')
            WHEN data->>'dirs'='["정"]' THEN 'use'
            WHEN data->>'dirs'='["역"]' THEN (CASE WHEN data->>'dirHide'='true' THEN 'none' ELSE 'gray' END)
            WHEN data->>'skipForward'='true' THEN 'gray' ELSE 'use' END AS 정,
       CASE WHEN data->'dirState' IS NOT NULL AND data->>'dirState' <> '{}' THEN COALESCE(data->'dirState'->>'역','use')
            WHEN data->>'dirs'='["정"]' THEN (CASE WHEN data->>'dirHide'='true' THEN 'none' ELSE 'gray' END)
            WHEN data->>'dirs'='["역"]' THEN 'use' ELSE 'use' END AS 역,
       count(*)
FROM wm.bom WHERE data->>'siteId' IN ('jlctOy26LwZWsYxsxwrA','DD6L7iqAgW9ENBmKUOEI')
GROUP BY 1,2,3 ORDER BY 1,4 DESC;

COMMIT;
