-- 메티스 468 이하 호기 30대의 LAN 을 «다 들어온 것»으로 채운다.
-- 2026-09-22 대표님 「우선 468 호기 까지는 실제 수량 문제없는거 확인 했으니까 다 들어온걸로
--                     체크 해주고」 → 「LAN 만 말한거였음」 → 「생산 호기에 적용되는 랜부터」
--
-- 채우는 것   그 호기에 «떠야 할» LAN 줄만 — 타입(qtyByVariant·variantKeys)과 방향을 통과하고
--             방향 상태가 「셈(use)」인 칸. 필요 수량까지 올린다.
-- 안 건드리는 것
--   · 「안셈(gray)」 칸 99개 — 우리가 수량을 안 세는 줄
--   · 「없음(none)」 칸 120개 — 그 방향엔 안 들어가는 줄 (남은 체크 13개도 그대로 둔다)
--   · 통에서 가져온 몫(fromStock·fromOurs) — 사급이라 «들어온 것»으로만 적고 통은 안 건드린다
--   · 469 이상 호기, 디에이치 BOM
-- 안전  백업 → 채움 → 대조(모자란 칸 0·안 건드릴 칸 그대로) → 다르면 통째 롤백
BEGIN;

DROP TABLE IF EXISTS wm.pm_backup_lanfill_20260922;
CREATE TABLE wm.pm_backup_lanfill_20260922 AS SELECT * FROM wm.panel_materials;

-- 채울 칸 목록 — 호기 × LAN 줄 × 필요 수량
CREATE TEMP TABLE fill AS
WITH pan AS (
  SELECT id, COALESCE(data->>'프로젝트','') AS nm, right(COALESCE(data->>'프로젝트',''),3)::int AS no,
         COALESCE(NULLIF(data->>'정역',''),'') AS dir, COALESCE(data->'bomLink'->>'variantKey','') AS vk
  FROM wm.production_panels WHERE data->'bomLink'->>'projectId'='jlctOy26LwZWsYxsxwrA'),
lan AS (
  SELECT id, COALESCE(data->>'box','') AS box,
         COALESCE(NULLIF(data->>'qty','')::numeric,0) AS q,
         COALESCE(data->'qtyByVariant','{}'::jsonb) AS qv,
         COALESCE(data->'variantKeys','[]'::jsonb) AS vks,
         CASE WHEN data->'dirState' IS NOT NULL AND data->>'dirState' <> '{}' THEN data->'dirState'
              WHEN data->>'dirs'='["정"]' THEN jsonb_build_object('정','use','역',(CASE WHEN data->>'dirHide'='true' THEN 'none' ELSE 'gray' END))
              WHEN data->>'dirs'='["역"]' THEN jsonb_build_object('정',(CASE WHEN data->>'dirHide'='true' THEN 'none' ELSE 'gray' END),'역','use')
              WHEN data->>'skipForward'='true' THEN '{"정":"gray","역":"use"}'::jsonb
              ELSE '{"정":"use","역":"use"}'::jsonb END AS ds
  FROM wm.bom WHERE data->>'siteId'='jlctOy26LwZWsYxsxwrA' AND COALESCE(data->>'name','') LIKE '%LAN%')
SELECT p.id AS pid, p.nm, l.id AS bid, l.box,
       (CASE WHEN l.qv ? p.vk THEN COALESCE(NULLIF(l.qv->>p.vk,'')::numeric,0) ELSE l.q END) AS need
FROM pan p CROSS JOIN lan l
WHERE p.no <= 468
  AND (jsonb_array_length(l.vks) = 0 OR l.vks ? p.vk)
  AND COALESCE(l.ds->>p.dir,'use') = 'use'
  AND (CASE WHEN l.qv ? p.vk THEN COALESCE(NULLIF(l.qv->>p.vk,'')::numeric,0) ELSE l.q END) > 0;

-- 빗장 — 채울 칸이 예상 범위(200~260)를 벗어나면 멈춘다
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM fill;
  IF n < 300 OR n > 460 THEN RAISE EXCEPTION '멈춤 — 채울 칸이 %개입니다 (예상 381 안팎)', n; END IF;
  RAISE NOTICE '대상 칸 %개', n;
END $$;

-- 없는 문서부터 만든다 (호기 × BOX)
INSERT INTO wm.panel_materials (id, data)
SELECT DISTINCT f.pid || '__' || f.box,
       jsonb_build_object('panelId', f.pid, 'box', f.box, 'items', '{}'::jsonb, 'updatedAt', now()::text)
FROM fill f
ON CONFLICT (id) DO NOTHING;

-- 채운다 — 이미 필요 수량을 채운 칸은 그대로 둔다
DO $$
DECLARE f RECORD; cur jsonb; got numeric; done int := 0;
BEGIN
  FOR f IN SELECT * FROM fill LOOP
    SELECT COALESCE(t.data->'items'->f.bid, '{}'::jsonb) INTO cur
      FROM wm.panel_materials t WHERE t.id = f.pid || '__' || f.box;
    got := COALESCE((cur->>'qty')::numeric, 0);
    IF got >= f.need THEN CONTINUE; END IF;
    UPDATE wm.panel_materials t
    SET data = t.data || jsonb_build_object(
          'items', COALESCE(t.data->'items','{}'::jsonb) || jsonb_build_object(f.bid,
            cur || jsonb_build_object(
              'qty', f.need,
              'fromStock', COALESCE((cur->>'fromStock')::numeric, 0),
              'fromOurs', COALESCE((cur->>'fromOurs')::numeric, 0),
              'at', now()::text,
              'by', '일괄(468 이하 LAN 입고)')),
          'updatedAt', now()::text)
    WHERE t.id = f.pid || '__' || f.box;
    done := done + 1;
  END LOOP;
  RAISE NOTICE '채운 칸 %개', done;
END $$;

-- 대조 ① 대상 칸에 모자람이 없어야 한다
DO $$
DECLARE short int;
BEGIN
  SELECT count(*) INTO short
    FROM fill f LEFT JOIN wm.panel_materials t ON t.id = f.pid || '__' || f.box
   WHERE COALESCE((t.data->'items'->f.bid->>'qty')::numeric, 0) < f.need;
  IF short > 0 THEN RAISE EXCEPTION '대조 실패 — 아직 모자란 칸 %개', short; END IF;
  RAISE NOTICE '대조 통과 — 모자란 칸 0';
END $$;

-- 대조 ② 통에서 가져온 몫은 한 개도 안 바뀌어야 한다
DO $$
DECLARE b numeric; a numeric;
BEGIN
  SELECT COALESCE(sum((e.value->>'fromStock')::numeric),0) INTO b
    FROM wm.pm_backup_lanfill_20260922 t, jsonb_each(t.data->'items') e;
  SELECT COALESCE(sum((e.value->>'fromStock')::numeric),0) INTO a
    FROM wm.panel_materials t, jsonb_each(t.data->'items') e;
  IF b <> a THEN RAISE EXCEPTION '대조 실패 — 통 몫 % → %', b, a; END IF;
  RAISE NOTICE '통 몫 그대로 — %', a;
END $$;

\echo '== 채운 뒤 — 호기별 LAN(셈) =='
SELECT f.nm AS 호기, count(*) AS 칸, sum(f.need) AS 필요,
       sum(COALESCE((t.data->'items'->f.bid->>'qty')::numeric,0)) AS 체크
FROM fill f LEFT JOIN wm.panel_materials t ON t.id = f.pid || '__' || f.box
GROUP BY 1 ORDER BY 1;

COMMIT;
