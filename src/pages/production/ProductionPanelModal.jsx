import { Fragment, useRef, useState, useMemo } from 'react';
import Modal from '../../components/common/Modal';
import Icon from '../../components/common/Icon';
import { useDialog } from '../../components/common/useDialog';
import { updatePanel, uploadDefectPhoto, attachDefectPhoto } from '../../services/productionService';
import { useUploads } from '../../contexts/useUploads';
import ImageLightbox from '../../components/common/ImageLightbox';
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
  canEdit,
  checkerName = '',
  onClose,
  mode = 'info',
  part = null,
}) {
  const insp = getInsp(p);
  const { toast } = useDialog();
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
          if (it.사진) out.push({ downloadURL: it.사진, name: `${n}차 · ${box} · ${i + 1}번 발생` });
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
    if (!canEdit) return;
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
    const canAdd = canEdit && !!workerName;
    const mutSec = (mut) =>
      saveInspDerive(part, (n) => {
        if (!n[`차${round}`]) n[`차${round}`] = { 공정비고: {} };
        if (!n[`차${round}`].공정비고) n[`차${round}`].공정비고 = {};
        if (!n[`차${round}`].공정비고[part]) n[`차${round}`].공정비고[part] = { 항목: [] };
        mut(n[`차${round}`].공정비고[part]);
      });
    if (items.length === 0 && (round === 2 || !canEdit)) return null;
    return (
      <div key={round}>
        <div className="defect-round-label">{round}차 불량</div>
        <div className="defect-list">
          {items.map((it, i) => (
            <div className={`defect-card ${it.완료 ? 'done' : ''}`} key={i}>
              {/* 상단: 완료 체크 + 내용 + 삭제 */}
              <div className="defect-card-top">
                <input
                  type="checkbox"
                  checked={!!it.완료}
                  disabled={!canEdit}
                  onChange={(e) =>
                    mutSec((s) => {
                      s.항목[i].완료 = e.target.checked;
                      if (e.target.checked) s.항목[i].검수자 = checkerName;
                    })
                  }
                />
                <select
                  className={`defect-type ${it.유형 ? '' : 'is-empty'}`}
                  value={it.유형 || ''}
                  disabled={!canEdit}
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
                  disabled={!canEdit}
                  onBlur={(e) => {
                    if (e.target.value !== (it.내용 || '')) mutSec((s) => (s.항목[i].내용 = e.target.value));
                  }}
                />
                {canEdit && (
                  <button className="defect-del" onClick={() => mutSec((s) => s.항목.splice(i, 1))} aria-label="삭제">
                    <Icon name="trash" />
                  </button>
                )}
              </div>
              {/* 하단 좌우 2칸: 발생 / 조치 */}
              <div className="defect-ba">
                <div className="defect-ba-col before">
                  <div className="defect-ba-head">발생</div>
                  {upSlots[slotKey(part, round, i, '사진')] !== undefined ? (
                    <PhotoProgress pct={upSlots[slotKey(part, round, i, '사진')]} />
                  ) : it.사진 ? (
                    <img
                      loading="lazy"
                      className="defect-ba-photo"
                      src={it.사진}
                      alt="발생 사진"
                      onClick={() => openPhoto(it.사진)}
                    />
                  ) : canEdit ? (
                    <button className="defect-ba-add before" onClick={() => openCamera(part, round, i, '사진')}>
                      <Icon name="image" className="btn-ic" />
                      발생 사진
                    </button>
                  ) : (
                    <div className="defect-ba-empty">사진 없음</div>
                  )}
                </div>
                <div className="defect-ba-col after">
                  <div className="defect-ba-head">조치{it.검수자 ? ` · ${it.검수자}` : ''}</div>
                  {upSlots[slotKey(part, round, i, '조치사진')] !== undefined ? (
                    <PhotoProgress pct={upSlots[slotKey(part, round, i, '조치사진')]} />
                  ) : it.조치사진 ? (
                    <img
                      loading="lazy"
                      className="defect-ba-photo"
                      src={it.조치사진}
                      alt="조치 사진"
                      onClick={() => openPhoto(it.조치사진)}
                    />
                  ) : canEdit ? (
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
          {canEdit && (
            <div className="defect-add-row">
              <button className="defect-add" disabled={!canAdd} onClick={() => openCamera(part, round, null)}>
                <Icon name="image" className="btn-ic" /> {`${round}차 불량 추가 (사진 촬영)`}
              </button>
              <button
                className="defect-add-plain"
                disabled={!canAdd}
                onClick={() =>
                  mutSec((s) => s.항목.push({ 내용: '', 유형: '', 완료: false, 검수자: checkerName, 일자: today() }))
                }
              >
                사진 없이
              </button>
              {!workerName && <span className="defect-worker-hint">작업자 입력 후 등록 가능</span>}
            </div>
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
                <Fragment key={f}>{field(f, f, 'date')}</Fragment>
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
