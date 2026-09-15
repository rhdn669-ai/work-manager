-- 「통에서 온 누계」(fromStock·fromOurs)가 실제 수량보다 큰 줄을 실제 수량으로 맞춘다 (2026-09-16)
-- 화면이 기억한 옛 값에 더하던 버그(v150.7 에서 고침)로 207 호기 MP SERVO DRIVE 가 1개 가져오고 3으로 적혀 있었다.
-- 줄일 때 그 누계만큼 통으로 돌아가므로, 큰 값을 두면 없던 재고가 생긴다.
with bad as (
  select m.id, e.key as k,
         greatest(0, least((e.value->>'fromStock')::numeric, greatest(0, (e.value->>'qty')::numeric))) as fs
    from wm.panel_materials m, jsonb_each(m.data->'items') e
   where (e.value->>'fromStock')::numeric > greatest(0, coalesce((e.value->>'qty')::numeric, 0))
)
update wm.panel_materials m
   set data = jsonb_set(
                jsonb_set(m.data, array['items', bad.k, 'fromStock'], to_jsonb(bad.fs)),
                array['items', bad.k, 'fromOurs'],
                to_jsonb(least(coalesce((m.data->'items'->bad.k->>'fromOurs')::numeric, 0), bad.fs)))
  from bad where bad.id = m.id;
-- 확인: 남은 어긋남
select m.data->>'panelId', m.data->>'box', e.key, e.value->>'qty', e.value->>'fromStock'
  from wm.panel_materials m, jsonb_each(m.data->'items') e
 where (e.value->>'fromStock')::numeric > greatest(0, coalesce((e.value->>'qty')::numeric, 0));
