import { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../../components/common/Icon';
import { useFillHeight } from '../../utils/useFillHeight';
import ViewSwitch from '../../components/common/ViewSwitch';
import ReceiptChip from '../../components/common/ReceiptChip';
import IopnDocBrand from '../../components/admin/IopnDocBrand';
import { useAuth } from '../../contexts/useAuth';
import { useDialog } from '../../components/common/useDialog';
import { useEditLock } from '../../contexts/useEditLock';
import { subscribePanels, updatePanel } from '../../services/productionService';
import { getBomProjectById, getBomBySite, bomItemsForVariant, isFreeIssue } from '../../services/bomService';
import { subscribePurchaseItems } from '../../services/purchaseService';
import {
  subscribeFreeStock,
  takeFreeStock,
  returnFreeStock,
  receiveFreeStock,
  getFreeStockQty,
} from '../../services/freeStockService';
import {
  subscribePanelMaterials,
  setReceived,
  setSkipped,
  setNote,
  setReceivedMany,
  addFromStock,
} from '../../services/panelMaterialsService';
import {
  pullRowFromStock,
  unassignPaidSet,
  topUpPaidSet,
  subscribeReceivedFor,
  subscribePaidSetSettings,
} from '../../services/paidSetService';
import { subscribeAllMaterials } from '../../services/panelMaterialsService';
import { consumedByItem } from '../../domain/paidSets';
import { CHECKABLE_BOXES, hasBomLink, bomRowsForBox } from '../../domain/panelBom';
import { receivedQty, shortageOf, rowDone, boxKindComplete, boxSummary, isSkipped } from '../../domain/panelMaterials';
import { specFontClass, localStamp } from '../../utils/printText';

// 호기 자재 체크 — 이 호기, 이 BOX 의 BOM 구성품이 몇 개 들어왔는지
// (2026-09-03 대표님 「호기별로 자재 사급 도급 리스트 … 구성품 체크 수량」).
//
// 기록은 호기마다 따로(panelMaterials). 같은 BOM 을 여러 호기가 쓰므로 BOM 에 적으면
// 섞인다. 구성품이 전부 차면 생산현황의 「자재 도급 / 자재 사급」 칸이 저절로 켜진다.
// embedded: 자재 허브(MaterialsHubPage) 탭 안에서 그릴 때 — 뒤로 버튼·큰 제목 없이 (2026-09-05 안 B 2단계)
export default function PanelMaterialsPage({ embedded = false, panelId: panelIdProp = '' } = {}) {
  const params = useParams();
  const panelId = panelIdProp || params.panelId;
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const { toast, confirm } = useDialog();

  const [panel, setPanel] = useState(null);
  const [loadedPanels, setLoadedPanels] = useState(false);
  const [project, setProject] = useState(null);
  const [bomRows, setBomRows] = useState([]);
  const [master, setMaster] = useState([]);
  const [received, setReceivedMap] = useState({}); // { [box]: { [bomItemId]: {qty,at,by} } }
  const [supplyTab, setSupplyTab] = useState('paid'); // 'paid' | 'free'
  const [draft, setDraft] = useState({}); // 입력 중인 개수 { [bomItemId]: '3' }
  // 숫자를 직접 적는 칸은 «길게 누를 때»만 연다 — 100번 중 96번은 필요 수량 그대로 들어오기 때문
  // (2026-09-08 대표님 「자동 채우기 버튼으로, 한 번 더 누르면 수량 입력」 → 실측 후 A안 확정)
  const [typing, setTyping] = useState(null); // 지금 숫자를 적고 있는 줄 id
  const pressRef = useRef({ timer: 0, long: false });
  // 표 상자를 화면 아래까지 늘려 그 안에서 스크롤 — 머리줄·도번 열을 붙여 두기 위해 (2026-09-08 대표님)
  const scrollRef = useFillHeight();

  // ── 판넬 ──
  useEffect(() => {
    const unsub = subscribePanels((rows) => {
      setPanel(rows.find((p) => p.id === panelId) || null);
      setLoadedPanels(true);
    });
    return unsub;
  }, [panelId]);

  const link = panel?.bomLink || null;

  // ── BOM (연결된 프로젝트) ──
  useEffect(() => {
    // 연결이 없으면 아래 「연결 없음」 화면이 나가므로 여기서 상태를 비울 일이 없다
    if (!link?.projectId) return undefined;
    let alive = true;
    Promise.all([getBomProjectById(link.projectId), getBomBySite(link.projectId)])
      .then(([p, rows]) => {
        if (!alive) return;
        setProject(p || null);
        setBomRows(rows || []);
      })
      .catch(() => {
        if (alive) toast('BOM 을 불러오지 못했습니다', 'error');
      });
    return () => {
      alive = false;
    };
  }, [link?.projectId, toast]);

  // ── 품목 마스터 (코드·품명·규격·도번은 여기서 읽는다) ──
  useEffect(() => subscribePurchaseItems(setMaster), []);
  // 사급 재고 — 호기를 정하지 않고 들어온 고객사 물건 (2026-09-10 대표님)
  const [freeStock, setFreeStock] = useState({});
  const company = panel?.회사 || '';
  useEffect(() => {
    if (!company) return undefined;
    return subscribeFreeStock(company, setFreeStock);
  }, [company]);
  const masterMap = useMemo(() => Object.fromEntries(master.map((m) => [m.id, m])), [master]);

  // ── 이 호기의 입고 기록 ──
  useEffect(() => subscribePanelMaterials(panelId, setReceivedMap), [panelId]);

  // ── BOX ──
  const boxesWithRows = useMemo(() => {
    const forVariant = bomItemsForVariant(bomRows, link?.variantKey || '');
    return CHECKABLE_BOXES.filter((b) => bomRowsForBox(forVariant, b).length > 0);
  }, [bomRows, link?.variantKey]);
  const box = sp.get('box') || boxesWithRows[0] || CHECKABLE_BOXES[0];
  // 주소의 다른 값(고른 호기·탭)은 그대로 두고 box 만 바꾼다 —
  // 예전엔 통째로 갈아 끼워 BOX 를 누르면 첫 호기로 튀었다 (2026-09-05 대표님)
  const setBox = (b) => {
    const q = new URLSearchParams(sp);
    q.set('box', b);
    setSp(q, { replace: true });
  };

  // ── 이 BOX 의 구성품 (타입 → BOX 순으로 거른다) ──
  const rows = useMemo(() => {
    const forVariant = bomItemsForVariant(bomRows, link?.variantKey || '');
    return bomRowsForBox(forVariant, box).map((r) => {
      const m = r.itemId ? masterMap[r.itemId] : null;
      return {
        ...r,
        code: m?.code || r.code || '',
        name: m?.name || r.name || '',
        spec: m?.spec || r.spec || '',
        drawingNo: m?.drawingNo || r.drawingNo || '',
      };
    });
  }, [bomRows, link?.variantKey, box, masterMap]);
  const rec = received[box] || {};
  // 세트를 배정한 호기의 도급 수량은 세트가 정한다 — 손으로 못 고친다 (2026-09-03 대표님
  // 「도급 세트 배정하면 이 페이지는 수동으로 입력하는 게 안 되어야」). 사급은 그대로 손 체크.
  // 도급은 «항상» 읽기 전용 — 우리가 사서 넣는 자재라 「도급 세트」 배정으로만 채운다
  // (2026-09-03 대표님 「도급은 발주서에 체크하는 방식 … 개별로 체크하게 되어 있는데?」). 사급만 손 체크.
  // 잠금 — 사급 개수도 실수로 고쳐지지 않게 (2026-09-05 대표님 「잠금이 왜 없지」).
  // 도급은 잠금과 무관하게 «항상» 읽기 전용(발주 입고가 채운다).
  const editMode = useEditLock();
  const locked = supplyTab === 'paid' || !editMode;
  const assigned = !!panel?.paidSet;
  // BOX 마다 이 탭(도급/사급)의 부족 줄 수 — 탭 오른쪽 배지로 보여 어느 BOX 가 모자란지 한눈에
  // (2026-09-05 대표님 「부족 떠있는 위치 확인이 안 되니 박스 우측에 부족 수량」)
  const shortByBox = useMemo(() => {
    const forVariant = bomItemsForVariant(bomRows, link?.variantKey || '');
    const out = {};
    for (const b of CHECKABLE_BOXES) {
      const list = bomRowsForBox(forVariant, b).filter((r) =>
        supplyTab === 'free' ? isFreeIssue(r) : !isFreeIssue(r),
      );
      const got = received[b] || {};
      out[b] = list.filter((r) => !isSkipped(got, r.id) && shortageOf(r.qty, receivedQty(got, r.id)) > 0).length;
    }
    return out;
  }, [bomRows, link?.variantKey, received, supplyTab]);

  // 완료 / 부족만 보기 (2026-09-05 대표님 「완료 부족 토글」)
  const [rowView, setRowView] = useState('all'); // 'all' | 'short' | 'done'
  const shown = rows
    .filter((r) => (supplyTab === 'free' ? isFreeIssue(r) : !isFreeIssue(r)))
    .filter((r) => {
      if (rowView === 'all') return true;
      const done = rowDone(r, rec);
      return rowView === 'done' ? done : !done;
    });
  const summary = useMemo(() => boxSummary(rows, rec), [rows, rec]);
  // 고른 BOX 에 이 탭(도급/사급) 줄이 없으면 줄이 있는 쪽으로 옮긴다 — 빈 화면만 보고
  // 「연결이 안 됐나」 하지 않게 (2026-09-05 대표님)
  useEffect(() => {
    if (rows.length === 0) return;
    const cur = supplyTab === 'free' ? summary.free.total : summary.paid.total;
    if (cur > 0) return;
    const other = supplyTab === 'free' ? summary.paid.total : summary.free.total;
    if (other > 0) setSupplyTab(supplyTab === 'free' ? 'paid' : 'free');
  }, [box, rows.length, summary, supplyTab]);
  // 기록이 하나도 없는 탭에서는 「기록」 열을 빼서 오른쪽이 비지 않게 (2026-09-05 대표님 「우측 공백 X」)
  const hasMeta = shown.some((r) => rec[r.id]?.at || rec[r.id]?.fromStock);
  // 비고 — 호기·줄마다 한 줄 메모. 잠금을 풀어야 적는다 (2026-09-05 대표님 「비고란도 하나 만들어줘」)
  const [noteDraft, setNoteDraft] = useState({}); // { [rowId]: '입력 중' }
  const commitNote = async (r) => {
    const v = noteDraft[r.id];
    if (v === undefined) return;
    setNoteDraft((d) => {
      const n = { ...d };
      delete n[r.id];
      return n;
    });
    if (v.trim() === String(rec[r.id]?.note || '')) return;
    try {
      await setNote(panelId, box, r.id, v);
    } catch {
      toast('비고 저장에 실패했습니다', 'error');
    }
  };

  // ── ④ 연동: 이 BOX 의 도급/사급이 전부 차면 생산현황 자재 칸을 켠다, 하나라도 빠지면 끈다 ──
  useEffect(() => {
    if (!panel || rows.length === 0) return;
    // 기록이 하나도 없는 BOX 는 건드리지 않는다 — BOM 만 연결하고 페이지를 연 것만으로
    // 손으로 켜 둔 자재 칸이 「0개 입고」로 꺼지던 문제 (2026-09-03 대표님 「자재 칸 보호」)
    if (Object.keys(rec).length === 0) return;
    const cur = (panel.박스입고 || {})[box] || {};
    const nextPaid = boxKindComplete(rows, rec, 'paid');
    const nextFree = boxKindComplete(rows, rec, 'free');
    if (!!cur.자재_도급 === nextPaid && !!cur.자재_사급 === nextFree) return; // 그대로면 쓰지 않는다
    const today = new Date().toISOString().slice(0, 10);
    const curDate = (panel.박스입고일자 || {})[box] || {};
    updatePanel(panel.id, {
      박스입고: { ...(panel.박스입고 || {}), [box]: { ...cur, 자재_도급: nextPaid, 자재_사급: nextFree } },
      박스입고일자: {
        ...(panel.박스입고일자 || {}),
        [box]: {
          ...curDate,
          자재_도급: nextPaid ? curDate.자재_도급 || today : '',
          자재_사급: nextFree ? curDate.자재_사급 || today : '',
        },
      },
    }).catch(() => toast('자재 칸 갱신에 실패했습니다', 'error'));
  }, [panel, rows, rec, box, toast]);

  // ── 개수 저장 ──
  // 한 번 누르면 필요 수량만큼 채우고, 채워진 것을 다시 누르면 0 으로 되돌린다.
  // 저장 뒤 몇 초 동안 「되돌리기」를 띄운다 — 한 번 누르기로 바뀌면서 잘못 누를 일이 생겼다 (2026-09-08 대표님)
  const undoable = (message, restore) =>
    toast({ message, type: 'success', duration: 6000, action: { label: '되돌리기', onClick: restore } });
  const by = () => userProfile?.name || '';
  // 되돌리기는 «되돌린 양만큼» 재고도 되돌려야 한다.
  // 호기 수량만 되돌리고 통을 그대로 두면, 통에서 빠진 것이 사라진 채로 남는다 (2026-09-11).
  const restoreOne = (r, prevQty, appliedQty) => async () => {
    try {
      await setReceived(panelId, box, r.id, prevQty, by());
      await syncFree(r, appliedQty, prevQty);
    } catch {
      toast('되돌리지 못했습니다', 'error');
    }
  };

  // ── 사급은 «언제나» 재고 통을 거친다 (2026-09-11 대표님 「알아서 받은 걸로」) ──
  //
  // 물건이 들어오는 모양이 그때그때 다르다. 세트로 호기 수 맞춰 오기도 하고, 같은 품목이
  // 한 박스에 담겨 오기도 한다. 회사로 고를 수도 없다(반대 경우도 있다).
  // 그래서 «어디에 적을지»를 사람이 고르지 않게 했다 — 호기에서 그냥 체크하면,
  // 통에 없는 만큼은 「방금 들어온 것」으로 적히고 곧바로 이 호기로 나간다.
  // 결과: 재고 통은 늘 실물과 같고, 어디로 갔는지도 다 남는다.
  const syncFree = async (r, before, after) => {
    if (supplyTab !== 'free' || !r.itemId || !company) return;
    const d = (Number(after) || 0) - (Number(before) || 0);
    if (d === 0) return;
    const who = by();
    const where = `${panel?.프로젝트 || ''} · ${box}`;
    try {
      if (d > 0) {
        const have = await getFreeStockQty(company, r.itemId);
        const short = d - have;
        if (short > 0) {
          // 통에 없던 만큼 — 호기에서 바로 체크한 물건이다
          await receiveFreeStock(company, r, short, { by: who, note: `${where} 바로 체크` });
        }
        const took = await takeFreeStock(company, r.itemId, d, { by: who, note: where });
        if (took > 0) await addFromStock(panelId, box, r.id, took, Number(rec[r.id]?.fromStock) || 0);
      } else {
        await returnFreeStock(company, r.itemId, -d, { by: who, note: `${where} 되돌림` });
      }
    } catch (err) {
      console.error('[사급 재고] 맞추기 실패', err);
      toast('사급 재고를 맞추지 못했습니다 — 재고 화면에서 확인해 주세요', 'error');
    }
  };

  const toggleRow = async (r, got) => {
    const want = got > 0 ? 0 : Number(r.qty) || 0;
    try {
      await setReceived(panelId, box, r.id, want, by());
      await syncFree(r, got, want);
      undoable(want > 0 ? `${r.name} ${want}개 들어옴` : `${r.name} 0 으로`, restoreOne(r, got, want));
    } catch {
      toast('저장 중 오류가 발생했습니다', 'error');
    }
  };

  // 길게 누르면 숫자 칸이 열린다 (일부만 들어온 드문 경우)
  const startPress = (r) => {
    pressRef.current.long = false;
    clearTimeout(pressRef.current.timer);
    pressRef.current.timer = setTimeout(() => {
      pressRef.current.long = true;
      setTyping(r.id);
    }, 500);
  };
  const endPress = (r, got) => {
    clearTimeout(pressRef.current.timer);
    if (pressRef.current.long) return; // 길게 눌러 숫자 칸이 열린 경우는 여기서 끝
    toggleRow(r, got);
  };
  const cancelPress = () => {
    clearTimeout(pressRef.current.timer);
  };

  // 사급 재고에서 이 호기로 — 이제 재고 빼기는 syncFree 한 곳이 맡는다.
  // 여기서 또 빼면 두 번 빠진다(2026-09-11).
  const pullFree = async (r, have, n) => {
    const before = Number(have) || 0;
    const after = before + (Number(n) || 0);
    try {
      await setReceived(panelId, box, r.id, after, by());
      await syncFree(r, before, after);
      undoable(`${r.name || r.code} ${n}개를 사급 재고에서 가져왔습니다`, async () => {
        try {
          await setReceived(panelId, box, r.id, before, by());
          await syncFree(r, after, before);
        } catch {
          toast('되돌리지 못했습니다', 'error');
        }
      });
    } catch {
      toast('저장 중 오류가 발생했습니다', 'error');
    }
  };

  const commit = async (r) => {
    const raw = draft[r.id];
    if (raw === undefined) return;
    const n = Math.max(0, Number(raw) || 0);
    setDraft((d) => {
      const nd = { ...d };
      delete nd[r.id];
      return nd;
    });
    setTyping(null);
    const before = receivedQty(rec, r.id);
    if (n === before) return;
    try {
      await setReceived(panelId, box, r.id, n, by());
      await syncFree(r, before, n);
      undoable(`${r.name} ${n}개`, restoreOne(r, before, n));
    } catch {
      toast('저장 중 오류가 발생했습니다', 'error');
    }
  };
  // 이 탭의 줄을 한 번에 — 통째로 들어온 날은 필요 수량대로, 잘못 채웠을 땐 0 으로
  const fillAllTo = async (toBom) => {
    if (
      !toBom &&
      !(await confirm(
        `${supplyTab === 'free' ? '사급' : '도급'} ${shown.length}건의 입고 수량을 모두 0 으로 되돌리시겠습니까?`,
      ))
    )
      return;
    const before = shown.map((r) => ({ id: r.id, qty: receivedQty(rec, r.id) }));
    try {
      await Promise.all(
        shown.map((r) => setReceived(panelId, box, r.id, toBom ? Number(r.qty) || 0 : 0, userProfile?.name || '')),
      );
      // 사급이면 재고 통도 함께 맞춘다 — 한 줄씩 차례로(같은 품목이 겹쳐도 셈이 안 엉키게)
      for (const r of shown) {
        const b = before.find((x) => x.id === r.id)?.qty || 0;
        await syncFree(r, b, toBom ? Number(r.qty) || 0 : 0);
      }
      undoable(
        toBom ? `${shown.length}건을 필요 수량대로 채웠습니다` : `${shown.length}건을 0 으로 되돌렸습니다`,
        async () => {
          try {
            await setReceivedMany(panelId, box, before, by());
            // 통도 함께 되돌린다 — 한 줄씩 차례로
            for (const r of shown) {
              const b = before.find((x) => x.id === r.id)?.qty || 0;
              await syncFree(r, toBom ? Number(r.qty) || 0 : 0, b);
            }
          } catch {
            toast('되돌리지 못했습니다', 'error');
          }
        },
      );
    } catch {
      toast('저장 중 오류가 발생했습니다', 'error');
    }
  };
  // 이 호기에서만 줄을 일시 제외/복귀 — 기본 BOM 은 그대로 (세트 배정 호기의 도급 탭에서)
  const title = `${panel?.프로젝트 || ''}${panel?.호기 ? ` ${panel.호기}` : ''}`.trim() || '호기';
  const toggleSkip = async (r, on) => {
    try {
      await setSkipped(panelId, box, r.id, on, userProfile?.name || '');
    } catch {
      toast('저장에 실패했습니다', 'error');
    }
  };
  // 부족한 도급 줄을 창고 재고에서 (2026-09-05 대표님 「부족한 거 재고에서 땡겨오는 버튼 없나」)
  // 도급은 창고 재고(우리가 산 물건), 사급은 사급 재고(고객사 물건)를 본다
  const stockOf = (r) => {
    if (supplyTab === 'free') return Math.max(0, Number(freeStock[r.itemId]?.qty) || 0);
    const m = r.itemId ? masterMap[r.itemId] : null;
    return m && m.stockQty !== undefined && m.stockQty !== null ? Math.max(0, Number(m.stockQty) || 0) : 0;
  };
  const pullStock = async (r, have, short) => {
    const n = Math.min(short, stockOf(r));
    if (n <= 0) return;
    if (supplyTab === 'free') return pullFree(r, have, n);
    try {
      await pullRowFromStock(panel, r, {
        box,
        have,
        n,
        by: userProfile?.name || '',
        fromStock: Number(rec[r.id]?.fromStock) || 0,
      });
      toast(`${r.code || r.name} ${n}개를 창고 재고에서 가져왔습니다 (재고 ${stockOf(r) - n} 남음)`, 'success', 0);
    } catch (err) {
      console.error(err);
      toast('재고에서 가져오기에 실패했습니다', 'error', 0);
    }
  };
  // 도급 배정 탭을 없애며 옮겨 온 것 — 배정 취소 · 부족분 전부 재고에서 (2026-09-05 대표님)
  const stockByItem = useMemo(() => {
    const out = {};
    for (const r of bomRows) if (r.itemId && stockOf(r) > 0) out[r.itemId] = stockOf(r);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bomRows, masterMap]);
  const variantRows = useMemo(() => bomItemsForVariant(bomRows, link?.variantKey || ''), [bomRows, link?.variantKey]);
  // 발주 여유 = 이 BOM 으로 들어온 입고 − 배정 호기들이 가져간 양 (부족 집계와 같은 셈)
  const [settings, setSettings] = useState({});
  useEffect(() => subscribePaidSetSettings(setSettings), []);
  const siteId = settings?.[panel?.회사 || '']?.siteId || '';
  const [receivedByItem, setReceivedByItem] = useState({});
  useEffect(() => {
    if (!link?.projectId) return undefined;
    return subscribeReceivedFor({ bomProjectId: link.projectId, siteId }, (byItem) => setReceivedByItem(byItem));
  }, [link?.projectId, siteId]);
  const [allMaterials, setAllMaterials] = useState({});
  const [allPanels, setAllPanels] = useState([]);
  useEffect(() => subscribeAllMaterials(setAllMaterials), []);
  useEffect(() => subscribePanels(setAllPanels), []);
  const spareByItem = useMemo(() => {
    if (!link?.projectId) return {};
    const assigned = allPanels.filter((p) => p.paidSet && p.bomLink?.projectId === link.projectId);
    const consumed = consumedByItem(
      bomRows,
      assigned.map((p) => allMaterials[p.id] || {}),
    );
    const out = {};
    for (const [itemId, q] of Object.entries(receivedByItem)) out[itemId] = q - (consumed[itemId] || 0);
    return out;
  }, [link?.projectId, allPanels, bomRows, allMaterials, receivedByItem]);
  const canFillAll = useMemo(
    () => Object.values(spareByItem).some((v) => v > 0) || Object.keys(stockByItem).length > 0,
    [spareByItem, stockByItem],
  );
  const pullAllStock = async () => {
    try {
      const r = await topUpPaidSet(panel, variantRows, { by: userProfile?.name || '', spareByItem, stockByItem });
      const n = Object.values(r.stockUsed || {}).reduce((a, b) => a + b, 0);
      if (r.added === 0) toast('발주 여유도 창고 재고도 없어 채울 줄이 없습니다', 'error');
      else
        toast(
          `${r.added}줄을 채웠습니다${n > 0 ? ` (재고에서 ${n}개)` : ''}${r.short > 0 ? ` — 아직 ${r.short}줄 부족` : ''}`,
          'success',
          0,
        );
    } catch (err) {
      console.error(err);
      toast('재고에서 채우기에 실패했습니다', 'error', 0);
    }
  };
  const unassign = async () => {
    if (!(await confirm(`${title} 의 도급 배정을 취소하시겠습니까? 도급 줄 수량이 0 이 되고 자재 도급 칸이 꺼집니다.`)))
      return;
    try {
      await unassignPaidSet(panel, variantRows, { by: userProfile?.name || '' });
      toast('도급 배정을 취소했습니다', 'success');
    } catch (err) {
      console.error(err);
      toast('취소에 실패했습니다', 'error', 0);
    }
  };
  const fillAll = () => fillAllTo(true);
  const clearAll = () => fillAllTo(false);

  const back = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/production', { replace: true }));

  if (!loadedPanels)
    return (
      <div className="page">
        <p className="text-muted">불러오는 중…</p>
      </div>
    );
  if (!panel)
    return (
      <div className="page">
        <p className="text-muted">판넬을 찾을 수 없습니다.</p>
        {/* (2026-09-05 뒤로가기 표준) */}
        <button type="button" className="btn btn-sm btn-outline" onClick={back}>
          <Icon name="chevronLeft" className="btn-ic" />
          생산현황
        </button>
      </div>
    );
  if (!hasBomLink(panel))
    return (
      <div className="page">
        <h2 className="page-title pmat-title">{title}</h2>
        <p className="text-muted">
          이 호기에 연결된 BOM 이 없습니다. 생산현황 표의 「상세」에서 BOM 프로젝트와 타입을 먼저 골라 주세요.
        </p>
        {/* (2026-09-05 뒤로가기 표준) */}
        <button type="button" className="btn btn-sm btn-outline" onClick={back}>
          <Icon name="chevronLeft" className="btn-ic" />
          생산현황
        </button>
      </div>
    );

  const docNo = `MAT${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const stamp = localStamp();

  return (
    <div className="page pmat-page">
      {/* ── 화면 ── */}
      <div className={`page-header no-print${embedded ? ' page-header--sub' : ''}`}>
        <div>
          {!embedded && (
            <button type="button" className="btn btn-sm btn-outline" onClick={back}>
              <Icon name="chevronLeft" className="btn-ic" />
              생산현황
            </button>
          )}
          {/* 제목과 BOM 정보를 한 줄로 — 표 볼 자리를 넓힌다 (2026-09-08 대표님 「상단이 너무 많이 차지」) */}
          <h2 className="page-title pmat-title">
            {title} <span className="pmat-title-sub">· {box} 자재 체크</span>
            <span className="pmat-link">
              BOM <strong>{link.projectName || project?.name || ''}</strong>
              {link.variantLabel ? (
                <span className="pmat-variant">{link.variantLabel}</span>
              ) : (
                <span className="pmat-variant is-common">공통</span>
              )}
            </span>
          </h2>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => window.print()}>
            <Icon name="doc" className="btn-ic" />
            체크리스트 출력
          </button>
        </div>
      </div>

      {/* BOX 탭 — 이 BOM 에 줄이 있는 BOX 만. 오른쪽 끝에 보기(전체·부족·완료) */}
      <div className="pmat-boxes no-print">
        <ViewSwitch
          options={(boxesWithRows.length ? boxesWithRows : CHECKABLE_BOXES).map((b) => ({
            value: b,
            label: b,
            count: shortByBox[b] > 0 ? shortByBox[b] : ' ',
          }))}
          value={box}
          onChange={setBox}
          ariaLabel="BOX"
          className="pmat-box-switch"
        />
        <ViewSwitch
          className="pmat-rowview"
          options={[
            { value: 'all', label: '전체' },
            { value: 'short', label: '부족' },
            { value: 'done', label: '완료' },
          ]}
          value={rowView}
          onChange={setRowView}
          ariaLabel="줄 보기"
        />
      </div>

      {/* 도급 / 사급 탭 + 진행 */}
      <div className="pmat-kinds no-print">
        <ViewSwitch
          options={[
            {
              value: 'paid',
              label: '도급',
              count: (
                <span className={summary.paid.done < summary.paid.total ? 'is-short' : ''}>
                  {summary.paid.done}/{summary.paid.total}
                </span>
              ),
            },
            {
              value: 'free',
              label: '사급',
              count: (
                <span className={summary.free.done < summary.free.total ? 'is-short' : ''}>
                  {summary.free.done}/{summary.free.total}
                </span>
              ),
            },
          ]}
          value={supplyTab}
          onChange={setSupplyTab}
          ariaLabel="도급 사급 구분"
        />
        {locked && assigned ? (
          <span className="pmat-assigned-row">
            <span
              className="status-badge status-badge--done pmat-locked-badge"
              title="발주 입고분이 이 호기에 들어온 상태"
            >
              <Icon name="lock" />
              도급 배정 · {panel.paidSet.at}
              {panel.paidSet.by ? ` · ${panel.paidSet.by}` : ''}
            </span>
            {summary.paid.done < summary.paid.total && canFillAll && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={!editMode}
                onClick={pullAllStock}
                title="모자란 줄 전부를 발주 여유 → 창고 재고 순으로 (있는 만큼만)"
              >
                부족분 채우기
              </button>
            )}
            <button type="button" className="btn btn-sm btn-outline" disabled={!editMode} onClick={unassign}>
              배정 취소
            </button>
          </span>
        ) : locked ? (
          <span className="pmat-hint pmat-hint-paid">
            <Icon name="lock" />
            도급 자재는 손으로 적지 않습니다 — 발주 상세 「생산 호기」에 이 호기를 걸어 두면 입고 때 자동으로 채워집니다
          </span>
        ) : (
          <span className="pmat-hint">수량을 누르면 필요 수량만큼 채워집니다 · 길게 누르면 직접 적습니다</span>
        )}
        {shown.length > 0 && !locked && (
          <span className="pmat-fill">
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={clearAll}
              title="이 탭의 입고 수량을 전부 0 으로"
            >
              전부 비움
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={fillAll}
              title="이 탭의 줄을 전부 필요 수량대로"
            >
              전부 들어옴
            </button>
          </span>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="purchase-empty no-print">
          {rowView === 'short'
            ? '부족한 줄이 없습니다.'
            : rowView === 'done'
              ? '완료된 줄이 없습니다.'
              : `이 BOX 에 ${supplyTab === 'free' ? '사급' : '도급'} 구성품이 없습니다.`}
        </p>
      ) : (
        <div className="table-scroll-x pmat-scroll no-print" ref={scrollRef}>
          <table className="table pmat-table no-fit">
            {/* 도급·사급 탭이 같은 폭이 되도록 열 폭을 고정한다. 규격은 남는 자리를 채워
                오른쪽에 빈 공간이 남지 않는다 (2026-09-05 대표님) */}
            <colgroup>
              {/* 코드 열은 뺐다 — 현장에서는 도번·품명으로 찾는다 (2026-09-08 대표님) */}
              {['44px', '15%', '14%', null, '6.5%', '6.5%', '4.5%', '7%', hasMeta ? '11%' : null, '7.5%', '5.5%']
                .filter((_, i) => hasMeta || i !== 9)
                .map((w, i) => (
                  <col key={i} style={w ? { width: w } : undefined} />
                ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="col-no">
                  No
                </th>
                <th scope="col">도번</th>
                <th scope="col">품명</th>
                <th scope="col">규격</th>
                <th scope="col" className="pmat-num">
                  필요 수량
                </th>
                <th scope="col" className="pmat-num">
                  입고 수량
                </th>
                <th scope="col" className="pmat-num">
                  부족
                </th>
                <th scope="col" className="pmat-ok">
                  입고
                </th>
                {hasMeta && <th scope="col">기록</th>}
                <th scope="col">비고</th>
                {/* 제외/포함은 사급·도급, 배정 전후 가리지 않고 항상. 작업 열이라 맨 오른쪽·좁게
                    (2026-09-05 대표님 「폭을 줄이고 맨 우측으로」) */}
                <th scope="col" className="col-action pmat-act">
                  이 호기
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const got = receivedQty(rec, r.id);
                const skipped = isSkipped(rec, r.id);
                const short = skipped ? 0 : shortageOf(r.qty, got);
                const done = rowDone(r, rec);
                const meta = rec[r.id];
                return (
                  <tr
                    key={r.id}
                    className={skipped ? 'is-skipped' : done ? 'is-done' : short > 0 && got > 0 ? 'is-partial' : ''}
                  >
                    <td className="col-no">{i + 1}</td>
                    <td className="pmat-drawing">{r.drawingNo}</td>
                    {/* 긴 이름만 줄바꿈 — 코드·도번·기록은 한 줄로 (2026-09-05 대표님) */}
                    <td className="u-wrap">{r.name}</td>
                    <td className="pmat-spec u-wrap" title={r.spec}>
                      {r.spec}
                    </td>
                    <td className="pmat-num">{Number(r.qty) || 0}</td>
                    <td className="pmat-num">
                      {locked ? (
                        <span className="pmat-locked-qty" title="세트 배정 — 도급 배정 화면에서만 바뀝니다">
                          {got || 0}
                        </span>
                      ) : typing === r.id ? (
                        <input
                          className="num-input pmat-input"
                          type="number"
                          min="0"
                          inputMode="numeric"
                          autoFocus
                          value={draft[r.id] !== undefined ? draft[r.id] : got || ''}
                          placeholder="0"
                          onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                          onBlur={() => commit(r)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') setTyping(null);
                          }}
                          aria-label={`${r.name} 입고 수량`}
                        />
                      ) : (
                        <button
                          type="button"
                          className={`pmat-qty-btn${got > 0 ? ' is-filled' : ''}`}
                          onPointerDown={() => startPress(r)}
                          onPointerUp={() => endPress(r, got)}
                          onPointerLeave={cancelPress}
                          onPointerCancel={cancelPress}
                          onContextMenu={(e) => e.preventDefault()}
                          title={
                            got > 0
                              ? '누르면 0 으로 되돌립니다 · 길게 누르면 수량을 적습니다'
                              : `누르면 ${Number(r.qty) || 0}개(필요 수량)로 채웁니다 · 길게 누르면 수량을 적습니다`
                          }
                          aria-label={`${r.name} 입고 수량 ${got || 0}`}
                        >
                          {got || 0}
                        </button>
                      )}
                    </td>
                    <td className={`pmat-num${short > 0 ? ' is-short' : ''}`}>
                      {short > 0 ? short : ''}
                      {/* 통에 얼마 남았는지 늘 보인다 — 통을 거칠지 말지 여기서 바로 판단된다
                          (2026-09-11 대표님). 전에는 부족할 때 뜨는 버튼으로만 짐작했다 */}
                      {supplyTab === 'free' && stockOf(r) > 0 && <span className="pmat-instock">통 {stockOf(r)}</span>}
                    </td>
                    {/* 입고 상태는 앱 공통 칩 하나로 (2026-09-05 대표님) */}
                    <td className="pmat-ok">
                      {/* 재고에서 채울 수 있으면 그 버튼이 입고 자리를 대신한다 — 「이 호기」 칸은
                          제외/포함만 (2026-09-05 대표님 「재고에서 위치가 이상함」) */}
                      {!locked && !skipped && short > 0 && stockOf(r) > 0 ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary pmat-pull-btn"
                          disabled={!editMode}
                          onClick={() => pullStock(r, got, short)}
                          title={`창고 재고 ${stockOf(r)}개 중 ${Math.min(short, stockOf(r))}개를 이 호기로`}
                        >
                          재고에서 {Math.min(short, stockOf(r))}
                        </button>
                      ) : (
                        <ReceiptChip
                          got={got}
                          need={Number(r.qty) || 0}
                          skip={skipped}
                          title={meta?.at ? `${meta.at}${meta.by ? ` · ${meta.by}` : ''}` : ''}
                        />
                      )}
                    </td>
                    {hasMeta && (
                      <td className="pmat-meta">
                        {meta?.at ? `${meta.at}${meta.by ? ` · ${meta.by}` : ''}` : ''}
                        {/* 창고 재고에서 꺼내 채운 몫 (2026-09-05 대표님 「기록에 재고 사용한 건 추가 표시」) */}
                        {Number(meta?.fromStock) > 0 && (
                          <span className="pmat-from-stock" title="창고 재고에서 가져온 개수">
                            재고 {meta.fromStock}
                          </span>
                        )}
                      </td>
                    )}
                    {/* 비고 — 호기·줄마다 한 줄 메모, 잠금을 풀어야 적는다 (2026-09-05 대표님) */}
                    <td className="pmat-note-cell">
                      <input
                        type="text"
                        className="pmat-input pmat-note"
                        value={noteDraft[r.id] !== undefined ? noteDraft[r.id] : rec[r.id]?.note || ''}
                        placeholder={editMode ? '메모' : ''}
                        readOnly={!editMode}
                        title={rec[r.id]?.note || (r.note ? `BOM 비고: ${r.note}` : '')}
                        onChange={(e) => setNoteDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                        onBlur={() => commitNote(r)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                        aria-label={`${r.name} 비고`}
                      />
                    </td>
                    {
                      <td className="col-action pmat-act">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => toggleSkip(r, !skipped)}
                          disabled={!editMode}
                          title={
                            editMode
                              ? skipped
                                ? '이 호기에서 다시 넣기'
                                : '이 호기에서만 빼기 — 기본 BOM 은 그대로'
                              : '오른쪽 아래 「잠금」을 푼 뒤에'
                          }
                        >
                          {skipped ? '포함' : '제외'}
                        </button>
                      </td>
                    }
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 출력 — 종이로 대조하고 나중에 옮겨 적는 체크리스트 (대표님 「출력도 가능해야함」) ── */}
      <div className="print-form-iopn print-form-paged print-only">
        <div className="bom-print-page">
          <IopnDocBrand title={`${title} · ${box} 자재 체크`} titleClass="bom-list-title is-long" />
          <div className="bom-print-supplier-band">
            {link.projectName || ''}
            {link.variantLabel ? ` · ${link.variantLabel}` : ''} —{' '}
            {supplyTab === 'free' ? '사급 (고객사 제공)' : '도급'}
          </div>
          <table className="iopn-items-table pmat-print-table">
            <thead>
              <tr>
                <th scope="col" className="c-no">
                  NO
                </th>
                <th scope="col" className="c-name">
                  품목명
                </th>
                <th scope="col" className="c-drawing">
                  도번
                </th>
                <th scope="col" className="c-spec">
                  규격
                </th>
                <th scope="col" className="c-qty">
                  필요 수량
                </th>
                <th scope="col" className="c-qty">
                  입고 수량
                </th>
                <th scope="col" className="c-qty">
                  부족
                </th>
                <th scope="col" className="c-from">
                  확인
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const got = receivedQty(rec, r.id);
                return (
                  <tr key={r.id}>
                    <td className="c-no">{i + 1}</td>
                    <td className={`c-name ${specFontClass(r.name, 13)}`}>{r.name}</td>
                    <td className={`c-drawing ${specFontClass(r.drawingNo, 12)}`}>{r.drawingNo}</td>
                    <td className={`c-spec ${specFontClass(r.spec, 36)}`}>{r.spec}</td>
                    <td className="c-qty">{Number(r.qty) || 0}</td>
                    <td className="c-qty">{got || ''}</td>
                    <td className="c-qty">{shortageOf(r.qty, got) || ''}</td>
                    <td className="c-from"></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="bom-print-footer">
            <span>(주)아이오피엔 · 호기 자재 체크 · {docNo}</span>
            <span>출력 {stamp}</span>
            <span>페이지 1 / 1</span>
          </div>
        </div>
      </div>
    </div>
  );
}
