-- 메티스 273~468 호기(15대)의 LAN 을 「다 들어온 것」으로 채우고, 「없음」에 남은 체크는 지운다.
-- 2026-09-22 대표님 「273~468 까지 랜 채우고 없음은 숨김처리까지」
--
-- ① 채움  그 호기에 «떠야 할» LAN 줄(타입·방향 통과, 방향이 「셈」)을 필요 수량까지. 112칸
-- ② 지움  방향이 「없음」인데 체크가 남은 칸 6개(전부 LAN 5000MM · 역방향). 화면에서 숨겨져
--         어디에도 안 보이는 수량이라 그대로 두면 사급 통 장부와 어긋난다.
--         통에서 가져온 4개는 사급 통으로 되돌린다.
-- 안 건드림  「안셈(gray)」 칸 · 272 이하·469 이상 호기 · 디에이치 BOM
--
-- ※ 문서 id 는 앱과 같은 규칙으로 만든다 — BOX 의 「/」를 「∕」로 바꾼다
--   (services/panelMaterialsService.js materialsDocId). 안 바꾸면 「H/T BOX 상」이
--   엉뚱한 문서로 들어가 화면에 안 보이는 유령 기록이 된다.
-- 안전  백업 → 처리 → 대조 → 다르면 통째 롤백
BEGIN;

DROP TABLE IF EXISTS wm.pm_backup_lan273_20260922;
CREATE TABLE wm.pm_backup_lan273_20260922 AS SELECT * FROM wm.panel_materials;
DROP TABLE IF EXISTS wm.fs_backup_lan273_20260922;
CREATE TABLE wm.fs_backup_lan273_20260922 AS SELECT * FROM wm.free_stock;

CREATE TEMP TABLE cell AS
WITH pan AS (
  SELECT id, COALESCE(data->>'프로젝트','') AS nm, right(COALESCE(data->>'프로젝트',''),3)::int AS no,
         COALESCE(NULLIF(data->>'정역',''),'') AS dir, COALESCE(data->'bomLink'->>'variantKey','') AS vk
  FROM wm.production_panels WHERE data->'bomLink'->>'projectId'='jlctOy26LwZWsYxsxwrA'),
lan AS (
  SELECT id, COALESCE(data->>'spec','') AS sp, COALESCE(data->>'box','') AS box,
         COALESCE(data->>'itemId','') AS iid,
         COALESCE(NULLIF(data->>'qty','')::numeric,0) AS q,
         COALESCE(data->'qtyByVariant','{}'::jsonb) AS qv, COALESCE(data->'variantKeys','[]'::jsonb) AS vks,
         CASE WHEN data->'dirState' IS NOT NULL AND data->>'dirState' <> '{}' THEN data->'dirState'
              WHEN data->>'dirs'='["정"]' THEN jsonb_build_object('정','use','역',(CASE WHEN data->>'dirHide'='true' THEN 'none' ELSE 'gray' END))
              WHEN data->>'dirs'='["역"]' THEN jsonb_build_object('정',(CASE WHEN data->>'dirHide'='true' THEN 'none' ELSE 'gray' END),'역','use')
              WHEN data->>'skipForward'='true' THEN '{"정":"gray","역":"use"}'::jsonb
              ELSE '{"정":"use","역":"use"}'::jsonb END AS ds
  FROM wm.bom WHERE data->>'siteId'='jlctOy26LwZWsYxsxwrA' AND COALESCE(data->>'name','') LIKE '%LAN%')
SELECT p.id AS pid, p.nm, l.id AS bid, l.sp, l.box, l.iid,
       p.id || '__' || replace(l.box, '/', '∕') AS docid,
       COALESCE(l.ds->>p.dir,'use') AS st,
       (CASE WHEN l.qv ? p.vk THEN COALESCE(NULLIF(l.qv->>p.vk,'')::numeric,0) ELSE l.q END) AS need
FROM pan p CROSS JOIN lan l
WHERE p.no BETWEEN 273 AND 468 AND (jsonb_array_length(l.vks)=0 OR l.vks ? p.vk);

-- 빗장 — 채울 칸·지울 칸이 예상과 다르면 멈춘다
DO $$
DECLARE f int; c int;
BEGIN
  SELECT count(*) INTO f FROM cell c2
    LEFT JOIN wm.panel_materials t ON t.id = c2.docid
   WHERE c2.st='use' AND c2.need > 0
     AND COALESCE((t.data->'items'->c2.bid->>'qty')::numeric,0) < c2.need;
  SELECT count(*) INTO c FROM cell c2
    JOIN wm.panel_materials t ON t.id = c2.docid
   WHERE c2.st='none' AND COALESCE((t.data->'items'->c2.bid->>'qty')::numeric,0) > 0;
  IF f <> 112 THEN RAISE EXCEPTION '멈춤 — 채울 칸이 %개입니다 (예상 112)', f; END IF;
  IF c <> 6 THEN RAISE EXCEPTION '멈춤 — 지울 칸이 %개입니다 (예상 6)', c; END IF;
  RAISE NOTICE '채울 칸 % · 지울 칸 %', f, c;
END $$;

-- 없는 문서부터
INSERT INTO wm.panel_materials (id, data)
SELECT DISTINCT c.docid, jsonb_build_object('panelId', c.pid, 'box', c.box, 'items', '{}'::jsonb, 'updatedAt', now()::text)
FROM cell c WHERE c.st='use' AND c.need > 0
ON CONFLICT (id) DO NOTHING;

-- ① 채움
DO $$
DECLARE f RECORD; cur jsonb; got numeric; n int := 0; today text := to_char(now(),'YYYY-MM-DD');
BEGIN
  FOR f IN SELECT * FROM cell WHERE st='use' AND need > 0 LOOP
    SELECT COALESCE(t.data->'items'->f.bid,'{}'::jsonb) INTO cur FROM wm.panel_materials t WHERE t.id=f.docid;
    got := COALESCE((cur->>'qty')::numeric, 0);
    IF got >= f.need THEN CONTINUE; END IF;
    UPDATE wm.panel_materials t
    SET data = t.data || jsonb_build_object(
          'items', COALESCE(t.data->'items','{}'::jsonb) || jsonb_build_object(f.bid,
            cur || jsonb_build_object('qty', f.need, 'at', today, 'by', '일괄(273~468 LAN 입고)')),
          'updatedAt', now()::text)
    WHERE t.id = f.docid;
    n := n + 1;
  END LOOP;
  RAISE NOTICE '채운 칸 %개', n;
END $$;

-- ② 「없음」에 남은 체크를 지우고, 통에서 가져온 몫은 사급 통으로 되돌린다
CREATE TEMP TABLE back AS
SELECT c.docid, c.bid, c.iid, c.nm,
       COALESCE((t.data->'items'->c.bid->>'fromStock')::numeric,0) AS fs
FROM cell c JOIN wm.panel_materials t ON t.id=c.docid
WHERE c.st='none' AND COALESCE((t.data->'items'->c.bid->>'qty')::numeric,0) > 0;

DO $$
DECLARE b RECORD; cur jsonb; n int := 0; today text := to_char(now(),'YYYY-MM-DD');
BEGIN
  FOR b IN SELECT * FROM back LOOP
    SELECT COALESCE(t.data->'items'->b.bid,'{}'::jsonb) INTO cur FROM wm.panel_materials t WHERE t.id=b.docid;
    UPDATE wm.panel_materials t
    SET data = t.data || jsonb_build_object(
          'items', COALESCE(t.data->'items','{}'::jsonb) || jsonb_build_object(b.bid,
            cur || jsonb_build_object('qty', 0, 'fromStock', 0, 'fromOurs', 0,
                                      'at', today, 'by', '일괄(없음 줄 정리)')),
          'updatedAt', now()::text)
    WHERE t.id = b.docid;
    n := n + 1;
  END LOOP;
  RAISE NOTICE '지운 칸 %개', n;
END $$;

-- 통 되돌림 — 품목별로 합쳐 한 번에
DO $$
DECLARE r RECORD; ret numeric := 0;
BEGIN
  FOR r IN SELECT iid, sum(fs) AS n FROM back WHERE fs > 0 GROUP BY 1 LOOP
    UPDATE wm.free_stock s
    SET data = s.data || jsonb_build_object(
          'qty', COALESCE((s.data->>'qty')::numeric,0) + r.n,
          'log', COALESCE(s.data->'log','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                   'n', r.n, 'at', now()::text, 'by', 'IOPN', 'kind', 'in',
                   'note', '없음 줄 정리 되돌림 (273~468 LAN)')),
          'updatedAt', now()::text, 'updatedBy', 'IOPN')
    WHERE s.id = '메티스__' || r.iid;
    ret := ret + r.n;
  END LOOP;
  RAISE NOTICE '통으로 되돌린 수량 %', ret;
END $$;

-- 대조 ① 채울 곳에 모자람이 없어야 한다
DO $$
DECLARE short int;
BEGIN
  SELECT count(*) INTO short FROM cell c LEFT JOIN wm.panel_materials t ON t.id=c.docid
   WHERE c.st='use' AND c.need > 0 AND COALESCE((t.data->'items'->c.bid->>'qty')::numeric,0) < c.need;
  IF short > 0 THEN RAISE EXCEPTION '대조 실패 — 아직 모자란 칸 %개', short; END IF;
END $$;

-- 대조 ② 「없음」 칸에 체크가 남아 있으면 안 된다
DO $$
DECLARE left_n int;
BEGIN
  SELECT count(*) INTO left_n FROM cell c JOIN wm.panel_materials t ON t.id=c.docid
   WHERE c.st='none' AND COALESCE((t.data->'items'->c.bid->>'qty')::numeric,0) > 0;
  IF left_n > 0 THEN RAISE EXCEPTION '대조 실패 — 「없음」에 체크가 %개 남음', left_n; END IF;
END $$;

-- 대조 ③ 통은 되돌린 만큼만 늘어야 한다
DO $$
DECLARE b numeric; a numeric; expect numeric;
BEGIN
  SELECT COALESCE(sum((data->>'qty')::numeric),0) INTO b FROM wm.fs_backup_lan273_20260922;
  SELECT COALESCE(sum((data->>'qty')::numeric),0) INTO a FROM wm.free_stock;
  SELECT COALESCE(sum(fs),0) INTO expect FROM back;
  IF a - b <> expect THEN RAISE EXCEPTION '대조 실패 — 통 % → % (되돌릴 몫 %)', b, a, expect; END IF;
  RAISE NOTICE '통 대조 통과 — % 만큼 늘었다', expect;
END $$;

\echo '== 마무리 — 호기별 LAN(셈) =='
SELECT c.nm AS 호기, count(*) AS 칸, sum(c.need) AS 필요,
       sum(COALESCE((t.data->'items'->c.bid->>'qty')::numeric,0)) AS 체크
FROM cell c LEFT JOIN wm.panel_materials t ON t.id=c.docid
WHERE c.st='use' AND c.need > 0
GROUP BY 1 ORDER BY 1;

COMMIT;
