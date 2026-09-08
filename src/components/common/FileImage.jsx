// 사내 서버에 있는 사진을 보여 주는 그림 조각. 주소 받아오기는 useFileUrl 이 맡는다. (2026-09-08)
import { useFileUrl } from '../../utils/useFileUrl';

export default function FileImage({ src, ...rest }) {
  const url = useFileUrl(src);
  if (!url) return null;
  return <img src={url} {...rest} />;
}
