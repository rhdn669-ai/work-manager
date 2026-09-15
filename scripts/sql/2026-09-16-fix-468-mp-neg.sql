-- 468 호기 · MP · SERVO DRIVE 5R5AA0A 줄 수량 -1 → 0 (2026-09-16)
-- 상대 호기 줄은 0 밑으로 안 내려가기로 했다 (v150.6). 기록 「209가 가져감 1」은 그대로 둔다.
update wm.panel_materials
   set data = jsonb_set(data, '{items,Nz45odZ2QckYUbVFe0ZJ,qty}', '0'::jsonb)
 where data ->> 'panelId' = 'Hoofbp52ZxhyZMq44L1h' and data ->> 'box' = 'MP';
-- 확인: 음수 줄이 남았는지
select m.data->>'panelId', m.data->>'box', e.key, e.value->>'qty'
  from wm.panel_materials m join jsonb_each(m.data->'items') e on true
 where (e.value->>'qty')::numeric < 0;
