import { useEffect, useMemo, useState } from 'react';
import Icon from '../common/Icon';
import Modal from '../common/Modal';
import TrashModal from '../common/TrashModal';
import { useDialog } from '../common/useDialog';
import { useAuth } from '../../contexts/useAuth';
import { ASSET_STATUS, assetStatusOf, nextCalibrationDate } from '../../domain/qualityForms';
import { subscribeAssets, addAsset, updateAsset, trashAsset } from '../../services/qualityAssetService';

// 자산 대장 (계측기·지그·치공구) — 15종 서식이 공유할 대장 골격의 첫 구현.
// assetType 만 바꿔 세 소탭이 같은 컴포넌트를 쓴다.

const EMPTY = {
  assetNo: '',
  name: '',
  maker: '',
  model: '',
  cycleMonths: 12,
  lastDate: '',
  location: '',
  dept: '',
  owner: '',
  note: '',
};

export default function QualityAssetLedger({ assetType, docNo, label }) {
  const { confirm, toast } = useDialog();
  const { userProfile, isAdmin } = useAuth();
  const [all, setAll] = useState([]);
  const [editing, setEditing] = useState(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => subscribeAssets(setAll), []);

  const rows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return all
      .filter((a) => a.assetType === assetType)
      .map((a) => ({ ...a, st: assetStatusOf(a.nextDate) }))
      .filter((a) => statusFilter === 'all' || a.st.key === statusFilter)
      .filter(
        (a) =>
          !kw ||
          [a.assetNo, a.name, a.maker, a.model, a.location, a.owner]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(kw)),
      );
  }, [all, assetType, keyword, statusFilter]);

  const counts = useMemo(() => {
    const base = { normal: 0, due: 0, over: 0 };
    all
      .filter((a) => a.assetType === assetType)
      .forEach((a) => {
        base[assetStatusOf(a.nextDate).key] += 1;
      });
    return base;
  }, [all, assetType]);

  const total = counts.normal + counts.due + counts.over;

  // 관리번호는 사내에 정해진 규칙이 있으므로 임의 채번하지 않고 입력받는다
  const openNew = () => setEditing({ ...EMPTY });

  const save = async () => {
    if (!String(editing.assetNo ?? '').trim()) {
      toast('관리번호를 입력하세요 (사내 관리번호 규칙에 따라)', 'error');
      return;
    }
    if (!editing.name.trim()) {
      toast('명칭을 입력하세요', 'error');
      return;
    }
    const payload = {
      ...editing,
      assetType,
      cycleMonths: Number(editing.cycleMonths) || 0,
      nextDate: nextCalibrationDate(editing.lastDate, editing.cycleMonths),
    };
    const { id, ...rest } = payload;
    setEditing(null); // 저장 대기 없이 즉시 닫는다 — 결과만 토스트로
    try {
      if (id) await updateAsset(id, rest);
      else await addAsset(rest);
      toast(id ? '수정했습니다.' : '등록했습니다.', 'success', 0);
    } catch {
      toast('저장 중 오류가 발생했습니다', 'error', 0);
    }
  };

  const remove = async (a) => {
    if (!(await confirm(`${a.assetNo} ${a.name}을(를) 휴지통으로 옮길까요?`))) return;
    try {
      await trashAsset(a, userProfile?.name || '');
      toast('휴지통으로 이동했습니다.', 'success', 0);
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error', 0);
    }
  };

  return (
    <>
      <div className="q-ledger-head">
        <h3>
          {label}
          <span className="q-doc-badge">{docNo}</span>
        </h3>
        <div className="q-ledger-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
            <Icon name="trash" className="btn-ic" />
            휴지통
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={openNew}>
            <Icon name="plus" className="btn-ic" />
            신규
          </button>
        </div>
      </div>

      <div className="q-summary">
        {['normal', 'due', 'over'].map((k) => (
          <button
            key={k}
            type="button"
            className={`q-summary-chip q-chip-${k} ${statusFilter === k ? 'active' : ''}`}
            onClick={() => setStatusFilter(statusFilter === k ? 'all' : k)}
          >
            <i />
            {ASSET_STATUS[k].label}
            <b>{counts[k]}</b>
          </button>
        ))}
        <div className="q-summary-bar" aria-hidden="true">
          {total > 0 &&
            ['normal', 'due', 'over'].map((k) => (
              <span key={k} className={`q-bar-${k}`} style={{ width: `${(counts[k] / total) * 100}%` }} />
            ))}
        </div>
        <input
          className="q-search"
          placeholder="관리번호 · 명칭 · 제조사 검색"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      <div className="card">
        <div className="table-scroll-x">
          <table className="table cards-sm">
            <thead>
              <tr>
                <th>관리번호</th>
                <th>명칭</th>
                <th>제조사 · 모델</th>
                <th>교정주기</th>
                <th>최근교정</th>
                <th>차기교정</th>
                <th>잔여</th>
                <th>상태</th>
                <th className="col-action">작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className={`q-row-${a.st.key}`}>
                  <td className="q-num">{a.assetNo}</td>
                  <td>{a.name}</td>
                  <td className="q-dim">{[a.maker, a.model].filter(Boolean).join(' · ')}</td>
                  <td className="q-num">{a.cycleMonths ? `${a.cycleMonths}개월` : '—'}</td>
                  <td className="q-num">{a.lastDate || '—'}</td>
                  <td className="q-num">{a.nextDate || '—'}</td>
                  <td>
                    {a.st.days == null ? (
                      '—'
                    ) : (
                      <span className="q-remain">
                        <span className={`q-gauge q-gauge-${a.st.key}`}>
                          <i style={{ width: `${Math.max(0, Math.min(100, (a.st.days / 365) * 100))}%` }} />
                        </span>
                        <b>{a.st.days < 0 ? `${-a.st.days}일 초과` : `${a.st.days}일`}</b>
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${ASSET_STATUS[a.st.key].cls}`}>{ASSET_STATUS[a.st.key].label}</span>
                  </td>
                  <td className="col-action">
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => setEditing(a)}>
                      수정
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(a)}>
                      <Icon name="trash" className="btn-ic" />
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <div className="q-todo">
                      <Icon name="doc" style={{ width: 34, height: 34 }} />
                      <b>등록된 항목이 없습니다</b>
                      <p>우측 상단 「+ 신규」로 첫 항목을 등록하세요.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && (
          <div className="q-table-foot">
            전체 {total}건 · 정상 {counts.normal} · 임박 {counts.due} · 초과 {counts.over}
          </div>
        )}
      </div>

      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? `${label} 수정` : `${label} 등록`}
      >
        {editing && (
          <div className="form-body">
            <div className="form-group">
              <label>관리번호 *</label>
              <input
                placeholder="사내 관리번호 규칙에 따라 입력"
                value={editing.assetNo}
                onChange={(e) => setEditing({ ...editing, assetNo: e.target.value })}
                disabled={!isAdmin && !!editing.id}
              />
            </div>
            <div className="form-group">
              <label>명칭</label>
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>제조사</label>
              <input value={editing.maker} onChange={(e) => setEditing({ ...editing, maker: e.target.value })} />
            </div>
            <div className="form-group">
              <label>모델·규격</label>
              <input value={editing.model} onChange={(e) => setEditing({ ...editing, model: e.target.value })} />
            </div>
            <div className="form-group">
              <label>교정주기(개월)</label>
              <input
                type="number"
                value={editing.cycleMonths}
                onChange={(e) => setEditing({ ...editing, cycleMonths: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>최근 교정일</label>
              <input
                type="date"
                value={editing.lastDate}
                onChange={(e) => setEditing({ ...editing, lastDate: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>보관위치</label>
              <input value={editing.location} onChange={(e) => setEditing({ ...editing, location: e.target.value })} />
            </div>
            <div className="form-group">
              <label>사용부서</label>
              <input value={editing.dept} onChange={(e) => setEditing({ ...editing, dept: e.target.value })} />
            </div>
            <div className="form-group">
              <label>관리담당자</label>
              <input value={editing.owner} onChange={(e) => setEditing({ ...editing, owner: e.target.value })} />
            </div>
            <div className="form-group form-full">
              <label>비고</label>
              <input value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
            </div>
            <div className="q-next-preview form-full">
              차기 교정일 <b>{nextCalibrationDate(editing.lastDate, editing.cycleMonths) || '—'}</b>
              <small>최근 교정일 + 교정주기로 자동 계산됩니다</small>
            </div>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={() => setEditing(null)}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>
            저장
          </button>
        </div>
      </Modal>

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['qualityAssets']}
        title="품질 자산 휴지통"
      />
    </>
  );
}
