// 사내 서버(Supabase) 를 «지금 쓰던 방식» 그대로 부르기 위한 얇은 옮김판.
//
// 앱의 서비스 파일 30개는 전부 Firestore 방식(collection·doc·getDocs…)으로 쓰여 있다.
// 그 코드를 한 줄도 고치지 않고 사내 서버를 보게 하려고, 같은 이름의 함수를 여기서 다시 만든다.
// (2026-09-07 온프레미스 이전)
//
// 서버 저장 모양: 표 한 줄 = 문서 하나. 원본은 data 한 칸(jsonb)에 그대로 들어 있고,
// 자주 찾는 값(현장·사용자·사번 등)만 «따라 만들어지는 열»로 뽑혀 색인이 걸려 있다.
import { createClient } from '@supabase/supabase-js';
import { removeRow } from '../services/serverDocDelete';

const URL = import.meta.env.VITE_SB_URL || '';
const ANON = import.meta.env.VITE_SB_ANON_KEY || '';

// 접속 준비는 «실제로 부를 때» 한다. 파일을 읽는 순간 만들면, 서버를 쓰지 않는 곳
// (예: 계산 로직만 확인하는 단위 시험)에서도 서버 주소가 없다고 멈춰 버린다.
let client = null;
function connect() {
  if (client) return client;
  if (!URL || !ANON)
    throw new Error('사내 서버 주소나 열쇠가 설정되지 않았습니다 (.env 의 VITE_SB_URL · VITE_SB_ANON_KEY)');
  client = createClient(URL, ANON, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'wmServerAuth' },
    db: { schema: 'wm' },
  });
  return client;
}

// 지금까지처럼 `sb.from(...)` 으로 쓸 수 있게 두되, 처음 쓰는 순간에 연결한다.
export const sb = new Proxy(
  {},
  {
    get(_t, key) {
      const c = connect();
      const v = c[key];
      return typeof v === 'function' ? v.bind(c) : v;
    },
  },
);

// 컬렉션 이름 → 표 이름 (bomHistory → bom_history)
const tableOf = (name) => name.replace(/(?<!^)(?=[A-Z])/g, '_').toLowerCase();

// 색인이 걸린 «뽑아낸 열» — 이 필드로 거르면 훨씬 빠르다
const FAST = {
  bom: { siteId: 'site_id', itemId: 'item_id' },
  bomHistory: { siteId: 'site_id' },
  departments: { managerId: 'manager_id' },
  events: { startDate: 'start_date' },
  leaves: { userId: 'user_id', startDate: 'start_date' },
  libraryFiles: { folderId: 'folder_id' },
  libraryFolders: { parentId: 'parent_id' },
  mailReplies: { threadId: 'thread_id' },
  overtimeRecords: { userId: 'user_id', siteId: 'site_id', date: 'work_date' },
  panelMaterials: { panelId: 'panel_id' },
  personalEvents: { userId: 'user_id' },
  productionPanels: { 프로젝트: 'project_name', 회사: 'company' },
  purchaseItems: { defaultSupplierId: 'default_supplier_id' },
  purchasePrintLogs: { purchaseId: 'purchase_id' },
  purchases: { supplierId: 'supplier_id', siteId: 'site_id', bomProjectId: 'bom_project_id' },
  qualityRecords: { sourcePanelId: 'source_panel_id' },
  siteClosingItems: { siteId: 'site_id', closingId: 'closing_id' },
  siteFinances: { siteId: 'site_id', date: 'entry_date' },
  tasks: { assigneeId: 'assignee_id' },
  trash: { collection: 'src_collection', refId: 'ref_id' },
  users: { code: 'code', departmentId: 'department_id' },
  vehicleMileages: { uid: 'uid' },
  leaveBalances: { userId: 'user_id' },
};

// 방금 저장한 값을 잠깐(6초) 들고 있는다.
//
// 구글은 저장하는 즉시 화면에 반영해 주었지만, 사내 서버는 몇 초마다 다시 읽어 오는 방식이라
// 저장 직후 잠깐 «옛 값» 이 보였다. 그래서 입고 수량을 적어도 안 들어간 것처럼 보였다
// (2026-09-08 대표님 「입력이 한 번에 안 됨」). 아래 기억이 그 틈을 메운다.
const FRESH_MS = 6000;
const justWritten = new Map();
const freshKey = (name, id) => `${name}/${id}`;
function remember(name, id, data) {
  justWritten.set(freshKey(name, id), { data, at: Date.now() });
}
function forget(name, id) {
  justWritten.set(freshKey(name, id), { data: null, at: Date.now() });
}
// 화면 구독 등록부 — 저장이 끝나면 4초 주기를 기다리지 않고 곧바로 다시 읽게 한다
// (2026-09-09 대표님 「입력 반응이 한 박자 느려서 헷갈리네」)
const listeners = new Map(); // name → Set(다시 읽기 함수)
function listen(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name)?.delete(fn);
}
function refresh(name) {
  const set = listeners.get(name);
  if (!set) return;
  for (const fn of set) fn();
}

// 화면이 마지막으로 본 값 — 저장을 보내기 «전에» 바뀔 모습을 먼저 보여 주는 데 쓴다
const lastRows = new Map(); // name → Map(id → data)
function noteRows(name, rows) {
  lastRows.set(name, new Map(rows.map((r) => [r.id, r.data])));
}
function deepMerge(a, b) {
  if (!a || typeof a !== 'object' || Array.isArray(a) || !b || typeof b !== 'object' || Array.isArray(b)) return b;
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = k in o ? deepMerge(o[k], v) : v;
  return o;
}
// 마지막으로 본 값이 있으면 바꿀 모습을 미리 기억하고 화면을 곧바로 다시 그린다
function optimistic(name, id, change) {
  const cur = lastRows.get(name)?.get(id);
  if (cur === undefined) return;
  try {
    remember(name, id, change(cur));
    refresh(name);
  } catch {
    /* 미리 보여 주기는 실패해도 그만 — 서버 응답이 오면 어차피 맞춰진다 */
  }
}

function applyFresh(name, rows) {
  const now = Date.now();
  const out = rows.map((r) => {
    const hit = justWritten.get(freshKey(name, r.id));
    if (hit && now - hit.at < FRESH_MS) return hit.data ? { ...r, data: hit.data } : null;
    return r;
  });
  // 방금 새로 만든 줄이 아직 목록에 안 잡혔으면 끼워 넣는다
  const have = new Set(rows.map((r) => r.id));
  for (const [k, v] of justWritten) {
    if (now - v.at >= FRESH_MS) {
      justWritten.delete(k);
      continue;
    }
    const [n, id] = [k.slice(0, k.indexOf('/')), k.slice(k.indexOf('/') + 1)];
    if (n === name && v.data && !have.has(id)) out.push({ id, data: v.data });
  }
  return out.filter(Boolean);
}

// 문서 id — Firestore 가 만들던 20자와 같은 모양
const newId = () => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const r = crypto.getRandomValues(new Uint8Array(20));
  return [...r].map((n) => A[n % A.length]).join('');
};

// ── 값 다듬기 ─────────────────────────────────────────────────────────
// 서버에는 «그냥 JSON» 만 넣는다. 날짜는 ISO 글자로 바꾼다.
const toPlain = (v) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(toPlain);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = toPlain(x);
    return o;
  }
  return v;
};

// 읽어온 값 — 날짜 글자를 앱이 쓰던 모양(toDate 를 가진 값)으로 돌려준다
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/;
const fromPlain = (v) => {
  if (typeof v === 'string' && ISO.test(v)) {
    const d = new Date(v);
    return { toDate: () => d, toMillis: () => d.getTime(), seconds: Math.floor(d.getTime() / 1000) };
  }
  if (Array.isArray(v)) return v.map(fromPlain);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = fromPlain(x);
    return o;
  }
  return v;
};

// ── 표시용 표식(Firestore 의 특수값 대신) ───────────────────────────────
const MARK = '__wm_mark';
export const serverTimestamp = () => ({ [MARK]: 'now' });
export const deleteField = () => ({ [MARK]: 'delete' });
export const arrayUnion = (...vals) => ({ [MARK]: 'union', vals });
export const arrayRemove = (...vals) => ({ [MARK]: 'remove', vals });
export const increment = (by) => ({ [MARK]: 'inc', by });
export const Timestamp = {
  now: () => ({ toDate: () => new Date(), toMillis: () => Date.now() }),
  fromDate: (d) => ({ toDate: () => d, toMillis: () => d.getTime() }),
};
const isMark = (v) => v && typeof v === 'object' && MARK in v;

// ── 자리표(참조) ──────────────────────────────────────────────────────
export const collection = (_db, name) => ({ __kind: 'col', name });
export function doc(a, b, c) {
  // doc(db,'sites',id) · doc(colRef,id) · doc(colRef) 세 가지 모두 받는다
  if (a && a.__kind === 'col') return { __kind: 'doc', name: a.name, id: b || newId() };
  return { __kind: 'doc', name: b, id: c || newId() };
}
export const where = (field, op, value) => ({ __kind: 'where', field, op, value });
export const orderBy = (field, dir = 'asc') => ({ __kind: 'order', field, dir });
export const limit = (n) => ({ __kind: 'limit', n });
export const query = (ref, ...cs) => ({ __kind: 'query', name: ref.name, cs: [...(ref.cs || []), ...cs] });
export const documentId = () => '__id';

// ── 조회 ──────────────────────────────────────────────────────────────
// 「bomLink.projectId」 처럼 «속 값» 을 가리키는 이름은 자리마다 끊어 줘야 한다.
// 그냥 이어 붙이면 점이 들어간 «그런 이름의 칸» 을 찾게 되어 언제나 0건이 나온다
// (BOM 을 건 호기 15대를 못 찾던 원인, 2026-09-11).
function jsonPathOf(field, asText) {
  const parts = field.split('.');
  const last = parts.pop();
  return `${['data', ...parts].join('->')}->${asText ? '>' : ''}${last}`;
}

function build(name, cs = [], select = 'id,data') {
  let q = sb.from(tableOf(name)).select(select);
  const fast = FAST[name] || {};
  for (const c of cs) {
    if (c.__kind === 'where') {
      const col = c.field === '__id' ? 'id' : fast[c.field];
      const path = col || jsonPathOf(c.field, true);
      const jsonPath = jsonPathOf(c.field, false);
      const v = toPlain(c.value);
      switch (c.op) {
        case '==':
          if (col) q = q.eq(col, v);
          else if (typeof v === 'number' || typeof v === 'boolean') q = q.eq(jsonPath, v);
          else if (v === null) q = q.is(jsonPath, null);
          else q = q.eq(path, v);
          break;
        case '!=':
          q = typeof v === 'number' || typeof v === 'boolean' ? q.neq(jsonPath, v) : q.neq(path, v);
          break;
        case '>':
          q = q.gt(col ? col : typeof v === 'number' ? jsonPath : path, v);
          break;
        case '>=':
          q = q.gte(col ? col : typeof v === 'number' ? jsonPath : path, v);
          break;
        case '<':
          q = q.lt(col ? col : typeof v === 'number' ? jsonPath : path, v);
          break;
        case '<=':
          q = q.lte(col ? col : typeof v === 'number' ? jsonPath : path, v);
          break;
        case 'in':
          q = q.in(col || path, v);
          break;
        // 「목록 안에 이 값이 있나」 — 서버의 묶음(jsonb) 은 «JSON 글꼴» 로 물어야 한다.
        // 배열을 그대로 넘기면 `cs.{값}` 이라는 다른 문법으로 나가 서버가 400 을 돌려준다
        // (담당 프로젝트를 못 읽어 직원 첫 화면이 통째로 멈추던 원인, 2026-09-11).
        case 'array-contains':
          q = q.contains(jsonPath, JSON.stringify([v]));
          break;
        case 'array-contains-any':
          q = q.or(
            toPlain(c.value)
              .map((x) => `${jsonPath}.cs.${JSON.stringify([x])}`)
              .join(','),
          );
          break;
        default:
          throw new Error(`아직 못 옮긴 조건: ${c.op}`);
      }
    } else if (c.__kind === 'order') {
      const col = fast[c.field];
      q = q.order(col || jsonPathOf(c.field, true), { ascending: c.dir !== 'desc' });
    } else if (c.__kind === 'limit') {
      q = q.limit(c.n);
    }
  }
  return q;
}

// 색인 칸이 아닌 이름으로 줄을 세우면 서버는 «글자» 로 견준다 — 10 이 2 보다 앞에 온다.
// BOM 자재가 10개를 넘으면 순서가 조용히 뒤섞이던 원인이라, 받아 온 뒤 여기서 다시 세운다.
// (구글에서는 색인이 없으면 오류가 나서 화면 코드가 직접 다시 세웠는데, 서버는 조용히 성공한다.)
function resort(name, cs, rows) {
  const fast = FAST[name] || {};
  const orders = cs.filter((c) => c.__kind === 'order' && c.field !== '__id' && !fast[c.field]);
  if (!orders.length || rows.length < 2) return rows;
  const valueAt = (row, field) => field.split('.').reduce((o, k) => (o == null ? o : o[k]), row.data || {});
  const compare = (x, y) => {
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x ?? '').localeCompare(String(y ?? ''), 'ko');
  };
  return [...rows].sort((a, b) => {
    for (const o of orders) {
      const d = compare(valueAt(a, o.field), valueAt(b, o.field));
      if (d) return o.dir === 'desc' ? -d : d;
    }
    return 0;
  });
}

// 「몇 줄까지」는 여기서 자른다 — 조회는 늘 넉넉히 받아 오고, 줄 세운 뒤에 잘라야 맞다
function finish(name, cs, rows) {
  const sorted = resort(name, cs, rows);
  const lim = cs.find((c) => c.__kind === 'limit');
  return lim && sorted.length > lim.n ? sorted.slice(0, lim.n) : sorted;
}

// 조회 결과 묶음. 지난번과 견주어 «무엇이 바뀌었는지»(docChanges) 도 알려 준다 —
// 화면이 바뀐 줄만 다시 그리도록 만들어져 있기 때문이다.
function snapshotOf(docs, rows, prev) {
  const now = new Map(rows.map((r) => [r.id, JSON.stringify(r.data || {})]));
  const changes = [];
  if (prev) {
    for (const d of docs) {
      const before = prev.get(d.id);
      if (before === undefined) changes.push({ type: 'added', doc: d });
      else if (before !== now.get(d.id)) changes.push({ type: 'modified', doc: d });
    }
    for (const [id] of prev) {
      if (!now.has(id)) changes.push({ type: 'removed', doc: { id, exists: () => false, data: () => ({}) } });
    }
  } else {
    for (const d of docs) changes.push({ type: 'added', doc: d });
  }
  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
    forEach: (f) => docs.forEach(f),
    docChanges: () => changes,
    __state: now,
  };
}

const wrap = (row, name) => ({
  id: row.id,
  exists: () => true,
  data: () => fromPlain(row.data || {}),
  get: (f) => fromPlain(row.data || {})[f],
  // 구글은 줄마다 「자리표」를 함께 줬다. batch.delete(d.ref) 처럼 그것을 바로 쓰는 곳이 있어
  // 빠져 있으면 BOM 프로젝트 지우기가 통째로 터진다 (2026-09-11).
  ref: { __kind: 'doc', name, id: row.id },
});

export async function getDocs(refOrQuery) {
  const { name, cs } = refOrQuery.__kind === 'query' ? refOrQuery : { name: refOrQuery.name, cs: [] };
  const { data, error } = await build(name, cs).limit(10000);
  if (error) throw new Error(`${name} 조회 실패: ${error.message}`);
  const rows = finish(name, cs, applyFresh(name, data || []));
  return snapshotOf(
    rows.map((r) => wrap(r, name)),
    rows,
  );
}

export async function getDoc(ref) {
  const { data, error } = await sb.from(tableOf(ref.name)).select('id,data').eq('id', ref.id).maybeSingle();
  if (error) throw new Error(`${ref.name} 조회 실패: ${error.message}`);
  const [row] = applyFresh(ref.name, data ? [data] : []);
  if (!row) return { id: ref.id, exists: () => false, data: () => undefined };
  return wrap(row, ref.name);
}
export const getDocFromServer = getDoc;

export async function getCountFromServer(refOrQuery) {
  const { name, cs } = refOrQuery.__kind === 'query' ? refOrQuery : { name: refOrQuery.name, cs: [] };
  const { count, error } = await build(name, cs, 'id').select('id', { count: 'exact', head: true });
  if (error) throw new Error(`${name} 세기 실패: ${error.message}`);
  return { data: () => ({ count: count || 0 }) };
}

// ── 쓰기 ──────────────────────────────────────────────────────────────
// 표식이 섞인 수정은 서버 도우미 함수로 보낸다(다른 사람이 같은 줄을 고쳐도 덮어쓰지 않게).
function splitMarks(patch) {
  const plain = {};
  const dels = [];
  const ops = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!isMark(v)) {
      plain[k] = toPlain(v);
      continue;
    }
    if (v[MARK] === 'now') plain[k] = new Date().toISOString();
    else if (v[MARK] === 'delete') dels.push(k);
    else if (v[MARK] === 'union') ops.push({ kind: 'array', field: k, add: toPlain(v.vals), remove: [] });
    else if (v[MARK] === 'remove') ops.push({ kind: 'array', field: k, add: [], remove: toPlain(v.vals) });
    else if (v[MARK] === 'inc') ops.push({ kind: 'inc', field: k, by: v.by });
  }
  return { plain, dels, ops };
}

async function rpc(fn, args, label) {
  // 도우미 함수는 공용 칸(public)에 있다 — 앱 기본 칸은 wm 이라 여기서만 바꿔 부른다
  const { data, error } = await sb.schema('public').rpc(fn, args);
  if (error) throw new Error(`${label} 실패: ${error.message}`);
  return data;
}

export async function addDoc(colRef, data) {
  const id = newId();
  await setDoc({ __kind: 'doc', name: colRef.name, id }, data);
  return { id, path: `${colRef.name}/${id}` };
}

export async function setDoc(ref, data, opts = {}) {
  const { plain, dels, ops } = splitMarks(data || {});
  if (opts.merge) {
    // 「얹어 저장」은 «속 안까지» 얹어야 한다. 겉만 얹으면 items 같은 묶음이 통째로 갈려
    // 먼저 적어 둔 기록이 사라진다 (2026-09-08 대표님 「추가 입고 체크에 기존 것도 초기화」).
    if (Object.keys(plain).length) {
      optimistic(ref.name, ref.id, (cur) => deepMerge(cur, plain));
      const saved = await rpc(
        'doc_merge',
        { p_schema: 'wm', p_table: tableOf(ref.name), p_id: ref.id, p_patch: plain },
        `${ref.name} 저장`,
      );
      if (saved) remember(ref.name, ref.id, saved);
      refresh(ref.name);
    }
    if (dels.length || ops.length) await applyExtras(ref, dels, ops);
    return;
  }
  remember(ref.name, ref.id, plain);
  refresh(ref.name);
  const { error } = await sb.from(tableOf(ref.name)).upsert({ id: ref.id, data: plain });
  if (error) {
    forget(ref.name, ref.id);
    refresh(ref.name);
    throw new Error(`${ref.name} 저장 실패: ${error.message}`);
  }
  if (dels.length || ops.length) await applyExtras(ref, dels, ops);
}

async function applyExtras(ref, dels, ops) {
  // 여기서 한 일의 «마지막 모습» — 아래에서 다시 적어 둔다
  let last = null;
  if (dels.length) {
    last = await rpc(
      'doc_patch',
      { p_schema: 'wm', p_table: tableOf(ref.name), p_id: ref.id, p_patch: {}, p_dels: dels },
      `${ref.name} 항목 지우기`,
    );
  }
  for (const op of ops) {
    if (op.kind === 'array') {
      last = await rpc(
        'doc_array',
        {
          p_schema: 'wm',
          p_table: tableOf(ref.name),
          p_id: ref.id,
          p_field: op.field,
          p_add: op.add,
          p_remove: op.remove,
        },
        `${ref.name} 목록 수정`,
      );
    } else {
      last = await rpc(
        'doc_increment',
        { p_schema: 'wm', p_table: tableOf(ref.name), p_id: ref.id, p_field: op.field, p_by: op.by },
        `${ref.name} 숫자 더하기`,
      );
    }
  }
  // 숫자 더하기·목록 넣기는 「얹어 저장」 뒤에 따로 돈다. 그 결과를 다시 적어 두지 않으면
  // 6초 동안 더해지기 «전» 값이 남아, 화면에도 옛 수량이 보이고 재고 확인도 그 값을 본다.
  // 사급 품목을 여러 호기에서 잇달아 가져가면 재고가 두 번 빠지던 원인이다 (2026-09-11).
  if (last) {
    remember(ref.name, ref.id, last);
    refresh(ref.name);
  }
}

// 「supplierSent.(주)이레텍.sentAt」 같은 점 이름은 «그 자리만» 고치라는 뜻이다.
// 펴 주지 않고 그대로 보내면 점이 들어간 «그런 이름의 칸» 이 새로 생겨 버린다.
function expandPaths(flat) {
  let nested = false;
  const out = {};
  for (const [k, v] of Object.entries(flat)) {
    if (!k.includes('.')) {
      out[k] = v;
      continue;
    }
    nested = true;
    const parts = k.split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = v;
  }
  return { out, nested };
}

const dropAt = (obj, path) => {
  let o = obj;
  for (let i = 0; i < path.length - 1 && o; i += 1) o = o[path[i]];
  if (o) delete o[path[path.length - 1]];
};

export async function updateDoc(ref, patch) {
  const { plain, dels, ops } = splitMarks(patch || {});
  const { out: obj, nested } = expandPaths(plain);
  const deepDels = dels.filter((k) => k.includes('.')).map((k) => k.split('.'));
  const flatDels = dels.filter((k) => !k.includes('.'));
  const table = tableOf(ref.name);
  const at = { p_schema: 'wm', p_table: table, p_id: ref.id };

  if (Object.keys(obj).length || dels.length) {
    optimistic(ref.name, ref.id, (cur) => {
      const base = deepDels.length ? JSON.parse(JSON.stringify(cur || {})) : cur;
      const next = nested ? deepMerge(base, obj) : { ...base, ...obj };
      for (const k of flatDels) delete next[k];
      for (const p of deepDels) dropAt(next, p);
      return next;
    });
    let saved = null;
    if (Object.keys(obj).length) {
      // 속을 고치는 것은 「얹어 저장」으로 — 겉만 얹으면 형제 값이 통째로 갈린다
      saved = nested
        ? await rpc('doc_merge', { ...at, p_patch: obj }, `${ref.name} 수정`)
        : await rpc('doc_patch', { ...at, p_patch: obj, p_dels: [] }, `${ref.name} 수정`);
    }
    if (flatDels.length) saved = await rpc('doc_patch', { ...at, p_patch: {}, p_dels: flatDels }, `${ref.name} 수정`);
    for (const p of deepDels) saved = await rpc('doc_unset', { ...at, p_path: p }, `${ref.name} 항목 지우기`);
    if (saved) remember(ref.name, ref.id, saved);
    refresh(ref.name);
  }
  if (ops.length) {
    await applyExtras(ref, [], ops);
    refresh(ref.name);
  }
}

// 실제 지우기는 서비스 계층(serverDocDelete)에 있다 — 앱의 삭제는 늘 휴지통을 먼저 거친다.
async function removeOne(ref) {
  forget(ref.name, ref.id);
  refresh(ref.name);
  await removeRow(sb, tableOf(ref.name), ref.id);
}
export { removeOne as deleteDoc };

// 여러 건 한꺼번에 — «전부 되거나, 전부 안 되거나».
//
// 옮겨 온 뒤 한동안은 하나씩 순서대로 내보냈는데, 중간에서 실패하면 앞부분만 저장된 채
// 남았다. BOM 순서를 바꾸다 끊기면 절반만 옮겨진 목록이 남는 식이다.
// 이제 서버 함수(doc_batch) 하나로 보내 한 묶음으로 처리한다 (2026-09-11 대표님).
export function writeBatch() {
  const ops = [];
  const previews = [];
  const touched = [];

  // 표식(서버시각·목록 넣기·숫자 더하기)을 서버가 알아듣는 일거리로 바꾼다
  const markOps = (base, marks) =>
    marks.map((m) =>
      m.kind === 'array'
        ? { ...base, k: 'array', f: m.field, add: m.add, rm: m.remove }
        : { ...base, k: 'inc', f: m.field, by: m.by },
    );

  return {
    set(ref, data, opts = {}) {
      const { plain, dels, ops: marks } = splitMarks(data || {});
      const { out: obj } = expandPaths(plain);
      const base = { t: tableOf(ref.name), id: ref.id };
      if (opts.merge) {
        if (Object.keys(obj).length) ops.push({ ...base, k: 'merge', d: obj });
        previews.push(() => optimistic(ref.name, ref.id, (cur) => deepMerge(cur, obj)));
      } else {
        ops.push({ ...base, k: 'set', d: obj });
        previews.push(() => remember(ref.name, ref.id, obj));
      }
      if (dels.length) ops.push({ ...base, k: 'patch', dels });
      ops.push(...markOps(base, marks));
      touched.push(ref);
    },
    update(ref, patch) {
      const { plain, dels, ops: marks } = splitMarks(patch || {});
      const { out: obj, nested } = expandPaths(plain);
      const base = { t: tableOf(ref.name), id: ref.id };
      const flatDels = dels.filter((k) => !k.includes('.'));
      const deepDels = dels.filter((k) => k.includes('.')).map((k) => k.split('.'));
      if (Object.keys(obj).length) ops.push({ ...base, k: nested ? 'merge' : 'patch', d: obj });
      if (flatDels.length) ops.push({ ...base, k: 'patch', dels: flatDels });
      for (const p of deepDels) ops.push({ ...base, k: 'unset', path: p });
      ops.push(...markOps(base, marks));
      previews.push(() =>
        optimistic(ref.name, ref.id, (cur) => {
          const next = nested ? deepMerge(cur, obj) : { ...cur, ...obj };
          for (const k of flatDels) delete next[k];
          return next;
        }),
      );
      touched.push(ref);
    },
    delete(ref) {
      ops.push({ t: tableOf(ref.name), id: ref.id, k: 'del' });
      previews.push(() => forget(ref.name, ref.id));
      touched.push(ref);
    },
    commit: async () => {
      if (!ops.length) return;
      const names = [...new Set(touched.map((r) => r.name))];
      for (const p of previews) p();
      for (const n of names) refresh(n);
      try {
        await rpc('doc_batch', { p_schema: 'wm', p_ops: ops }, '묶음 저장');
      } catch (e) {
        // 미리 보여 준 것을 걷어 낸다 — 저장이 안 됐으니 화면도 되돌아가야 한다
        for (const r of touched) justWritten.delete(freshKey(r.name, r.id));
        for (const n of names) refresh(n);
        throw e;
      }
      for (const n of names) refresh(n);
    },
  };
}

// ── 「무엇이 바뀌었나」 지켜보기 ────────────────────────────────────────
//
// 화면마다 제 표를 통째로 다시 읽으면, 주기를 줄일수록 서버가 버겁다.
// 그래서 서버에 아주 작은 표(wm.change_log)를 두고 «그것만» 1초마다 본다.
// 표가 바뀌면 거기에 시각이 적히므로, 바뀐 표만 골라 다시 읽으면 된다.
//   · 읽는 양  44줄짜리 표 하나        (전에는 구독 중인 모든 표를 통째로)
//   · 반응     1초 안                   (전에는 최대 4초)
// (2026-09-11 대표님 B8 「실시간 반영」)
//
// 이 지켜보기가 끊겨도 아래 폴링이 백업으로 남아 결국 갱신된다.
const WATCH_MS = 1000;
let watchTimer = 0;
let watching = false;
const seenAt = new Map(); // 표 이름 → 마지막으로 본 시각
const nameOfTable = new Map(); // 표 이름 → 컬렉션 이름 (구독이 등록될 때 채워진다)

let watchFails = 0;
let watchOk = false; // 지켜보기가 한 번이라도 성공했는가

async function watchTick() {
  try {
    const { data, error } = await sb.from('change_log').select('table_name,changed_at');
    if (error) throw error;
    watchFails = 0;
    watchOk = true;
    for (const row of data || []) {
      const before = seenAt.get(row.table_name);
      seenAt.set(row.table_name, row.changed_at);
      // 처음 본 것은 기준만 잡고 넘어간다 — 열자마자 전부 다시 읽을 필요가 없다
      if (before === undefined || before === row.changed_at) continue;
      const col = nameOfTable.get(row.table_name);
      if (col) refresh(col);
    }
  } catch {
    // 못 보면 백업 폴링을 다시 촘촘하게 — 지켜보기가 죽었는데 느려지기까지 하면 안 된다
    watchFails += 1;
    if (watchFails === 3) refreshAll();
  }
  if (watching) watchTimer = setTimeout(watchTick, document.hidden ? WATCH_MS * 8 : WATCH_MS);
}

function startWatch() {
  if (watching) return;
  watching = true;
  watchTick();
}
function stopWatchIfIdle() {
  if (listeners.size > 0) return;
  watching = false;
  clearTimeout(watchTimer);
}

// ── 화면 자동 갱신 ────────────────────────────────────────────────────
// 위 지켜보기가 못 볼 때를 대비한 백업. 창이 뒤에 있으면 쉬고, 앞으로 오면 곧바로 읽는다.
const POLL_MS = 12000;
const POLL_MS_FALLBACK = 4000;
// 지켜보기가 «실제로 도는 것을 확인하기 전에는» 예전 주기(4초)를 그대로 쓴다.
// 새 장치가 안 돌 때 오히려 느려지는 일이 없어야 한다.
const pollMs = () => (watchOk && watchFails < 3 ? POLL_MS : POLL_MS_FALLBACK);
function refreshAll() {
  for (const [, set] of listeners) for (const fn of set) fn();
}
export function onSnapshot(refOrQuery, onNext, onError) {
  let stopped = false;
  let timer = 0;
  const isDoc = refOrQuery.__kind === 'doc';
  const colName = refOrQuery.name;
  let prev = null;
  let busy = false;
  let again = false;
  const tick = async () => {
    if (stopped) return;
    if (busy) {
      again = true; // 읽는 중에 저장이 끝나면, 끝난 뒤 한 번 더 읽는다
      return;
    }
    busy = true;
    clearTimeout(timer);
    try {
      let v;
      if (isDoc) {
        v = await getDoc(refOrQuery);
      } else {
        const { name, cs } = refOrQuery.__kind === 'query' ? refOrQuery : { name: refOrQuery.name, cs: [] };
        const { data, error } = await build(name, cs).limit(10000);
        if (error) throw new Error(`${name} 조회 실패: ${error.message}`);
        const rows = finish(name, cs, applyFresh(name, data || []));
        noteRows(name, rows);
        v = snapshotOf(
          rows.map((r) => wrap(r, name)),
          rows,
          prev,
        );
        prev = v.__state;
      }
      if (!stopped) onNext(v);
    } catch (e) {
      if (stopped) return;
      if (onError) onError(e);
      else console.error('[사내 서버] 자동 갱신 실패', e);
    }
    busy = false;
    if (stopped) return;
    if (again) {
      again = false;
      tick();
      return;
    }
    timer = setTimeout(tick, document.hidden ? pollMs() * 4 : pollMs());
  };
  // 저장이 끝나면 곧바로 다시 읽도록 등록해 둔다
  const unlisten = listen(colName, tick);
  // 「무엇이 바뀌었나」를 볼 때 이 표가 어느 화면 것인지 알아야 한다
  nameOfTable.set(tableOf(colName), colName);
  startWatch();
  const wake = () => {
    if (!document.hidden && !stopped) {
      clearTimeout(timer);
      tick();
    }
  };
  document.addEventListener('visibilitychange', wake);
  tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
    unlisten();
    stopWatchIfIdle(); // 보는 화면이 하나도 없으면 지켜보기도 쉰다
    document.removeEventListener('visibilitychange', wake);
  };
}

// 서비스 파일들이 `db` 를 넘겨 쓰므로 자리만 채워 둔다
export const db = { __kind: 'server' };
