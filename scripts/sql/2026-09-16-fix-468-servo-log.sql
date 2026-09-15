-- 468 호기 이력 정리 (2026-09-16) — 209 호기의 이력이 조회 버그(v150.3 에서 고침)로 468 줄에 복사됐다.
-- 전수 조회 결과 468 에 두 줄이 걸렸다:
--   L/D BOX · SERVO DRIVE 2R8AA0A (줄 sQAVnsUc7Ju8zPmLG1yv) → 「209가 가져감 1」(Lmu2tznorl8y8) 하나만 남긴다
--   S/D BOX · 줄 CJJwxI…                                    → 「209가 가져감 1」(Lmu2u3wgzs9sf) 하나만 남긴다
-- 209 호기 쪽은 손대지 않는다 (제 이력이 맞다).

update wm.panel_materials
   set data = jsonb_set(
     data,
     '{items,sQAVnsUc7Ju8zPmLG1yv,log}',
     coalesce(
       (select jsonb_agg(l)
          from jsonb_array_elements(data #> '{items,sQAVnsUc7Ju8zPmLG1yv,log}') l
         where l ->> 'id' = 'Lmu2tznorl8y8'),
       '[]'::jsonb
     )
   )
 where data ->> 'panelId' = 'Hoofbp52ZxhyZMq44L1h'
   and data ->> 'box' = 'L/D BOX';

update wm.panel_materials m
   set data = jsonb_set(
     data,
     array['items', k, 'log'],
     coalesce(
       (select jsonb_agg(l)
          from jsonb_array_elements(data #> array['items', k, 'log']) l
         where l ->> 'id' = 'Lmu2u3wgzs9sf'),
       '[]'::jsonb
     )
   )
  from (select e.key as k
          from wm.panel_materials x, jsonb_each(x.data -> 'items') e
         where x.data ->> 'panelId' = 'Hoofbp52ZxhyZMq44L1h'
           and x.data ->> 'box' = 'S/D BOX'
           and e.value -> 'log' @> '[{"id": "Lmu2u3wgzs9sf"}]') t
 where m.data ->> 'panelId' = 'Hoofbp52ZxhyZMq44L1h'
   and m.data ->> 'box' = 'S/D BOX';

-- 확인: 같은 이력 id 가 두 호기 이상에 있으면 아직 남은 것
with logs as (
  select m.data ->> 'panelId' as panel, l ->> 'id' as log_id
    from wm.panel_materials m, jsonb_each(m.data -> 'items') e, jsonb_array_elements(coalesce(e.value -> 'log', '[]'::jsonb)) l
)
select log_id, count(*) from logs group by log_id having count(*) > 1;
