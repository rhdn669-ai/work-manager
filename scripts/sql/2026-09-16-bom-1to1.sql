-- 프로버 (메티스) ↔ 프로버 (디에이치) 1대1 맞대기 (2026-09-16)
-- BOX 별로 모아 품목으로 짝짓고, 도급·사급 구분은 빼고 «타입과 수량»만 견준다.
with v as (
  select p.id as pid, x ->> 'key' as k, x ->> 'label' as lab
    from wm.bom_projects p,
         lateral jsonb_array_elements(coalesce(p.data -> 'variants', '[]'::jsonb)) x
),
r as (
  select b.data ->> 'siteId' as pid,
         b.data ->> 'box' as box,
         coalesce(b.data ->> 'itemId', '') as item,
         coalesce(b.data ->> 'name', '') as nm,
         coalesce(b.data ->> 'spec', '') as sp,
         coalesce((b.data ->> 'qty')::numeric, 0) as q,
         coalesce(
           (select string_agg(distinct coalesce(v.lab, k2.k), ', ')
              from lateral jsonb_array_elements_text(coalesce(b.data -> 'variantKeys', '[]'::jsonb)) as k2(k)
              left join v on v.pid = b.data ->> 'siteId' and v.k = k2.k),
           '공통') as vs
    from wm.bom b
   where b.data ->> 'siteId' in ('jlctOy26LwZWsYxsxwrA', 'DD6L7iqAgW9ENBmKUOEI')
),
g as (
  select pid, box, item, min(nm) as nm, min(sp) as sp, sum(q) as q,
         string_agg(distinct vs, ' + ') as vs, count(*) as lines
    from r group by pid, box, item
),
m as (select * from g where pid = 'jlctOy26LwZWsYxsxwrA'),
d as (select * from g where pid = 'DD6L7iqAgW9ENBmKUOEI')
select coalesce(m.box, d.box) as box,
       coalesce(m.nm, d.nm) as 품명,
       coalesce(m.sp, d.sp) as 규격,
       coalesce(m.q::text, '없음') as 메티스,
       coalesce(d.q::text, '없음') as 디에이치,
       coalesce(m.vs, '-') as 메티스타입,
       coalesce(d.vs, '-') as 디에이치타입,
       case when m.item is null then '디에이치에만'
            when d.item is null then '메티스에만'
            when m.q <> d.q and m.vs <> d.vs then '수량+타입'
            when m.q <> d.q then '수량'
            else '타입' end as 무엇
  from m full outer join d on m.box = d.box and m.item = d.item
 where m.item is null or d.item is null or m.q <> d.q or m.vs <> d.vs
 order by 1, 2, 3;
