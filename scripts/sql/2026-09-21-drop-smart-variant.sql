-- 「스마트」 타입 삭제 (메티스에만 있고, 쓰는 줄 0·지정된 호기 0 인 빈 타입).
-- 2026-09-21 대표님 「스마트 타입은 메티스디에이치 둘다 우선 삭제해줘」
BEGIN;

DROP TABLE IF EXISTS wm.bom_projects_backup_smart_20260921;
CREATE TABLE wm.bom_projects_backup_smart_20260921 AS SELECT * FROM wm.bom_projects;

-- 혹시 남아 있을 자취까지 — 타입별 수량·옛 타입 체크에서 그 열쇠를 뺀다
UPDATE wm.bom
SET data = data || jsonb_build_object('qtyByVariant', (data->'qtyByVariant') - 'vmu4rooe7')
WHERE data->'qtyByVariant' ? 'vmu4rooe7';

UPDATE wm.bom
SET data = data || jsonb_build_object('variantKeys',
      COALESCE((SELECT jsonb_agg(k) FROM jsonb_array_elements_text(data->'variantKeys') k WHERE k <> 'vmu4rooe7'), '[]'::jsonb))
WHERE data->'variantKeys' ? 'vmu4rooe7';

-- 타입 목록에서 제거
UPDATE wm.bom_projects
SET data = data
  || jsonb_build_object('variants',
       COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(data->'variants') e WHERE e->>'key' <> 'vmu4rooe7'), '[]'::jsonb))
  || jsonb_build_object('updatedAt', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
WHERE data->'variants' @> '[{"key":"vmu4rooe7"}]'::jsonb;

-- 그 타입으로 지정된 호기가 있으면 타입을 비운다(없어야 정상)
UPDATE wm.production_panels
SET data = jsonb_set(data, '{bomLink,variantKey}', '""'::jsonb)
WHERE data->'bomLink'->>'variantKey' = 'vmu4rooe7';

SELECT id, data->>'name' AS bom, data->'variants' AS 남은타입 FROM wm.bom_projects
WHERE id IN ('jlctOy26LwZWsYxsxwrA','DD6L7iqAgW9ENBmKUOEI');

COMMIT;
