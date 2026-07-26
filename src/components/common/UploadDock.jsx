import { useUploads } from '../../contexts/useUploads';
import Icon from './Icon';

// 항상 화면 우하단에 떠 있는 비차단 업로드 진행률 표시.
// 라우터 밖(App 최상위)에 마운트되어 어느 화면으로 이동해도 유지된다.
export default function UploadDock() {
  const { uploads, dismiss } = useUploads();
  if (!uploads.length) return null;

  const active = uploads.filter((u) => u.status === 'uploading').length;
  const heading = active > 0 ? `업로드 중 ${active}개` : '업로드 완료';

  return (
    <div className="upload-dock" role="status" aria-live="polite">
      <div className="upload-dock-head">
        <Icon name="inbox" className="upload-dock-head-ic" />
        <span>{heading}</span>
      </div>
      <div className="upload-dock-list">
        {uploads.map((u) => (
          <div key={u.key} className={`upload-dock-row is-${u.status}`}>
            <span className="upload-dock-name" title={u.name}>
              {u.name}
            </span>
            {u.status === 'uploading' && (
              <>
                <div className="upload-dock-bar">
                  <div className="upload-dock-fill" style={{ width: `${u.progress}%` }} />
                </div>
                <span className="upload-dock-pct">{u.progress}%</span>
              </>
            )}
            {u.status === 'done' && (
              <span className="upload-dock-badge is-done" aria-label="완료">
                <Icon name="check" />
              </span>
            )}
            {u.status === 'error' && (
              <>
                <span className="upload-dock-badge is-error" aria-label="실패">
                  <Icon name="alert" />
                </span>
                <button type="button" className="upload-dock-x" onClick={() => dismiss(u.key)} aria-label="닫기">
                  <Icon name="close" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
