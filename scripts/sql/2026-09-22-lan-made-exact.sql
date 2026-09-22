-- 대표님이 준 «호기 나열 순서»대로 LAN·판금을 초과·부족 없이 맞춘다.
-- 2026-09-22 대표님 「273 275 165 167 185 187 205 207 209 283 289 465 467 순서인데
--                     랜선은 468까지 판금은 467까지 초과 부족 수량 없이 해줘」
--
-- 앞서 나는 «호기 번호 273~468» 로 잘못 읽어 298·299·300·301·302·303·330·331 을 건드렸다.
-- 그 8대는 먼저 되돌린다.
--
-- LAN  273 275 165 167 185 187 205 207 209 283 289 465 467 468  (14대)
-- 판금 273 275 165 167 185 187 205 207 209 283 289 465 467      (13대, 468 뺀다)
-- 맞추는 값  그 호기에 «떠야 할» 줄(타입·방향 통과, 방향이 「셈」)의 필요 수량과 똑같이.
--            모자라면 올리고 넘치면 내린다. 「안셈」·「없음」 줄은 안 건드린다.
-- 통  사급 통 잔량은 안 건드린다 — LAN 통은 실제로 비어 있고, 통에 없던 것을 「통에서」로
--     적어 둔 기록이라 되돌리면 장부가 실물보다 늘어난다 (대표님 「재고도 없고」).
--     fromStock 은 필요 수량을 넘지 않게만 줄인다.
-- 안전  백업 → 되돌림·맞춤 → 대조(초과 0·부족 0) → 다르면 통째 롤백
BEGIN;

DROP TABLE IF EXISTS wm.pm_backup_exact_20260922;
CREATE TABLE wm.pm_backup_exact_20260922 AS SELECT * FROM wm.panel_materials;

-- ── ① 잘못 건드린 8대의 LAN 줄을 «채우기 전» 상태로 되돌린다 ──
DO $$
DECLARE r RECORD; old jsonb; n int := 0;
BEGIN
  FOR r IN
    SELECT t.id AS docid, e.key AS bid
    FROM wm.panel_materials t, LATERAL jsonb_each(COALESCE(t.data->'items','{}'::jsonb)) e
    WHERE t.data->>'panelId' IN (
            SELECT id FROM wm.production_panels
             WHERE right(COALESCE(data->>'프로젝트',''),3) IN ('298','299','300','301','302','303','330','331')
               AND data->'bomLink'->>'projectId'='jlctOy26LwZWsYxsxwrA')
      AND e.key IN (SELECT id FROM wm.bom
                     WHERE data->>'siteId'='jlctOy26LwZWsYxsxwrA' AND COALESCE(data->>'name','') LIKE '%LAN%')
  LOOP
    SELECT b.data->'items'->r.bid INTO old FROM wm.pm_backup_lan273_20260922 b WHERE b.id = r.docid;
    UPDATE wm.panel_materials t
    SET data = t.data || jsonb_build_object(
          'items', CASE WHEN old IS NULL
                        THEN (COALESCE(t.data->'items','{}'::jsonb) - r.bid)
                        ELSE COALESCE(t.data->'items','{}'::jsonb) || jsonb_build_object(r.bid, old) END,
          'updatedAt', now()::text)
    WHERE t.id = r.docid;
    n := n + 1;
  END LOOP;
  RAISE NOTICE '되돌린 칸 %개 (298·299·300·301·302·303·330·331)', n;
END $$;

-- ── ② 맞출 칸 목록 ──
CREATE TEMP TABLE cell AS
WITH pan AS (
  SELECT id, COALESCE(data->>'프로젝트','') AS nm, right(COALESCE(data->>'프로젝트',''),3) AS no3,
         COALESCE(NULLIF(data->>'정역',''),'') AS dir, COALESCE(data->'bomLink'->>'variantKey','') AS vk
  FROM wm.production_panels WHERE data->'bomLink'->>'projectId'='jlctOy26LwZWsYxsxwrA'),
src AS (
  SELECT id, COALESCE(data->>'box','') AS box,
         CASE WHEN COALESCE(data->>'name','') LIKE '%LAN%' THEN 'lan'
              WHEN data->>'supplyType' = 'made' THEN 'made' ELSE '' END AS kind,
         COALESCE(NULLIF(data->>'qty','')::numeric,0) AS q,
         COALESCE(data->'qtyByVariant','{}'::jsonb) AS qv, COALESCE(data->'variantKeys','[]'::jsonb) AS vks,
         CASE WHEN data->'dirState' IS NOT NULL AND data->>'dirState' <> '{}' THEN data->'dirState'
              WHEN data->>'dirs'='["정"]' THEN jsonb_build_object('정','use','역',(CASE WHEN data->>'dirHide'='true' THEN 'none' ELSE 'gray' END))
              WHEN data->>'dirs'='["역"]' THEN jsonb_build_object('정',(CASE WHEN data->>'dirHide'='true' THEN 'none' ELSE 'gray' END),'역','use')
              WHEN data->>'skipForward'='true' THEN '{"정":"gray","역":"use"}'::jsonb
              ELSE '{"정":"use","역":"use"}'::jsonb END AS ds
  FROM wm.bom WHERE data->>'siteId'='jlctOy26LwZWsYxsxwrA')
SELECT p.nm, p.no3, l.kind, l.id AS bid, l.box,
       p.id || '__' || replace(l.box,'/','∕') AS docid,
       (CASE WHEN l.qv ? p.vk THEN COALESCE(NULLIF(l.qv->>p.vk,'')::numeric,0) ELSE l.q END) AS need
FROM pan p JOIN src l ON l.kind <> ''
WHERE (jsonb_array_length(l.vks)=0 OR l.vks ? p.vk)
  AND COALESCE(l.ds->>p.dir,'use') = 'use'
  AND (CASE WHEN l.qv ? p.vk THEN COALESCE(NULLIF(l.qv->>p.vk,'')::numeric,0) ELSE l.q END) > 0
  AND (
    (l.kind='lan'  AND p.no3 IN ('273','275','165','167','185','187','205','207','209','283','289','465','467','468'))
 OR (l.kind='made' AND p.no3 IN ('273','275','165','167','185','187','205','207','209','283','289','465','467'))
  );

DO $$
DECLARE a int; b int;
BEGIN
  SELECT count(*) INTO a FROM cell WHERE kind='lan';
  SELECT count(*) INTO b FROM cell WHERE kind='made';
  RAISE NOTICE 'LAN 칸 % · 판금 칸 %', a, b;
  IF a = 0 OR b = 0 THEN RAISE EXCEPTION '멈춤 — 맞출 칸이 없습니다 (LAN % · 판금 %)', a, b; END IF;
END $$;

INSERT INTO wm.panel_materials (id, data)
SELECT DISTINCT c.docid,
       jsonb_build_object('panelId', split_part(c.docid,'__',1), 'box', c.box, 'items', '{}'::jsonb, 'updatedAt', now()::text)
FROM cell c
ON CONFLICT (id) DO NOTHING;

-- ── ③ 필요 수량과 똑같이 맞춘다 (모자라면 올리고 넘치면 내린다) ──
DO $$
DECLARE c RECORD; cur jsonb; got numeric; fs numeric; fo numeric;
        up int := 0; down int := 0; today text := to_char(now(),'YYYY-MM-DD');
BEGIN
  FOR c IN SELECT * FROM cell LOOP
    SELECT COALESCE(t.data->'items'->c.bid,'{}'::jsonb) INTO cur FROM wm.panel_materials t WHERE t.id=c.docid;
    got := COALESCE((cur->>'qty')::numeric, 0);
    IF got = c.need THEN CONTINUE; END IF;
    fs := LEAST(COALESCE((cur->>'fromStock')::numeric,0), c.need);
    fo := LEAST(COALESCE((cur->>'fromOurs')::numeric,0), fs);
    UPDATE wm.panel_materials t
    SET data = t.data || jsonb_build_object(
          'items', COALESCE(t.data->'items','{}'::jsonb) || jsonb_build_object(c.bid,
            cur || jsonb_build_object('qty', c.need, 'fromStock', fs, 'fromOurs', fo,
                                      'at', today, 'by', '일괄(' || c.kind || ' 수량 맞춤)')),
          'updatedAt', now()::text)
    WHERE t.id = c.docid;
    IF got < c.need THEN up := up + 1; ELSE down := down + 1; END IF;
  END LOOP;
  RAISE NOTICE '올린 칸 % · 내린 칸 %', up, down;
END $$;

-- 대조 — 맞춘 칸에 초과도 부족도 없어야 한다
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM cell c LEFT JOIN wm.panel_materials t ON t.id=c.docid
   WHERE COALESCE((t.data->'items'->c.bid->>'qty')::numeric,0) <> c.need;
  IF bad > 0 THEN RAISE EXCEPTION '대조 실패 — 안 맞는 칸 %개', bad; END IF;
  RAISE NOTICE '대조 통과 — 초과·부족 0';
END $$;

-- 대조 — 통 잔량은 안 바뀐다
DO $$
DECLARE b numeric; a numeric;
BEGIN
  SELECT COALESCE(sum((data->>'qty')::numeric),0) INTO b FROM wm.fs_backup_lan273_20260922;
  SELECT COALESCE(sum((data->>'qty')::numeric),0) INTO a FROM wm.free_stock;
  IF a <> b + 4 THEN RAISE EXCEPTION '대조 실패 — 통 % → % (앞선 되돌림 4 만 있어야 한다)', b, a; END IF;
END $$;

\echo '== 마무리 — 호기별 필요 vs 체크 =='
SELECT c.nm AS 호기, c.kind AS 갈래, count(*) AS 칸, sum(c.need) AS 필요,
       sum(COALESCE((t.data->'items'->c.bid->>'qty')::numeric,0)) AS 체크
FROM cell c LEFT JOIN wm.panel_materials t ON t.id=c.docid
GROUP BY 1,2 ORDER BY 2,1;

COMMIT;
