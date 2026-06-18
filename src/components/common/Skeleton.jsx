/* 통일 로딩 스켈레톤 (CSS: .sk / .sk-line / .sk-card / .sk-row)
   <Skeleton.Rows count={5} />  ·  <Skeleton.Line w="60%" />  ·  <Skeleton.Card /> */

function Line({ w = '100%', h = 14, style }) {
  return <div className="sk sk-line" style={{ width: w, height: h, ...style }} />;
}

function Card({ h = 64, style }) {
  return <div className="sk sk-card" style={{ height: h, ...style }} />;
}

function Rows({ count = 4 }) {
  return (
    <div className="sk-row">
      {Array.from({ length: count }, (_, i) => (
        <Line key={i} w={`${90 - (i % 3) * 12}%`} />
      ))}
    </div>
  );
}

const Skeleton = { Line, Card, Rows };
export default Skeleton;
