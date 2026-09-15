-- 468 호기 · L/D BOX · SERVO DRIVE 2R8AA0A 줄의 이력 정리 (2026-09-16)
-- 209 호기의 이력 3줄이 조회 버그(v150.3 에서 고침)로 468 줄에 통째로 복사됐다.
-- 468 줄에는 「209가 가져감 1」(짝 기록, id Lmu2tznorl8y8) 하나만 남긴다.
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

-- 확인
select data ->> 'panelId' as panel, jsonb_pretty(data #> '{items,sQAVnsUc7Ju8zPmLG1yv,log}') as log
  from wm.panel_materials
 where data ->> 'box' = 'L/D BOX'
   and data ->> 'panelId' in ('Hoofbp52ZxhyZMq44L1h', 'saXhWTEJXRyhd7kHkuvQ');
