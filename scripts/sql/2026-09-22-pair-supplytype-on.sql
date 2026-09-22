-- 짝 BOM 이 「구분」(도급·사급·판금)도 함께 걸게 켠다.
-- 2026-09-22 대표님 「판금으로 넣은게 전부 도급으로 들어갔네 옮겨서 맞춰」
-- 꺼져 있어서 한쪽에서 판금으로 바꿔도 다른 쪽은 도급으로 남아 132줄이 어긋나 있었다.
BEGIN;
UPDATE wm.bom_projects
SET data = jsonb_set(data, '{pair,sync,supplyType}', 'true'::jsonb)
WHERE id IN ('jlctOy26LwZWsYxsxwrA','DD6L7iqAgW9ENBmKUOEI')
  AND data->'pair'->'sync' IS NOT NULL;

SELECT data->>'name' AS 이름, data->'pair'->'sync' AS 짝설정
FROM wm.bom_projects WHERE id IN ('jlctOy26LwZWsYxsxwrA','DD6L7iqAgW9ENBmKUOEI');
COMMIT;
