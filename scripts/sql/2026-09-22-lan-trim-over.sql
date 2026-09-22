-- 메티스 273~468 호기 LAN 의 「초과」 28칸을 각 줄의 필요 수량으로 내린다.
-- 2026-09-22 대표님 「해당 호기들 랜은 재고도 없고 각자 필요 수량에 맞게 채워주면 됨」
--
-- 왜 초과가 생겼나  예전에 한 줄이던 것이 둘로 나뉘며 이 줄의 필요가 줄었는데 체크는 남았다
--   (200MM 은 필요 1 에 체크 8). BOM 수량이 줄어든 줄도 있다.
--
-- 통은 안 건드린다  사급 통의 LAN 잔량이 실제로 0 이다(5000MM 4 는 조금 전 「없음」 정리로
--   되돌린 몫). 통에 없던 것을 «통에서»로 체크해 둔 기록이라, 내리면서 통에 더해 주면
--   장부가 실물보다 늘어난다. fromStock 은 줄이되 통 잔량은 그대로 둔다.
--   (대표님 「재고도 없고」)
--
-- 안전  백업 → 내림 → 대조(초과 0 · 통 잔량 변화 0) → 다르면 통째 롤백
BEGIN;

DROP TABLE IF EXISTS wm.pm_backup_lantrim_20260922;
CREATE TABLE wm.pm_backup_lantrim_20260922 AS SELECT * FROM wm.panel_materials;

CREATE TEMP TABLE over AS
WITH pan AS (
  SELECT id, COALESCE(data->>'프로젝트','') AS nm, right(COALESCE(data->>'프로젝트',''),3)::int AS no,
         COALESCE(NULLIF(data->>'정역',''),'') AS dir, COALESCE(data->'bomLink'->>'variantKey','') AS vk
  FROM wm.production_panels WHERE data->'bomLink'->>'projectId'='jlctOy26LwZWsYxsxwrA'),
lan AS (
  SELECT id, COALESCE(data->>'spec','') AS sp, COALESCE(data->>'box','') AS box,
         COALESCE(NULLIF(data->>'qty','')::numeric,0) AS q,
         COALESCE(data->'qtyByVariant','{}'::jsonb) AS qv, COALESCE(data->'variantKeys','[]'::jsonb) AS vks,
         CASE WHEN data->'dirState' IS NOT NULL AND data->>'dirState' <> '{}' THEN data->'dirState'
              WHEN data->>'dirs'='["정"]' THEN jsonb_build_object('정','use','역',(CASE WHEN data->>'dirHide'='true' THEN 'none' ELSE 'gray' END))
              WHEN data->>'dirs'='["역"]' THEN jsonb_build_object('정',(CASE WHEN data->>'dirHide'='true' THEN 'none' ELSE 'gray' END),'역','use')
              WHEN data->>'skipForward'='true' THEN '{"정":"gray","역":"use"}'::jsonb
              ELSE '{"정":"use","역":"use"}'::jsonb END AS ds
  FROM wm.bom WHERE data->>'siteId'='jlctOy26LwZWsYxsxwrA' AND COALESCE(data->>'name','') LIKE '%LAN%')
SELECT p.nm, l.sp, p.id || '__' || replace(l.box,'/','∕') AS docid, l.id AS bid,
       (CASE WHEN l.qv ? p.vk THEN COALESCE(NULLIF(l.qv->>p.vk,'')::numeric,0) ELSE l.q END) AS need
FROM pan p CROSS JOIN lan l
LEFT JOIN wm.panel_materials m ON m.id = p.id || '__' || replace(l.box,'/','∕')
WHERE p.no BETWEEN 273 AND 468 AND (jsonb_array_length(l.vks)=0 OR l.vks ? p.vk)
  AND COALESCE(l.ds->>p.dir,'use')='use'
  AND COALESCE((m.data->'items'->l.id->>'qty')::numeric,0)
      > (CASE WHEN l.qv ? p.vk THEN COALESCE(NULLIF(l.qv->>p.vk,'')::numeric,0) ELSE l.q END);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM over;
  IF n <> 28 THEN RAISE EXCEPTION '멈춤 — 내릴 칸이 %개입니다 (예상 28)', n; END IF;
  RAISE NOTICE '내릴 칸 %개', n;
END $$;

DO $$
DECLARE o RECORD; cur jsonb; fs numeric; fo numeric; n int := 0; cut numeric := 0;
        today text := to_char(now(),'YYYY-MM-DD');
BEGIN
  FOR o IN SELECT * FROM over LOOP
    SELECT COALESCE(t.data->'items'->o.bid,'{}'::jsonb) INTO cur FROM wm.panel_materials t WHERE t.id=o.docid;
    cut := cut + (COALESCE((cur->>'qty')::numeric,0) - o.need);
    fs := LEAST(COALESCE((cur->>'fromStock')::numeric,0), o.need);
    fo := LEAST(COALESCE((cur->>'fromOurs')::numeric,0), fs);
    UPDATE wm.panel_materials t
    SET data = t.data || jsonb_build_object(
          'items', COALESCE(t.data->'items','{}'::jsonb) || jsonb_build_object(o.bid,
            cur || jsonb_build_object('qty', o.need, 'fromStock', fs, 'fromOurs', fo,
                                      'at', today, 'by', '일괄(초과 정리 · 필요 수량으로)')),
          'updatedAt', now()::text)
    WHERE t.id = o.docid;
    n := n + 1;
  END LOOP;
  RAISE NOTICE '내린 칸 %개 · 줄인 수량 %', n, cut;
END $$;

-- 대조 ① 초과가 하나도 남으면 안 된다
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM over o JOIN wm.panel_materials t ON t.id=o.docid
   WHERE COALESCE((t.data->'items'->o.bid->>'qty')::numeric,0) > o.need;
  IF n > 0 THEN RAISE EXCEPTION '대조 실패 — 아직 초과 %칸', n; END IF;
END $$;

-- 대조 ② 통 잔량은 한 개도 안 바뀌어야 한다
DO $$
DECLARE b numeric; a numeric;
BEGIN
  SELECT COALESCE(sum((data->>'qty')::numeric),0) INTO b FROM wm.fs_backup_lan273_20260922;
  SELECT COALESCE(sum((data->>'qty')::numeric),0) INTO a FROM wm.free_stock;
  IF a <> b + 4 THEN RAISE EXCEPTION '대조 실패 — 통 잔량이 % → % (앞선 되돌림 4 만 있어야 한다)', b, a; END IF;
  RAISE NOTICE '통 잔량 그대로 — %', a;
END $$;

\echo '== 마무리 — 호기별 LAN(셈) 필요 vs 체크 =='
WITH pan AS (
  SELECT id, COALESCE(data->>'프로젝트','') AS nm, right(COALESCE(data->>'프로젝트',''),3)::int AS no,
         COALESCE(NULLIF(data->>'정역',''),'') AS dir, COALESCE(data->'bomLink'->>'variantKey','') AS vk
  FROM wm.production_panels WHERE data->'bomLink'->>'projectId'='jlctOy26LwZWsYxsxwrA'),
lan AS (
  SELECT id, COALESCE(data->>'box','') AS box, COALESCE(NULLIF(data->>'qty','')::numeric,0) AS q,
         COALESCE(data->'qtyByVariant','{}'::jsonb) AS qv, COALESCE(data->'variantKeys','[]'::jsonb) AS vks,
         CASE WHEN data->'dirState' IS NOT NULL AND data->>'dirState' <> '{}' THEN data->'dirState'
              WHEN data->>'dirs'='["정"]' THEN jsonb_build_object('정','use','역',(CASE WHEN data->>'dirHide'='true' THEN 'none' ELSE 'gray' END))
              WHEN data->>'dirs'='["역"]' THEN jsonb_build_object('정',(CASE WHEN data->>'dirHide'='true' THEN 'none' ELSE 'gray' END),'역','use')
              ELSE '{"정":"use","역":"use"}'::jsonb END AS ds
  FROM wm.bom WHERE data->>'siteId'='jlctOy26LwZWsYxsxwrA' AND COALESCE(data->>'name','') LIKE '%LAN%')
SELECT p.nm AS 호기,
       sum(CASE WHEN l.qv ? p.vk THEN COALESCE(NULLIF(l.qv->>p.vk,'')::numeric,0) ELSE l.q END) AS 필요,
       sum(COALESCE((m.data->'items'->l.id->>'qty')::numeric,0)) AS 체크
FROM pan p CROSS JOIN lan l
LEFT JOIN wm.panel_materials m ON m.id = p.id || '__' || replace(l.box,'/','∕')
WHERE p.no BETWEEN 273 AND 468 AND (jsonb_array_length(l.vks)=0 OR l.vks ? p.vk)
  AND COALESCE(l.ds->>p.dir,'use')='use'
GROUP BY 1 ORDER BY 1;

COMMIT;
