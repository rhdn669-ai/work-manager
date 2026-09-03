import { Fragment, useRef, useState, useMemo, useEffect } from 'react';
import Modal from '../../components/common/Modal';
import Icon from '../../components/common/Icon';
import { useDialog } from '../../components/common/useDialog';
import { updatePanel, uploadDefectPhoto, attachDefectPhoto } from '../../services/productionService';
import { useUploads } from '../../contexts/useUploads';
import ImageLightbox from '../../components/common/ImageLightbox';
import Select from '../../components/common/Select';
import { getBomProjects } from '../../services/bomService';
import { makeBomLink, siblingsForCopy } from '../../domain/panelBom';
import { GIGU_MAKERS, OVERALL_CFG, deriveBoxStatus, AFTER_TURNON } from '../../domain/production';
import { DEFECT_TYPE_LABELS } from '../../domain/defectTypes';

const today = () => new Date().toISOString().slice(0, 10);

// 사진이 들어갈 자리에 그대로 얹히는 진행률. 창을 닫아도 업로드는 계속되니
// 「기다리세요」가 아니라 「이 자리에 곧 들어옵니다」를 보여준다.
function PhotoProgress({ pct }) {
  return (
    <div className="defect-ba-uploading" role="status" aria-live="polite">
      <div className="defect-up-bar">
        <div className="defect-up-fill" style={{ width: `${pct || 0}%` }} />
      </div>
      <span className="defect-up-pct">{pct || 0}%</span>
    </div>
  );
}
const mmddDot = (d) => (d ? String(d).slice(5).replace('-', '.') : '');

function getInsp(p) {
  return p.검수 || { 공정작업자: {}, 차1: { 공정비고: {} }, 차2: { 공정비고: {} } };
}

// 판넬 상세/편집 — 변경 즉시 저장. canEdit=false(일반직원)면 조회 전용.
export default function ProductionPanelModal({
  panel: p,
  panels = [], // 같은 프로젝트의 다른 호기에 BOM 연결을 복사할 때 쓴다
  canEdit,
  canDefect = canEdit,
  checkerName = '',
  onClose,
  mode = 'info',
  part = null,
}) {
  const insp = getInsp(p);
  const { toast, confirm } = useDialog();
  const { runUpload } = useUploads();
  // 불량 사진 촬영/첨부 — 하나의 숨은 input을 공유, 대상(부품·차수·행)을 ref에 보관
  const photoInputRef = useRef(null);
  const photoTargetRef = useRef(null); // { part, round, index|null(null=새 행 추가) }
  // 사진이 들어갈 자리마다 진행률을 따로 둔다 — 여러 장을 동시에 올려도 각자 보인다.
  // 모달을 닫아도 업로드는 전역(UploadProvider)에서 계속되고, 끝나면 스스로 저장한다.
  const [upSlots, setUpSlots] = useState({}); // { '부품|차수|번호|종류': 0~100 }
  const slotKey = (part, round, index, kind) => `${part}|${round}|${index ?? 'new'}|${kind || '사진'}`;
  const [viewerIndex, setViewerIndex] = useState(null);

  // 이 판넬에 달린 불량 사진을 차수·부품 순서대로 한 줄로 모은다.
  // 자료실과 같은 라이트박스를 쓰므로 { downloadURL, name } 모양으로 맞춘다.
  const photos = useMemo(() => {
    const insp = getInsp(p);
    const out = [];
    [1, 2].forEach((n) => {
      const 공정 = insp[`차${n}`]?.공정비고 || {};
      Object.keys(공정).forEach((box) => {
        (공정[box]?.항목 || []).forEach((it, i) => {
          if (it.사진) out.push({ downloadURL: it.사진, name: `${n}차 · ${box} · ${i + 1}번 등록` });
          if (it.조치사진) out.push({ downloadURL: it.조치사진, name: `${n}차 · ${box} · ${i + 1}번 조치` });
        });
      });
    });
    return out;
  }, [p]);

  const openPhoto = (url) => {
    const i = photos.findIndex((x) => x.downloadURL === url);
    setViewerIndex(i >= 0 ? i : 0);
  };

  const save = (patch) => {
    if (!canEdit) return;
    updatePanel(p.id, patch)
      .then((sync) => {
        // 부적합 실적에 새 줄이 생겼을 때만 알린다(갱신은 조용히 — 셀 편집마다 토스트가 뜨면 시끄럽다)
        if (sync === 'created') toast('품질보증 「부적합 실적」에 등록되었습니다.', 'success', 0);
      })
      .catch((err) =>
        toast(
          err?.ncrSync
            ? '저장은 됐지만 품질보증 연동에 실패했습니다. 품질보증 화면을 열면 다시 시도합니다.'
            : '저장 중 오류가 발생했습니다',
          'error',
          0,
        ),
      );
  };
  const saveInsp = (mut) => {
    if (!canEdit) return;
    const next = structuredClone(getInsp(p));
    mut(next);
    save({ 검수: next });
  };
  // 불량항목 변경 시 검수(insp) + 부품상태(자동 불량/완료) + 검수자를 함께 저장
  const saveInspDerive = (part, mut) => {
    if (!canDefect) return; // 불량·조치는 현장 공용 아이디도 쓸 수 있다
    const next = structuredClone(getInsp(p));
    mut(next);
    // 박스 상태 = 자재입고+불량 종합 자동산출 (매트릭스와 동일 규칙)
    const st = deriveBoxStatus(p, part, next);
    save({
      검수: next,
      부품상태: { ...(p.부품상태 || {}), [part]: st },
      부품검수자: { ...(p.부품검수자 || {}), [part]: st === '대기' ? '' : checkerName },
    });
  };

  function openCamera(part, round, index = null, kind = '사진') {
    photoTargetRef.current = { part, round, index, kind };
    photoInputRef.current?.click();
  }
  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const target = photoTargetRef.current;
    if (!file || !target) return;
    const { part, round, index, kind } = target;
    const key = slotKey(part, round, index, kind);
    const panelId = p.id;
    setUpSlots((m) => ({ ...m, [key]: 0 }));

    // 화면(모달)이 닫혀도 이어지도록 전역 업로드에 맡긴다.
    // 끝난 뒤 저장도 화면 상태가 아니라 저장된 최신 문서를 읽어 붙인다.
    runUpload(file.name || '불량 사진', (onProgress) =>
      uploadDefectPhoto(file, (pct) => {
        onProgress(pct);
        setUpSlots((m) => (key in m ? { ...m, [key]: pct } : m));
      }),
    )
      .then((url) => attachDefectPhoto(panelId, { part, round, index, kind, url, checkerName, today: today() }))
      .catch(() => toast('사진 업로드에 실패했습니다. 다시 시도해 주세요.', 'error', 0))
      .finally(() =>
        setUpSlots((m) => {
          const n = { ...m };
          delete n[key];
          return n;
        }),
      );
  }

  const oc = OVERALL_CFG[p.overallStatus] || OVERALL_CFG['대기중'];

  // ── BOM 연결 — 이 호기가 어느 BOM(프로젝트·타입)을 쓰는지 (2026-09-03 대표님) ──
  // 한 번 정해 두면 BOX 마다 버튼 한 번에 맞는 구성품이 열린다. BOX 는 판넬과 BOM 이
  // 같은 이름을 써서 대응표가 필요 없다.
  const [bomProjects, setBomProjects] = useState([]);
  useEffect(() => {
    getBomProjects()
      .then((list) => setBomProjects(list || []))
      .catch(() => setBomProjects([]));
  }, []);
  const link = p.bomLink || null;
  const linkedProject = useMemo(() => bomProjects.find((x) => x.id === link?.projectId) || null, [bomProjects, link]);
  const variantOptions = useMemo(
    () =>
      (Array.isArray(linkedProject?.variants) ? linkedProject.variants : []).map((v) => ({
        value: v.key,
        label: v.label,
      })),
    [linkedProject],
  );
  const copyTargets = useMemo(() => (link ? siblingsForCopy(panels, p) : []), [panels, p, link]);

  const setLink = (projectId, variantKey) => {
    const proj = bomProjects.find((x) => x.id === projectId);
    if (!proj) {
      save({ bomLink: null });
      return;
    }
    const v = (proj.variants || []).find((x) => x.key === variantKey);
    save({
      bomLink: makeBomLink({
        projectId: proj.id,
        projectName: proj.name,
        variantKey: v ? v.key : '',
        variantLabel: v ? v.label : '',
      }),
    });
  };

  // 같은 프로젝트의 다른 호기에 같은 연결을 — 호기 여덟 개면 여덟 번 고르지 않게
  const copyLinkToSiblings = async () => {
    if (!link || copyTargets.length === 0) return;
    // 여러 호기를 한꺼번에 바꾸는 일이라 한 번 되묻는다
    if (!(await confirm(`같은 회사의 다른 호기 ${copyTargets.length}개에 이 BOM 연결을 복사하시겠습니까?`))) return;
    try {
      await Promise.all(copyTargets.map((q) => updatePanel(q.id, { bomLink: link })));
      toast(`${copyTargets.length}개 호기에 연결을 복사했습니다`, 'success');
    } catch {
      toast('연결 복사 중 오류가 발생했습니다', 'error');
    }
  };

  const field = (label, key, type = 'text') => (
    <div className="pm-field" key={key}>
      <label>{label}</label>
      <input
        type={type}
        defaultValue={p[key] || ''}
        disabled={!canEdit}
        onBlur={(e) => {
          if (e.target.value !== (p[key] || '')) save({ [key]: e.target.value });
        }}
      />
    </div>
  );

  const defectBlock = (part, round) => {
    const sec = insp[`차${round}`]?.공정비고?.[part] || { 항목: [] };
    const items = sec.항목 || [];
    // 작업자 입력이 있어야 불량 등록 가능 (대표님 지시)
    const workerName = insp.공정작업자?.[part] || '';
    const canAdd = canDefect && !!workerName;
    const mutSec = (mut) =>
      saveInspDerive(part, (n) => {
        if (!n[`차${round}`]) n[`차${round}`] = { 공정비고: {} };
        if (!n[`차${round}`].공정비고) n[`차${round}`].공정비고 = {};
        if (!n[`차${round}`].공정비고[part]) n[`차${round}`].공정비고[part] = { 항목: [] };
        mut(n[`차${round}`].공정비고[part]);
      });
    if (items.length === 0 && (round === 2 || !canDefect)) return null; // 1차는 「불량 없음」 체크가 있어 늘 보인다
    return (
      <div key={round}>
        <div className="defect-round-label">
          {round}차 불량
          {items.some((it) => (it.내용 || it.사진) && !it.유형) && (
            <em className="defect-untyped-warn">유형을 고르지 않은 건이 있습니다 — 분포 집계에서 빠집니다</em>
          )}
        </div>
        <div className="defect-list">
          {items.map((it, i) => (
            <div className={`defect-card ${it.완료 ? 'done' : ''}`} key={i}>
              {/* 상단: 완료 체크 + 내용 + 삭제 */}
              <div className="defect-card-top">
                <input
                  type="checkbox"
                  checked={!!it.완료}
                  disabled={!canDefect}
                  onChange={(e) =>
                    mutSec((s) => {
                      s.항목[i].완료 = e.target.checked;
                      // 등록자(검수자)는 그대로 두고 조치한 사람을 따로 남긴다 —
                      // 예전에는 완료를 누르면 등록자 이름이 조치자로 덮여 누가 올렸는지 사라졌다.
                      if (e.target.checked) s.항목[i].조치자 = checkerName;
                    })
                  }
                />
                <select
                  className={`defect-type ${it.유형 ? '' : 'is-empty'}`}
                  value={it.유형 || ''}
                  disabled={!canDefect}
                  aria-label="불량 유형"
                  onChange={(e) => mutSec((s) => (s.항목[i].유형 = e.target.value))}
                >
                  <option value="">유형 선택 *</option>
                  {DEFECT_TYPE_LABELS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  defaultValue={it.내용 || ''}
                  placeholder="불량 내용…"
                  disabled={!canDefect}
                  onBlur={(e) => {
                    if (e.target.value !== (it.내용 || '')) mutSec((s) => (s.항목[i].내용 = e.target.value));
                  }}
                />
                {canEdit && (
                  <button
                    className="defect-del"
                    disabled={!canDefect}
                    onClick={() => mutSec((s) => s.항목.splice(i, 1))}
                    aria-label="삭제"
                  >
                    <Icon name="trash" />
                  </button>
                )}
              </div>
              {/* 하단 좌우 2칸: 등록(올린 사람) / 조치(처리한 사람) */}
              <div className="defect-ba">
                <div className="defect-ba-col before">
                  <div className="defect-ba-head">등록{it.검수자 ? ` · ${it.검수자}` : ''}</div>
                  {upSlots[slotKey(part, round, i, '사진')] !== undefined ? (
                    <PhotoProgress pct={upSlots[slotKey(part, round, i, '사진')]} />
                  ) : it.사진 ? (
                    <div className="defect-ba-photo-wrap">
                      <img
                        loading="lazy"
                        className="defect-ba-photo"
                        src={it.사진}
                        alt="등록 사진"
                        onClick={() => openPhoto(it.사진)}
                      />
                      {canDefect && (
                        <button
                          type="button"
                          className="defect-photo-del"
                          aria-label="등록 사진 삭제"
                          title="사진 삭제"
                          onClick={() => mutSec((x) => delete x.항목[i].사진)}
                        >
                          <Icon name="close" />
                        </button>
                      )}
                    </div>
                  ) : canDefect ? (
                    <button className="defect-ba-add before" onClick={() => openCamera(part, round, i, '사진')}>
                      <Icon name="image" className="btn-ic" />
                      등록 사진
                    </button>
                  ) : (
                    <div className="defect-ba-empty">사진 없음</div>
                  )}
                </div>
                <div className="defect-ba-col after">
                  <div className="defect-ba-head">
                    조치{it.조치자 || (it.완료 && it.검수자) ? ` · ${it.조치자 || it.검수자}` : ''}
                  </div>
                  {upSlots[slotKey(part, round, i, '조치사진')] !== undefined ? (
                    <PhotoProgress pct={upSlots[slotKey(part, round, i, '조치사진')]} />
                  ) : it.조치사진 ? (
                    <div className="defect-ba-photo-wrap">
                      <img
                        loading="lazy"
                        className="defect-ba-photo"
                        src={it.조치사진}
                        alt="조치 사진"
                        onClick={() => openPhoto(it.조치사진)}
                      />
                      {canDefect && (
                        <button
                          type="button"
                          className="defect-photo-del"
                          aria-label="조치 사진 삭제"
                          title="사진 삭제"
                          onClick={() => mutSec((x) => delete x.항목[i].조치사진)}
                        >
                          <Icon name="close" />
                        </button>
                      )}
                    </div>
                  ) : canDefect ? (
                    <button className="defect-ba-add after" onClick={() => openCamera(part, round, i, '조치사진')}>
                      <Icon name="image" className="btn-ic" />
                      조치 사진
                    </button>
                  ) : (
                    <div className="defect-ba-empty">사진 없음</div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {canDefect && (
            <div className="defect-add-row">
              <button className="defect-add" disabled={!canAdd} onClick={() => openCamera(part, round, null)}>
                <Icon name="image" className="btn-ic" /> {`${round}차 불량 추가 (사진 촬영)`}
              </button>
              <button
                className="defect-add-plain"
                disabled={!canAdd}
                onClick={() =>
                  mutSec((s) => {
                    s.불량없음 = false; // 불량을 등록하면 「불량 없음」은 성립하지 않는다
                    s.항목.push({ 내용: '', 유형: '', 완료: false, 검수자: checkerName, 일자: today() });
                  })
                }
              >
                사진 없이
              </button>
              {!workerName && <span className="defect-worker-hint">작업자 입력 후 등록 가능</span>}
            </div>
          )}
          {/* 「불량 없음」 — 들여다봤고 불량이 없다는 표시.
              이걸 체크해야 박스가 완료로 넘어간다. 자재만 들어온 상태는 완료가 아니다.
              (2026-08-22 대표님: 상태는 불량 확인까지 되어야 완료) */}
          {canDefect && round === 1 && (
            <label className={`defect-none-row${items.length > 0 ? ' is-disabled' : ''}`}>
              <input
                type="checkbox"
                checked={!!sec.불량없음 && items.length === 0}
                disabled={!canAdd || items.length > 0}
                onChange={(e) =>
                  mutSec((x) => {
                    x.불량없음 = e.target.checked;
                    if (e.target.checked) {
                      x.확인자 = checkerName;
                      x.확인일자 = today();
                    }
                  })
                }
              />
              <span>
                불량 없음
                <em>
                  {items.length > 0
                    ? '등록된 불량이 있어 체크할 수 없습니다'
                    : sec.불량없음
                      ? `${sec.확인자 || ''} · ${sec.확인일자 || ''}`
                      : '확인 후 체크하면 이 박스가 완료됩니다'}
                </em>
              </span>
            </label>
          )}
        </div>
      </div>
    );
  };

  const title =
    mode === 'defect'
      ? `${p.프로젝트 || '판넬'} ${part || ''} · 불량`
      : `${p.프로젝트 || '판넬'}${p.호기 ? ' ' + p.호기 : ''}`;

  return (
    <Modal isOpen onClose={onClose} title={title} size="lg">
      {/* 불량 사진 촬영 — 모바일에서 후면 카메라 바로 열림 */}
      <input ref={photoInputRef} type="file" accept="image/*" capture="environment" hidden onChange={handlePhoto} />

      {mode === 'defect' && (
        <div className="part-card">
          <div className="part-head">
            <span className="part-name">{part}</span>
            <div className="worker-input">
              <span>작업자</span>
              <input
                defaultValue={insp.공정작업자?.[part] || ''}
                placeholder="작업자명(필수)"
                disabled={!canEdit}
                onBlur={(e) => {
                  if (e.target.value !== (insp.공정작업자?.[part] || ''))
                    saveInsp((n) => {
                      if (!n.공정작업자) n.공정작업자 = {};
                      n.공정작업자[part] = e.target.value;
                    });
                }}
              />
              {(p.부품검수자 || {})[part] ? (
                <span className="part-checker">검수 {(p.부품검수자 || {})[part]}</span>
              ) : null}
            </div>
          </div>
          {defectBlock(part, 1)}
          {defectBlock(part, 2)}
        </div>
      )}

      {mode !== 'defect' && (
        <>
          <div style={{ marginBottom: 14 }}>
            <span className="badge" style={{ background: oc.bg, color: oc.fg }}>
              {p.overallStatus}
            </span>
            {!canEdit && (
              <span
                className="badge"
                style={{ background: 'var(--grey-100)', color: 'var(--text-muted)', marginLeft: 6 }}
              >
                조회 전용
              </span>
            )}
          </div>

          {/* BOM 연결 — 호기 자재 체크의 출발점. 여기서 정한 BOM 의 구성품이 BOX 마다 열린다 */}
          <div className="pm-section pm-bomlink">
            <div className="pm-section-title">
              BOM 연결
              {link && (
                <span className="pm-bomlink-badge">
                  {link.projectName}
                  {link.variantLabel ? ` · ${link.variantLabel}` : ''}
                </span>
              )}
            </div>
            <div className="pm-grid" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
              <div className="pm-field">
                <label>BOM 프로젝트</label>
                <Select
                  value={link?.projectId || ''}
                  onChange={(v) => setLink(v, '')}
                  options={[
                    { value: '', label: '연결 안 함' },
                    ...bomProjects.map((x) => ({ value: x.id, label: x.name })),
                  ]}
                  placeholder="연결 안 함"
                  ariaLabel="BOM 프로젝트"
                  disabled={!canEdit}
                  native
                />
              </div>
              <div className="pm-field">
                <label>타입(형번)</label>
                <Select
                  value={link?.variantKey || ''}
                  onChange={(v) => setLink(link?.projectId, v)}
                  options={[{ value: '', label: variantOptions.length ? '공통만' : '타입 없음' }, ...variantOptions]}
                  placeholder="공통만"
                  ariaLabel="BOM 타입"
                  disabled={!canEdit || !link}
                  native
                />
              </div>
              <div className="pm-field">
                <label>&nbsp;</label>
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  disabled={!canEdit || !link || copyTargets.length === 0}
                  onClick={copyLinkToSiblings}
                  title={
                    copyTargets.length
                      ? `같은 회사의 다른 호기 ${copyTargets.length}개에 이 연결을 복사합니다`
                      : '복사할 다른 호기가 없거나 이미 같은 연결입니다'
                  }
                >
                  다른 호기에 복사{copyTargets.length ? ` (${copyTargets.length})` : ''}
                </button>
              </div>
            </div>
            {!link && (
              <p className="pm-bomlink-hint">
                BOM 을 연결하면 생산현황 표의 BOX 칸에서 구성품 입고를 하나씩 체크할 수 있습니다.
              </p>
            )}
          </div>

          <div className="pm-section">
            <div className="pm-section-title">기본정보</div>
            <div className="pm-grid">
              <div className="pm-field" key="프로젝트호기">
                <label>프로젝트 호기</label>
                <input
                  aria-label="프로젝트 호기"
                  type="text"
                  defaultValue={`${p.프로젝트 || ''}${p.호기 ? ' ' + p.호기 : ''}`.trim()}
                  disabled={!canEdit}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    const cur = `${p.프로젝트 || ''}${p.호기 ? ' ' + p.호기 : ''}`.trim();
                    if (v !== cur) save(p.호기 ? { 프로젝트: v, 호기: '' } : { 프로젝트: v });
                  }}
                />
              </div>
              <div className="pm-field" key="정역">
                <label>정/역</label>
                <div className="jaip-row">
                  {['정', '역'].map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`jaip-chip ${p.정역 === v ? 'on' : ''}`}
                      disabled={!canEdit}
                      onClick={() => save({ 정역: p.정역 === v ? '' : v })}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              {field('자재', '자재')}
              <div className="pm-field" key="기구제작">
                <label>기구제작</label>
                <div className="jaip-row">
                  {(GIGU_MAKERS[p.회사] || [...GIGU_MAKERS['메티스'], ...GIGU_MAKERS['디에이치']]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`jaip-chip ${p.기구제작 === v ? 'on' : ''}`}
                      disabled={!canEdit}
                      onClick={() => save({ 기구제작: p.기구제작 === v ? '' : v })}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              {field('자재입고일', '자재입고', 'date')}
              {field('판넬납기', '납기', 'date')}
              {field('턴온', '턴온', 'date')}
              {/* 턴온 뒤 마무리 일정 — 표와 같은 정의를 쓴다 */}
              {AFTER_TURNON.map((f) => (
                <Fragment key={f.key}>{field(f.label, f.key, 'date')}</Fragment>
              ))}
            </div>
            <div className="pm-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {field('비고', '비고')}
              {field('현장메모', '현장메모')}
            </div>
          </div>

          <div className="pm-section">
            <div className="pm-section-title">검수 · 출고</div>
            <div className="done-toggles">
              <button
                className={`done-toggle ${p.검수완료 ? 'on' : ''}`}
                disabled={!canEdit}
                onClick={() =>
                  save({
                    검수완료: !p.검수완료,
                    검수완료일: !p.검수완료 ? today() : '',
                    검수완료자: !p.검수완료 ? checkerName : '',
                  })
                }
              >
                {p.검수완료 && <Icon name="check" className="btn-ic" />}검수완료
                {p.검수완료 && p.검수완료일 ? (
                  <small className="chip-date">
                    {mmddDot(p.검수완료일)}
                    {p.검수완료자 ? ` · ${p.검수완료자}` : ''}
                  </small>
                ) : null}
              </button>
              <button
                className={`done-toggle ${p.출고완료 ? 'on' : ''}`}
                disabled={!canEdit}
                onClick={() =>
                  save({
                    출고완료: !p.출고완료,
                    출고완료일: !p.출고완료 ? today() : '',
                    출고완료자: !p.출고완료 ? checkerName : '',
                  })
                }
              >
                {p.출고완료 && <Icon name="check" className="btn-ic" />}출고완료
                {p.출고완료 && p.출고완료일 ? (
                  <small className="chip-date">
                    {mmddDot(p.출고완료일)}
                    {p.출고완료자 ? ` · ${p.출고완료자}` : ''}
                  </small>
                ) : null}
              </button>
            </div>
          </div>
        </>
      )}

      {/* 사진은 새 탭 대신 앱 안에서 — 현장에서 폰으로 볼 때 앱을 벗어나지 않는다 */}
      {viewerIndex !== null && photos[viewerIndex] && (
        <ImageLightbox
          images={photos}
          index={viewerIndex}
          onIndex={setViewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </Modal>
  );
}
