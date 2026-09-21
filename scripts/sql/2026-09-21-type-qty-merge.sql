-- 타입별 수량 이전 — 같은 품목·BOX 에 타입만 다른 줄들을 한 줄로 합친다.
-- 2026-09-21 대표님 「타입별 실행 지금 ㄱㄱ」 · 「공통이 없는건 우선 기본값을 비우고」
--
-- 규칙   타입별 합계 = 공통 줄 + 그 타입 전용 줄  (지금 호기가 «두 줄 다» 보는 것과 같게)
--        공통 줄이 없으면 기본은 0 — 타입을 안 정한 호기에는 그 줄이 안 뜬다
-- 안전   ① 먼저 통째로 백업 ② 호기 기록을 남는 줄로 합쳐 옮김 ③ 전·후 합이 다르면 통째로 되돌림
--        되돌리려면:  BEGIN; DELETE FROM wm.bom; INSERT INTO wm.bom SELECT * FROM wm.bom_backup_20260921;
--                     DELETE FROM wm.panel_materials; INSERT INTO wm.panel_materials SELECT * FROM wm.panel_materials_backup_20260921; COMMIT;
BEGIN;

DROP TABLE IF EXISTS wm.bom_backup_20260921;
DROP TABLE IF EXISTS wm.panel_materials_backup_20260921;
CREATE TABLE wm.bom_backup_20260921 AS SELECT * FROM wm.bom;
CREATE TABLE wm.panel_materials_backup_20260921 AS SELECT * FROM wm.panel_materials;

CREATE TEMP TABLE rows0 AS
SELECT b.id,
       b.data->>'siteId' AS pid,
       COALESCE(NULLIF(b.data->>'itemId',''), (b.data->>'name')||'|'||(b.data->>'spec')) AS k,
       b.data->>'box' AS box,
       COALESCE(b.data->>'name','') AS name,
       COALESCE((b.data->>'qty')::numeric,0) AS qty,
       COALESCE(b.data->>'note','') AS note,
       CASE WHEN COALESCE(jsonb_array_length(b.data->'variantKeys'),0)=0 THEN 0 ELSE 1 END AS is_variant,
       CASE WHEN COALESCE(jsonb_array_length(b.data->'variantKeys'),0)=0 THEN NULL
            ELSE b.data->'variantKeys'->>0 END AS vkey,
       COALESCE((b.data->>'order')::numeric,0) AS ord
FROM wm.bom b;

CREATE TEMP TABLE grp AS
SELECT pid,k,box FROM rows0 GROUP BY pid,k,box HAVING count(*) > 1;

CREATE TEMP TABLE gr AS
SELECT r.* FROM rows0 r JOIN grp g ON g.pid=r.pid AND g.k=r.k AND g.box=r.box;

-- 남길 줄 — 공통 줄이 있으면 그것, 없으면 순서가 앞선 것
CREATE TEMP TABLE keep AS
SELECT DISTINCT ON (pid,k,box) pid,k,box, id AS keep_id, name AS keep_name
FROM gr ORDER BY pid,k,box,is_variant,ord,id;

CREATE TEMP TABLE basec AS
SELECT pid,k,box, COALESCE(sum(qty) FILTER (WHERE vkey IS NULL),0) AS c
FROM gr GROUP BY pid,k,box;

CREATE TEMP TABLE vsum AS
SELECT pid,k,box,vkey, sum(qty) AS q FROM gr WHERE vkey IS NOT NULL GROUP BY pid,k,box,vkey;

CREATE TEMP TABLE vq AS
SELECT v.pid,v.k,v.box, jsonb_object_agg(v.vkey, to_jsonb(b.c + v.q)) AS byv
FROM vsum v JOIN basec b ON b.pid=v.pid AND b.k=v.k AND b.box=v.box
GROUP BY v.pid,v.k,v.box;

-- 비고는 이어 붙이고, 사라지는 줄의 «다른 이름»도 잃지 않게 적어 둔다
CREATE TEMP TABLE notes AS
SELECT g.pid,g.k,g.box,
       NULLIF(concat_ws(' · ',
         (SELECT string_agg(DISTINCT NULLIF(x.note,''), ' · ') FROM gr x WHERE x.pid=g.pid AND x.k=g.k AND x.box=g.box),
         (SELECT string_agg(DISTINCT '옛 이름: '||x.name, ' · ') FROM gr x JOIN keep kk ON kk.pid=x.pid AND kk.k=x.k AND kk.box=x.box
           WHERE x.pid=g.pid AND x.k=g.k AND x.box=g.box AND x.name <> kk.keep_name)
       ), '') AS note
FROM grp g;

CREATE TEMP TABLE moves AS
SELECT g.id AS dead_id, kp.keep_id
FROM gr g JOIN keep kp ON kp.pid=g.pid AND kp.k=g.k AND kp.box=g.box
WHERE g.id <> kp.keep_id;

-- ⓪ 짝이 없어 혼자 있는 «타입 전용 줄»도 새 모양으로 — 합치는 것이 아니라 모양만 바꾼다.
--    (Relay MP 4개 M7H, SWITCH MP 1개 … 규격이 달라 서로 짝이 아닌 별개 품목들)
--    줄이 사라지지 않으므로 호기 체크 기록은 그 자리에 그대로 있다.
UPDATE wm.bom b
SET data = b.data
  || jsonb_build_object('qty', 0)
  || jsonb_build_object('qtyByVariant',
       (SELECT jsonb_object_agg(kk, to_jsonb(COALESCE((b.data->>'qty')::numeric,0)))
          FROM jsonb_array_elements_text(b.data->'variantKeys') kk))
  || jsonb_build_object('variantKeys', '[]'::jsonb)
  || jsonb_build_object('updatedAt', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
WHERE COALESCE(jsonb_array_length(b.data->'variantKeys'),0) > 0
  AND b.id NOT IN (SELECT id FROM gr);

-- ① 남는 줄에 기본 수량 + 타입별 예외를 적는다 (타입 전용 표시는 지운다)
UPDATE wm.bom b
SET data = b.data
  || jsonb_build_object('qty', bs.c)
  || jsonb_build_object('qtyByVariant', COALESCE(v.byv, '{}'::jsonb))
  || jsonb_build_object('variantKeys', '[]'::jsonb)
  || CASE WHEN n.note IS NOT NULL THEN jsonb_build_object('note', n.note) ELSE '{}'::jsonb END
  || jsonb_build_object('updatedAt', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
FROM keep kp
  JOIN basec bs ON bs.pid=kp.pid AND bs.k=kp.k AND bs.box=kp.box
  LEFT JOIN vq v ON v.pid=kp.pid AND v.k=kp.k AND v.box=kp.box
  LEFT JOIN notes n ON n.pid=kp.pid AND n.k=kp.k AND n.box=kp.box
WHERE b.id = kp.keep_id;

-- ② 호기 체크 기록을 남는 줄로 합쳐 옮긴다 (수량·통 몫·당사 몫은 더하고, 이력·사건·비고는 이어 붙인다)
DO $$
DECLARE d RECORD; m RECORD; items jsonb; dead jsonb; kept jsonb; merged jsonb; touched boolean;
BEGIN
  FOR d IN SELECT id, data FROM wm.panel_materials LOOP
    items := COALESCE(d.data->'items','{}'::jsonb);
    touched := false;
    FOR m IN SELECT * FROM moves LOOP
      IF items ? m.dead_id THEN
        dead := items->m.dead_id;
        kept := COALESCE(items->m.keep_id, '{}'::jsonb);
        merged := jsonb_strip_nulls(jsonb_build_object(
          'qty',       COALESCE((kept->>'qty')::numeric,0) + COALESCE((dead->>'qty')::numeric,0),
          'fromStock', COALESCE((kept->>'fromStock')::numeric,0) + COALESCE((dead->>'fromStock')::numeric,0),
          'fromOurs',  COALESCE((kept->>'fromOurs')::numeric,0) + COALESCE((dead->>'fromOurs')::numeric,0),
          'log',       COALESCE(kept->'log','[]'::jsonb) || COALESCE(dead->'log','[]'::jsonb),
          'incidents', COALESCE(kept->'incidents','[]'::jsonb) || COALESCE(dead->'incidents','[]'::jsonb),
          'at',        NULLIF(GREATEST(COALESCE(kept->>'at',''), COALESCE(dead->>'at','')),''),
          'by',        CASE WHEN COALESCE(kept->>'at','') >= COALESCE(dead->>'at','') THEN kept->>'by' ELSE dead->>'by' END,
          'note',      NULLIF(concat_ws(' · ', NULLIF(kept->>'note',''), NULLIF(dead->>'note','')),''),
          'skip',      (COALESCE((kept->>'skip')::boolean,false) AND COALESCE((dead->>'skip')::boolean,false))
        ));
        items := (items - m.dead_id) || jsonb_build_object(m.keep_id, merged);
        touched := true;
      END IF;
    END LOOP;
    IF touched THEN
      UPDATE wm.panel_materials SET data = d.data || jsonb_build_object('items', items) WHERE id = d.id;
    END IF;
  END LOOP;
END $$;

-- ③ 합쳐진 줄을 지운다
DELETE FROM wm.bom WHERE id IN (SELECT dead_id FROM moves);

-- ④ 이 BOM 들에 이전 시각을 적는다 — 이전 «전» 수정 이력은 화면에서 되돌리기가 잠긴다
UPDATE wm.bom_projects
SET data = data || jsonb_build_object('qtyMigratedAt', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
WHERE id IN (SELECT DISTINCT pid FROM grp);

-- ⑤ 대조 — 하나라도 다르면 통째로 되돌린다
DO $$
DECLARE b_qty numeric; a_qty numeric; b_fs numeric; a_fs numeric; b_log bigint; a_log bigint; b_note bigint; a_note bigint;
BEGIN
  SELECT COALESCE(sum((e.value->>'qty')::numeric),0),
         COALESCE(sum((e.value->>'fromStock')::numeric),0),
         COALESCE(sum(jsonb_array_length(COALESCE(e.value->'log','[]'::jsonb))),0),
         COALESCE(count(*) FILTER (WHERE COALESCE(e.value->>'note','') <> ''),0)
    INTO b_qty, b_fs, b_log, b_note
    FROM wm.panel_materials_backup_20260921 t, jsonb_each(t.data->'items') e
   WHERE e.key IN (SELECT id FROM gr);

  SELECT COALESCE(sum((e.value->>'qty')::numeric),0),
         COALESCE(sum((e.value->>'fromStock')::numeric),0),
         COALESCE(sum(jsonb_array_length(COALESCE(e.value->'log','[]'::jsonb))),0),
         COALESCE(count(*) FILTER (WHERE COALESCE(e.value->>'note','') <> ''),0)
    INTO a_qty, a_fs, a_log, a_note
    FROM wm.panel_materials t, jsonb_each(t.data->'items') e
   WHERE e.key IN (SELECT keep_id FROM keep);

  IF b_qty <> a_qty OR b_fs <> a_fs OR b_log <> a_log OR b_note <> a_note THEN
    RAISE EXCEPTION '대조 실패 — 체크 % → %, 통몫 % → %, 이력 % → %, 비고 % → %', b_qty, a_qty, b_fs, a_fs, b_log, a_log, b_note, a_note;
  END IF;
  RAISE NOTICE '대조 통과 — 체크 %, 통몫 %, 이력 %, 비고 %', a_qty, a_fs, a_log, a_note;
END $$;

SELECT '합친 묶음' AS what, count(*)::text AS v FROM grp
UNION ALL SELECT '지운 줄', count(*)::text FROM moves
UNION ALL SELECT '남은 BOM 줄', count(*)::text FROM wm.bom
UNION ALL SELECT '아직 옛 모양(타입 전용) 줄', count(*)::text FROM wm.bom
  WHERE COALESCE(jsonb_array_length(data->'variantKeys'),0) > 0;

COMMIT;
