import './hud.css'

const compassMarks = Array.from({ length: 36 }, (_, index) => {
  const angle = index * 10
  const major = angle % 30 === 0
  return (
    <line
      key={angle}
      x1="80"
      y1={major ? '10' : '14'}
      x2="80"
      y2="20"
      transform={`rotate(${angle} 80 80)`}
      className={major ? 'compass-mark major' : 'compass-mark'}
    />
  )
})

export default function Hud() {
  return (
    <section className="hud-panel" aria-label="Flight instruments">
      <div className="hud-instrument">
        <svg className="attitude-gauge" viewBox="0 0 160 160" role="img" aria-label="Attitude indicator preview">
          <defs>
            <clipPath id="attitude-clip">
              <circle cx="80" cy="80" r="73" />
            </clipPath>
          </defs>
          <circle className="gauge-face" cx="80" cy="80" r="77" />
          <g clipPath="url(#attitude-clip)">
            <rect className="attitude-sky" x="0" y="0" width="160" height="80" />
            <rect className="attitude-ground" x="0" y="80" width="160" height="80" />
            <g className="attitude-ladder">
              <line x1="45" y1="62" x2="70" y2="62" />
              <line x1="90" y1="62" x2="115" y2="62" />
              <line x1="38" y1="80" x2="67" y2="80" />
              <line x1="93" y1="80" x2="122" y2="80" />
              <line x1="45" y1="98" x2="70" y2="98" />
              <line x1="90" y1="98" x2="115" y2="98" />
              <text x="57" y="58">10</text>
              <text x="98" y="58">10</text>
              <text x="57" y="112">10</text>
              <text x="98" y="112">10</text>
            </g>
          </g>
          <path className="attitude-pointer" d="M71 12h18l-9 16z" />
          <path className="aircraft-mark" d="M38 80h31l11 5 11-5h31M80 75v10" />
          <circle className="gauge-center" cx="80" cy="80" r="3" />
        </svg>
        <span className="hud-label">ATTITUDE</span>
      </div>

      <div className="hud-instrument">
        <svg className="compass-gauge" viewBox="0 0 160 160" role="img" aria-label="Compass preview">
          <circle className="gauge-face compass-face" cx="80" cy="80" r="77" />
          <g>{compassMarks}</g>
          <text className="compass-cardinal" x="80" y="38">N</text>
          <text className="compass-cardinal" x="122" y="84">E</text>
          <text className="compass-cardinal" x="80" y="132">S</text>
          <text className="compass-cardinal" x="38" y="84">W</text>
          <path className="compass-pointer" d="M80 37l-12 45 12-6 12 6z" />
          <rect className="compass-reading-box" x="56" y="68" width="48" height="25" rx="2" />
          <text className="compass-reading" x="80" y="86">---</text>
        </svg>
        <span className="hud-label">COMPASS</span>
      </div>
    </section>
  )
}
