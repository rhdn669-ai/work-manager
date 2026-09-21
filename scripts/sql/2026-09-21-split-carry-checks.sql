-- 나누기로 옮긴 줄에 «체크해 둔 수량»을 뒤따라 옮긴다 (v159.8 이전에 나눈 건 보정).
-- 2026-09-21 대표님 「기존에 수량이 입고로 처리된게 나눠지면 그대로 수량을 가지고 넘어가야지」
--
-- 대상  메티스·디에이치 「IO 모듈」 NX-ECC201 — LOCAL(필요 2→1) → ROBOT(필요 1)
-- 규칙  남는 줄의 새 필요(1)를 먼저 채우고 넘치는 몫만, 옮긴 필요(1)까지만.
--       통에서 가져온 몫도 옮기는 개수만큼 따라간다.
-- 안전  백업 → 옮김 → 전·후 «체크 합·통 몫 합»이 다르면 통째로 되돌림
BEGIN;

DROP TABLE IF EXISTS wm.pm_backup_split_20260921;
CREATE TABLE wm.pm_backup_split_20260921 AS SELECT * FROM wm.panel_materials;

CREATE TEMP TABLE pair AS
SELECT s.id AS src_id, d.id AS dst_id, 'LOCAL'::text AS src_box, 'ROBOT'::text AS dst_box,
       1::numeric AS keep_need, 1::numeric AS move_need
FROM wm.bom s
JOIN wm.bom d
  ON d.data->>'siteId' = s.data->>'siteId'
 AND d.data->>'spec' = s.data->>'spec'
 AND d.data->>'box' = 'ROBOT'
WHERE s.data->>'spec' ILIKE '%ECC201%' AND s.data->>'box' = 'LOCAL';

DO $$
DECLARE pr RECORD; d RECORD; items jsonb; cur jsonb; dst jsonb; q numeric; n numeric;
        fs numeric; fo numeric; mfs numeric; mfo numeric; src_doc text; dst_doc text; moved int := 0;
BEGIN
  FOR pr IN SELECT * FROM pair LOOP
    FOR d IN SELECT id, data FROM wm.panel_materials WHERE data->>'box' = pr.src_box LOOP
      items := COALESCE(d.data->'items','{}'::jsonb);
      IF NOT (items ? pr.src_id) THEN CONTINUE; END IF;
      cur := items->pr.src_id;
      q  := COALESCE((cur->>'qty')::numeric, 0);
      n  := LEAST(GREATEST(q - pr.keep_need, 0), pr.move_need);
      IF n <= 0 THEN CONTINUE; END IF;
      fs := COALESCE((cur->>'fromStock')::numeric, 0);
      fo := COALESCE((cur->>'fromOurs')::numeric, 0);
      mfs := LEAST(fs, n);
      mfo := LEAST(fo, mfs);
      dst_doc := (d.data->>'panelId') || '__' || pr.dst_box;

      -- 받는 쪽 (없으면 문서를 새로 만든다)
      INSERT INTO wm.panel_materials (id, data)
      VALUES (dst_doc, jsonb_build_object('panelId', d.data->>'panelId', 'box', pr.dst_box,
                                          'items', '{}'::jsonb, 'updatedAt', now()::text))
      ON CONFLICT (id) DO NOTHING;

      SELECT COALESCE(t.data->'items'->pr.dst_id, '{}'::jsonb) INTO dst
        FROM wm.panel_materials t WHERE t.id = dst_doc;

      UPDATE wm.panel_materials t
      SET data = t.data || jsonb_build_object(
            'items', COALESCE(t.data->'items','{}'::jsonb) || jsonb_build_object(pr.dst_id,
              dst || jsonb_build_object(
                'qty',       COALESCE((dst->>'qty')::numeric,0) + n,
                'fromStock', COALESCE((dst->>'fromStock')::numeric,0) + mfs,
                'fromOurs',  COALESCE((dst->>'fromOurs')::numeric,0) + mfo,
                'at',        COALESCE(NULLIF(dst->>'at',''), cur->>'at', ''),
                'by',        COALESCE(NULLIF(dst->>'by',''), cur->>'by', ''))),
            'updatedAt', now()::text)
      WHERE t.id = dst_doc;

      -- 주는 쪽
      UPDATE wm.panel_materials t
      SET data = t.data || jsonb_build_object(
            'items', items || jsonb_build_object(pr.src_id,
              cur || jsonb_build_object('qty', q - n, 'fromStock', fs - mfs, 'fromOurs', fo - mfo)),
            'updatedAt', now()::text)
      WHERE t.id = d.id;

      moved := moved + 1;
    END LOOP;
  END LOOP;
  RAISE NOTICE '체크를 옮긴 호기 수: %', moved;
END $$;

-- 대조 — 그 두 줄의 체크 합·통 몫 합은 그대로여야 한다
DO $$
DECLARE b_q numeric; a_q numeric; b_s numeric; a_s numeric;
BEGIN
  SELECT COALESCE(sum((e.value->>'qty')::numeric),0), COALESCE(sum((e.value->>'fromStock')::numeric),0)
    INTO b_q, b_s FROM wm.pm_backup_split_20260921 t, jsonb_each(t.data->'items') e
   WHERE e.key IN (SELECT src_id FROM pair UNION SELECT dst_id FROM pair);
  SELECT COALESCE(sum((e.value->>'qty')::numeric),0), COALESCE(sum((e.value->>'fromStock')::numeric),0)
    INTO a_q, a_s FROM wm.panel_materials t, jsonb_each(t.data->'items') e
   WHERE e.key IN (SELECT src_id FROM pair UNION SELECT dst_id FROM pair);
  IF b_q <> a_q OR b_s <> a_s THEN
    RAISE EXCEPTION '대조 실패 — 체크 % → %, 통몫 % → %', b_q, a_q, b_s, a_s;
  END IF;
  RAISE NOTICE '대조 통과 — 체크 %, 통몫 %', a_q, a_s;
END $$;

SELECT CASE t.data->>'box' WHEN 'LOCAL' THEN 'LOCAL(남은 줄)' ELSE 'ROBOT(옮긴 줄)' END AS 어디,
       count(*) AS 호기수, sum((e.value->>'qty')::numeric) AS "체크 합",
       sum((e.value->>'fromStock')::numeric) AS "통 몫"
FROM wm.panel_materials t, jsonb_each(t.data->'items') e
WHERE e.key IN (SELECT src_id FROM pair UNION SELECT dst_id FROM pair)
GROUP BY 1 ORDER BY 1;

COMMIT;
