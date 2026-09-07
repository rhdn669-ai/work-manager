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

export const sb = createClient(URL, ANON, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'wmServerAuth' },
  db: { schema: 'wm' },
});

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
function build(name, cs = [], select = 'id,data') {
  let q = sb.from(tableOf(name)).select(select);
  const fast = FAST[name] || {};
  for (const c of cs) {
    if (c.__kind === 'where') {
      const col = c.field === '__id' ? 'id' : fast[c.field];
      const path = col || `data->>${c.field}`;
      const jsonPath = `data->${c.field}`;
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
        case 'array-contains':
          q = q.contains(jsonPath, [v]);
          break;
        case 'array-contains-any':
          q = q.overlaps(jsonPath, v);
          break;
        default:
          throw new Error(`아직 못 옮긴 조건: ${c.op}`);
      }
    } else if (c.__kind === 'order') {
      const col = fast[c.field];
      q = q.order(col || `data->>${c.field}`, { ascending: c.dir !== 'desc' });
    } else if (c.__kind === 'limit') {
      q = q.limit(c.n);
    }
  }
  return q;
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

const wrap = (row) => ({
  id: row.id,
  exists: () => true,
  data: () => fromPlain(row.data || {}),
  get: (f) => fromPlain(row.data || {})[f],
});

export async function getDocs(refOrQuery) {
  const { name, cs } = refOrQuery.__kind === 'query' ? refOrQuery : { name: refOrQuery.name, cs: [] };
  const { data, error } = await build(name, cs).limit(10000);
  if (error) throw new Error(`${name} 조회 실패: ${error.message}`);
  const docs = (data || []).map(wrap);
  return snapshotOf(docs, data || []);
}

export async function getDoc(ref) {
  const { data, error } = await sb.from(tableOf(ref.name)).select('id,data').eq('id', ref.id).maybeSingle();
  if (error) throw new Error(`${ref.name} 조회 실패: ${error.message}`);
  if (!data) return { id: ref.id, exists: () => false, data: () => undefined };
  return wrap(data);
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
  const { error } = await sb.schema('public').rpc(fn, args);
  if (error) throw new Error(`${label} 실패: ${error.message}`);
}

export async function addDoc(colRef, data) {
  const id = newId();
  await setDoc({ __kind: 'doc', name: colRef.name, id }, data);
  return { id, path: `${colRef.name}/${id}` };
}

export async function setDoc(ref, data, opts = {}) {
  const { plain, dels, ops } = splitMarks(data || {});
  if (opts.merge) {
    await updateDoc(ref, data);
    return;
  }
  const { error } = await sb.from(tableOf(ref.name)).upsert({ id: ref.id, data: plain });
  if (error) throw new Error(`${ref.name} 저장 실패: ${error.message}`);
  if (dels.length || ops.length) await applyExtras(ref, dels, ops);
}

async function applyExtras(ref, dels, ops) {
  if (dels.length) {
    await rpc(
      'doc_patch',
      { p_schema: 'wm', p_table: tableOf(ref.name), p_id: ref.id, p_patch: {}, p_dels: dels },
      `${ref.name} 항목 지우기`,
    );
  }
  for (const op of ops) {
    if (op.kind === 'array') {
      await rpc(
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
      await rpc(
        'doc_increment',
        { p_schema: 'wm', p_table: tableOf(ref.name), p_id: ref.id, p_field: op.field, p_by: op.by },
        `${ref.name} 숫자 더하기`,
      );
    }
  }
}

export async function updateDoc(ref, patch) {
  const { plain, dels, ops } = splitMarks(patch || {});
  if (Object.keys(plain).length || dels.length) {
    await rpc(
      'doc_patch',
      { p_schema: 'wm', p_table: tableOf(ref.name), p_id: ref.id, p_patch: plain, p_dels: dels },
      `${ref.name} 수정`,
    );
  }
  if (ops.length) await applyExtras(ref, [], ops);
}

// 실제 지우기는 서비스 계층(serverDocDelete)에 있다 — 앱의 삭제는 늘 휴지통을 먼저 거친다.
async function removeOne(ref) {
  await removeRow(sb, tableOf(ref.name), ref.id);
}
export { removeOne as deleteDoc };

// 여러 건 한꺼번에 — 순서대로 보낸다
export function writeBatch() {
  const jobs = [];
  return {
    set: (ref, data, opts) => jobs.push(() => setDoc(ref, data, opts)),
    update: (ref, patch) => jobs.push(() => updateDoc(ref, patch)),
    delete: (ref) => jobs.push(() => removeOne(ref)),
    commit: async () => {
      for (const j of jobs) await j();
    },
  };
}

// ── 화면 자동 갱신 ────────────────────────────────────────────────────
// 실시간 기능은 아직 올리지 않았으므로 잠깐씩 다시 읽어 화면을 갱신한다.
// 창이 뒤에 있으면 쉬고, 앞으로 오면 곧바로 한 번 읽는다.
const POLL_MS = 4000;
export function onSnapshot(refOrQuery, onNext, onError) {
  let stopped = false;
  let timer = 0;
  const isDoc = refOrQuery.__kind === 'doc';
  let prev = null;
  const tick = async () => {
    if (stopped) return;
    try {
      let v;
      if (isDoc) {
        v = await getDoc(refOrQuery);
      } else {
        const { name, cs } = refOrQuery.__kind === 'query' ? refOrQuery : { name: refOrQuery.name, cs: [] };
        const { data, error } = await build(name, cs).limit(10000);
        if (error) throw new Error(`${name} 조회 실패: ${error.message}`);
        v = snapshotOf((data || []).map(wrap), data || [], prev);
        prev = v.__state;
      }
      if (!stopped) onNext(v);
    } catch (e) {
      if (stopped) return;
      if (onError) onError(e);
      else console.error('[사내 서버] 자동 갱신 실패', e);
    }
    if (!stopped) timer = setTimeout(tick, document.hidden ? POLL_MS * 4 : POLL_MS);
  };
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
    document.removeEventListener('visibilitychange', wake);
  };
}

// 서비스 파일들이 `db` 를 넘겨 쓰므로 자리만 채워 둔다
export const db = { __kind: 'server' };
