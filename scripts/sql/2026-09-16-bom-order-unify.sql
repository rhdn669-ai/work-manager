-- 프로버 (메티스) ↔ 프로버 (디에이치) 순서 통일 (2026-09-16 대표님 「순서도 실제로 통일해줘
-- 박스별로 순서도 묶어주고」)
--
-- ① BOX 순서는 앱과 같게: 준비작업 · LOCAL · P/W BOX · H/T BOX 상 · H/T BOX 하 · L/D BOX ·
--    S/D BOX · ROBOT · MP (그 밖의 BOX 는 뒤에 이름순)
-- ② BOX 안 순서는 «메티스» 를 기준으로 삼고, 디에이치가 그 순서를 그대로 따른다.
-- ③ 같은 BOX 에 같은 품목이 여러 줄이면 수량·타입으로 갈라 짝짓는다.
-- ④ 메티스에 없는 디에이치 줄은 그 BOX 끝에 붙인다 (지금은 없다).
--
-- 되돌리기: 두 BOM 모두 「수정 이력」에 이 변경 직전 상태가 남지 않는다(앱 밖에서 고치므로).
-- 순서만 바꾸는 것이라 수량·타입·구분은 건드리지 않는다.

begin;

with boxorder(box, rank) as (
  values ('준비작업', 1), ('LOCAL', 2), ('P/W BOX', 3), ('H/T BOX 상', 4), ('H/T BOX 하', 5),
         ('L/D BOX', 6), ('S/D BOX', 7), ('ROBOT', 8), ('MP', 9)
),
-- 줄마다 BOX 차례와 짝짓기 열쇠
base as (
  select b.id,
         b.data ->> 'siteId' as pid,
         coalesce(b.data ->> 'box', '') as box,
         coalesce(bo.rank, 99) as brank,
         coalesce(b.data ->> 'itemId', '') as item,
         coalesce((b.data ->> 'qty')::numeric, 0) as q,
         coalesce(b.data -> 'variantKeys', '[]'::jsonb)::text as vk,
         coalesce((b.data ->> 'order')::numeric, 0) as ord
    from wm.bom b
    left join boxorder bo on bo.box = b.data ->> 'box'
   where b.data ->> 'siteId' in ('jlctOy26LwZWsYxsxwrA', 'DD6L7iqAgW9ENBmKUOEI')
),
-- 같은 BOX·품목이 여러 줄일 때 짝을 갈라 줄 번호
dup as (
  select *, row_number() over (partition by pid, box, item order by q, vk, ord, id) as dupno
    from base
),
-- 메티스 기준 차례 — BOX 차례, 그 안은 지금 순서 그대로
metis as (
  select id, box, brank, item, dupno,
         row_number() over (order by brank, box, ord, id) as seq
    from dup where pid = 'jlctOy26LwZWsYxsxwrA'
),
-- 디에이치 — 같은 BOX·품목·짝번호의 메티스 차례를 따른다. 짝이 없으면 그 BOX 끝으로
dh as (
  select d.id, d.box, d.brank, m.seq as mseq, d.ord, d.id as tie
    from dup d
    left join metis m on m.box = d.box and m.item = d.item and m.dupno = d.dupno
   where d.pid = 'DD6L7iqAgW9ENBmKUOEI'
),
dh_seq as (
  select id, row_number() over (order by brank, box, coalesce(mseq, 1000000), ord, tie) as seq from dh
),
newseq as (
  select id, seq from metis
  union all
  select id, seq from dh_seq
)
update wm.bom b
   set data = jsonb_set(b.data, '{order}', to_jsonb(n.seq)) || jsonb_build_object('updatedAt', now())
  from newseq n
 where b.id = n.id;

commit;

-- 확인 — 두 BOM 을 순서대로 늘어놓고 줄마다 맞대기 (다른 곳만 나온다)
with m as (
  select row_number() over (order by (data ->> 'order')::numeric) as i,
         data ->> 'box' as box, coalesce(data ->> 'name', '') as nm, coalesce(data ->> 'spec', '') as sp
    from wm.bom where data ->> 'siteId' = 'jlctOy26LwZWsYxsxwrA'
),
d as (
  select row_number() over (order by (data ->> 'order')::numeric) as i,
         data ->> 'box' as box, coalesce(data ->> 'name', '') as nm, coalesce(data ->> 'spec', '') as sp
    from wm.bom where data ->> 'siteId' = 'DD6L7iqAgW9ENBmKUOEI'
)
select m.i as 줄, m.box as 메티스BOX, m.nm as 메티스품명, d.box as 디에이치BOX, d.nm as 디에이치품명
  from m full outer join d on m.i = d.i
 where m.box is distinct from d.box or m.nm is distinct from d.nm or m.sp is distinct from d.sp
 order by 1;
